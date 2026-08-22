import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { okunmamisSayaclari } from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";
import { parsePage, pageInfo } from "@/lib/mobile-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/messages — KONUŞMA LİSTESİ.
 *
 *   patron    → tüm şoförler
 *   filo şefi → kapsamındaki şoförler (072'den sonra araçsızlar da dâhil)
 *   şoför     → YALNIZ kendi tek satırı
 *
 * ── LİSTE ŞOFÖRDEN ÇIKAR, KONUŞMADAN DEĞİL ──────────────────────────────────
 * Konuşma satırı ilk mesaja kadar YOKTUR. Liste konuşmalardan üretilseydi
 * yönetici, henüz yazışmadığı şoförü hiç göremez ve ona yazamazdı. Bu yüzden
 * kaynak ŞOFÖR listesidir; konuşma varsa üzerine bindirilir, yoksa
 * `konusmaId: null` döner ve gönderme ucu onu ilk mesajda açar.
 *
 * ── OKUNMAMIŞ SAYACI ────────────────────────────────────────────────────────
 * READ_RECEIPTS_ENABLED kapalıyken `okunmamis: null` — "bilinmiyor", sıfır
 * DEĞİL. Makbuz yazılmadığı için her mesaj okunmamış görünürdü; sıfır demek de
 * uydurma olurdu (bkz. lib/km-quality.ts, "ölçülemedi ≠ 0").
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;
  const { worker, isChief, fleetScope } = guard.actor;

  const url = new URL(req.url);
  const page = parsePage(url);

  // Rol ve kapsam KAPIDAN gelir — uç kendi kopyasını kurmaz.
  const rol: "admin" | "fleet_chief" | "driver" =
    worker.is_admin ? "admin" : isChief ? "fleet_chief" : "driver";
  const kapsam = isChief ? fleetScope.workerIds : null;

  // ── Şoför yolu: ANAHTARLI okuma, tek satır ───────────────────────────────
  // Kapsam/filtre uygulanmaz çünkü sorgu zaten kendi kimliğine anahtarlı.
  let q = supabaseAdmin
    .from("workers")
    // test-filtered: yonetim yolunda is_test elenir (asagida); sofor yolu
    // ANAHTARLI okumadir — test hesabi kendi konusmasini gorebilmeli
    // (lib/test-data.ts kurali).
    .select("id, name, fleet, is_active", { count: "exact" })
    .eq("is_active", true);

  if (rol === "driver") {
    q = q.eq("id", worker.id);
  } else {
    q = q.not("is_test", "is", true).or("is_admin.eq.false,counts_as_driver.eq.true");
    if (rol === "fleet_chief") q = q.in("id", kapsam ?? []);
  }

  const { data: workers, error, count } = await q
    .order("name", { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) return Response.json({ ok: false, error: "db_error" }, { status: 503 });

  const satirlar = (workers ?? []) as {
    id: string; name: string | null; fleet: string | null;
  }[];

  // Konuşmaları TEK sorguda bindir (şoför başına sorgu atmak N+1 olurdu).
  const { data: konusmalar } = await supabaseAdmin
    .from("conversations")
    .select("id, worker_id, last_message_at, last_message_preview, last_sender_role")
    .in("worker_id", satirlar.map((w) => w.id));
  const kMap = new Map(
    ((konusmalar ?? []) as Record<string, unknown>[]).map((c) => [c.worker_id as string, c])
  );

  const okunmamis = await okunmamisSayaclari(
    [...kMap.values()].map((c) => c.id as string),
    worker.id
  );

  const liste = satirlar.map((w) => {
    const c = kMap.get(w.id);
    const kid = (c?.id as string | undefined) ?? null;
    return {
      soforId: w.id,
      adSoyad: w.name ?? "—",
      filo: w.fleet ?? null,
      konusmaId: kid,
      sonMesajAn: (c?.last_message_at as string | null) ?? null,
      sonMesajOnizleme: (c?.last_message_preview as string | null) ?? null,
      sonGonderenRol: (c?.last_sender_role as string | null) ?? null,
      /** null = okundu bilgisi KAPALI (bilinmiyor), 0 = hepsi okundu. */
      okunmamis: okunmamis ? (kid ? okunmamis.get(kid) ?? 0 : 0) : null,
    };
  });

  // Son konuşulan üstte; hiç mesajı olmayanlar altta, kendi aralarında ada göre.
  liste.sort((a, b) => {
    if (a.sonMesajAn && b.sonMesajAn) return a.sonMesajAn < b.sonMesajAn ? 1 : -1;
    if (a.sonMesajAn) return -1;
    if (b.sonMesajAn) return 1;
    return a.adSoyad.localeCompare(b.adSoyad, "tr");
  });

  return Response.json({
    ok: true,
    kapsam: { rol, filo: rol === "fleet_chief" ? kapsam?.length ?? 0 : null },
    okunduBilgisi: READ_RECEIPTS_ENABLED,
    konusmalar: liste,
    sayfa: pageInfo(page, count ?? liste.length),
  });
}
