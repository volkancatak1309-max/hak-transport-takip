import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { govdeCoz, onizleme } from "@/lib/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/duyuru — FİLO DUYURUSU.
 *
 * ── YALNIZ PATRON ───────────────────────────────────────────────────────────
 * `requireMobileAdmin`: şef de şoför de 403 alır. Duyuru tüm filoya gidiyor;
 * kapsamı olan biri (şef) "tüm filo"ya yazamamalı, kapsamı olmayan (şoför)
 * hiç. Şefin kendi filosuna duyuru yapması AYRI bir karar — bugün yok.
 *
 * ── NEDEN DAĞITIM (fan-out), NEDEN TEK SATIR + SANAL GÖRÜNÜM DEĞİL ─────────
 * Tek duyuru her şoförün konuşmasına BİRER satır olarak yazılır, hepsi aynı
 * `broadcast_id`'yi taşır. Böylece okuma modeli tekdüze kalır (konuşma ekranı
 * "duyuru mu" diye ikinci bir kaynağa bakmaz), okundu durumu şoför başına
 * doğal olur ve gelen CEVAP kendi konuşmasına düşer — Motive'in davranışı da
 * bu. Bedeli: 500 şoför = 500 satır. Önemsiz.
 *
 * ── ŞOFÖR DUYURUYA CEVAP VERİRSE ────────────────────────────────────────────
 * Cevap normal bir mesajdır ve YALNIZ kendi konuşmasında görünür; diğer
 * şoförler görmez. Duyuru tek yönlü yayın, cevap özel — kural şemadan geliyor
 * (konuşma şoför başına).
 *
 * ── KİMLERE GİDER ───────────────────────────────────────────────────────────
 * Aktif, test olmayan ŞOFÖRLER (yönetici muafiyetiyle: counts_as_driver).
 * Yöneticiler hariç — kendi kendine duyuru göndermek anlamsız ve konuşmanın
 * sahibi daima bir şofördür.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const gonderen = guard.actor.worker;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;
  const govde = govdeCoz(inp.govde ?? inp.body);
  if (!govde.ok) return mobileError(400, govde.code);

  // Alıcılar — panelin şoför tanımıyla aynı cümle (migration 041 muafiyeti).
  // test-filtered: is_test elenir; duyuru test hesabına GITMEZ.
  const { data: hedefler, error: hErr } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("is_active", true)
    .not("is_test", "is", true)
    .or("is_admin.eq.false,counts_as_driver.eq.true");
  if (hErr) return mobileError(503, "db_error");

  const soforIds = ((hedefler ?? []) as { id: string }[]).map((w) => w.id);
  if (soforIds.length === 0) {
    return mobileError(409, "no_recipients");
  }

  // ── Konuşmaları hazırla — eksikleri TEK toplu insert ile aç ───────────────
  const { data: mevcut, error: mErr } = await supabaseAdmin
    .from("conversations")
    .select("id, worker_id")
    .in("worker_id", soforIds);
  if (mErr) return mobileError(503, "db_error");

  const kMap = new Map(
    ((mevcut ?? []) as { id: string; worker_id: string }[]).map((c) => [c.worker_id, c.id])
  );
  const eksik = soforIds.filter((w) => !kMap.has(w));
  if (eksik.length > 0) {
    // upsert + ignoreDuplicates: iki duyuru aynı anda giderse worker_id UNIQUE
    // yüzünden biri 23505 alırdı. Yarışta kaybeden tarafın satırı zaten
    // kazananınkiyle aynı; hata değil, beklenen sonuç.
    const { error: cErr } = await supabaseAdmin
      .from("conversations")
      .upsert(eksik.map((w) => ({ worker_id: w })), {
        onConflict: "worker_id",
        ignoreDuplicates: true,
      });
    if (cErr) return mobileError(500, "write_failed", { detail: cErr.message });

    const { data: tekrar } = await supabaseAdmin
      .from("conversations")
      .select("id, worker_id")
      .in("worker_id", eksik);
    for (const c of (tekrar ?? []) as { id: string; worker_id: string }[]) {
      kMap.set(c.worker_id, c.id);
    }
  }

  const konusmalar = soforIds.map((w) => kMap.get(w)).filter(Boolean) as string[];
  if (konusmalar.length === 0) return mobileError(500, "write_failed");

  // ── Tek broadcast_id, N satır ─────────────────────────────────────────────
  const broadcastId = crypto.randomUUID();
  const atIso = new Date().toISOString();

  const { data: yazilan, error: yErr } = await supabaseAdmin
    .from("messages")
    .insert(
      konusmalar.map((cid) => ({
        conversation_id: cid,
        sender_worker_id: gonderen.id,
        sender_role: "admin",
        body: govde.body,
        broadcast_id: broadcastId,
        created_at: atIso,
      }))
    )
    .select("id");
  if (yErr) return mobileError(500, "write_failed", { detail: yErr.message });

  // Liste sıralaması için denormalize alanlar. Yan görev: başarısız olsa bile
  // duyuru GİTMİŞTİR ve geri alınmaz — yalnız liste önizlemesi bayat kalır.
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: atIso,
      last_message_preview: onizleme(govde.body),
      last_sender_role: "admin",
    })
    .in("id", konusmalar);

  return Response.json({
    ok: true,
    duyuru: {
      broadcastId,
      an: atIso,
      /** Kaç şoförün konuşmasına düştü. */
      alici: (yazilan ?? []).length,
      hedeflenen: soforIds.length,
    },
  });
}
