import "server-only";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { LEAVES_ENABLED } from "@/lib/features";
import { getLeaveById, LEAVE_COLS, type LeaveRow } from "@/lib/leaves";
import { logLeaveEdit } from "@/lib/leave-edit-log";
import { kararStatusu, type LeaveKarar } from "@/lib/leave-decision";

/**
 * İZİN KARARI — ORTAK ÇEKİRDEK (11.08.2026).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Onay/ret iki YÜZEYDEN veriliyor:
 *   • panel  → app/actions/leaves.ts `approveLeaveAction` / `rejectLeaveAction`
 *              (server action, `hak_session` çerezi, requireAdmin → redirect)
 *   • mobil  → app/api/mobile/leaves/[id]/onay (Bearer token, requireMobileAdmin
 *              → 403 JSON)
 * AYRILAN tek şey KAPI ve HATA BİÇİMİ. Kararın kendisi — hangi status yazılır,
 * `approved_by`/`decided_at` nasıl doldurulur, iz nasıl bırakılır, hangi
 * sayfalar tazelenir — TEK yerde, burada. İkinci bir kopya yazılsaydı iki yüzey
 * zamanla ayrışırdı: biri iz bırakır öteki bırakmaz, biri `updated_at` yazar
 * öteki yazmaz. Bu dosya o ayrışmayı MÜMKÜN OLMAKTAN çıkarıyor.
 *
 * Yetki denetimi burada YAPILMAZ: çağıran kapısını kendi geçirir. "Yalnız
 * patron" kuralı iki yüzeyde de yerinde (requireAdmin ↔ requireMobileAdmin,
 * lib/mobile-scope.ts'teki parite kuralı).
 */

export type LeaveKararYazma =
  | { ok: true; satir: LeaveRow; degisti: boolean }
  | { ok: false; sebep: "kapali" | "yok" | "hata" };

/**
 * Bekleyen bir izin talebini ONAYLA ya da REDDET.
 *
 * ── DAVRANIŞ KORUNDU ───────────────────────────────────────────────────────
 * Aynı kararı ikinci kez vermek DB'ye YİNE yazar (`decided_at` tazelenir). Bu,
 * panelin 11.08.2026 öncesi davranışının BİREBİR aynısıdır ve bilerek
 * değiştirilmedi: ortak fonksiyona taşımak bir yeniden düzenlemedir, davranış
 * değişikliği değil. Yanıttaki `degisti` bayrağı istemciye kararın gerçekten
 * bir şeyi değiştirip değiştirmediğini SÖYLER (ekran "onaylandı" bildirimini
 * boşuna göstermesin) ama yazmayı engellemez.
 *
 * ── REDDEDİLEN KAYIT DURUR ─────────────────────────────────────────────────
 * `ret` satırı SİLMEZ, `status='rejected'` yazar — talebin açıldığı ve
 * reddedildiği iz kalır.
 *
 * `not` verilirse KARAR NOTU olarak ize yazılır; `worker_leaves.note`
 * DOKUNULMAZ (bkz. lib/leave-edit-log.ts).
 */
export async function decideLeave(
  id: string,
  karar: LeaveKarar,
  deciderWorkerId: string | null,
  not?: string | null
): Promise<LeaveKararYazma> {
  if (!LEAVES_ENABLED) return { ok: false, sebep: "kapali" };

  const before = await getLeaveById(id);
  if (!before) return { ok: false, sebep: "yok" };

  const status = kararStatusu(karar);
  const nowIso = new Date().toISOString();

  const { data: upd, error } = await supabaseAdmin
    .from("worker_leaves")
    .update({
      status,
      approved_by: deciderWorkerId,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .select(LEAVE_COLS)
    .maybeSingle();
  if (error || !upd) return { ok: false, sebep: "hata" };

  await logLeaveEdit(
    id,
    deciderWorkerId,
    karar === "onay" ? "approve" : "reject",
    before as unknown as Record<string, unknown>,
    upd as unknown as Record<string, unknown>,
    not ?? null
  );

  revalidateLeaveSurfaces();

  return { ok: true, satir: upd as LeaveRow, degisti: before.status !== status };
}

/**
 * Kararın görüneceği panel sayfalarını tazele.
 *
 * ── NEDEN ÇEKİRDEKTE ───────────────────────────────────────────────────────
 * Mobilden verilen bir karar da panelin önbelleğini geçersiz kılmalı; aksi
 * hâlde telefonda onaylanan izin panelde "bekliyor" görünmeye devam ederdi —
 * ertelemeyi cihazda tutmama kararıyla aynı hata. İki çağrıyı iki yüzeye
 * kopyalamak yerine kararla birlikte yaşıyor.
 *
 * ── NEDEN try/catch ────────────────────────────────────────────────────────
 * `revalidatePath` istek kapsamı ister. Server action ve route handler'da
 * kapsam vardır; doğrulama betiği (`scripts/verify-*.mjs`) uçları düz Node'da
 * çağırıyor ve orada kapsam YOKTUR. Tazeleme başarısız diye ZATEN YAZILMIŞ bir
 * kararı hata saymak yanlış olurdu: veri doğru, yalnız önbellek bayat.
 */
function revalidateLeaveSurfaces(): void {
  try {
    revalidatePath("/admin/izinler");
    revalidatePath("/admin");
  } catch {
    // İstek kapsamı yok (doğrulama betiği) — yazma etkilenmez.
  }
}
