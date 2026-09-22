"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/session";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";
import { oturumlariKes, hesabiGeriAc } from "@/lib/guvenlik-eylem";

/**
 * PATRON EYLEMLERİ (045) — /admin/guvenlik ekranının yazma yolu.
 *
 * Her action `requireOwner()` ile başlar. UI'da düğmeyi gizlemek kozmetiktir;
 * son sözü bu kapı söyler (action doğrudan çağrılabilir).
 *
 * ═══ İŞİN KENDİSİ `lib/guvenlik-eylem.ts`TE ═══
 * Buradaki iki fonksiyon artık yalnız KAPI + BAYRAK + TAZELEME. Sayaç
 * artırma, oturum satırlarını kapatma, dondurma ve iz yazma tek çekirdekte —
 * mobil uçlar (`/api/mobile/guvenlik/...`) AYNI fonksiyonları çağırıyor.
 * Kopyalasaydık iki yüzey zamanla ayrışırdı (084 `kalemKapsamda`, 086
 * `kademeDenetle` kararlarının aynısı).
 */

export type SecurityActionResult = { ok: boolean; error?: string };

/**
 * OTURUMLARI SONLANDIR (+ isteğe bağlı HESABI DONDUR).
 *
 * Üç şeyi birden yapar, çünkü ikisi ayrı kalırsa yarım bir güvenlik önlemi
 * olur: `session_version++` (web çerezleri), açık `login_sessions` satırlarının
 * kapatılması, `token_version++` (mobil). Gerekçesi ve "tek oturum kesilemez"
 * ölçümü çekirdeğin başlığında.
 */
export async function revokeSessionsAction(
  workerId: string,
  freeze: boolean
): Promise<SecurityActionResult> {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return { ok: false, error: "layer_disabled" };

  const r = await oturumlariKes(workerId, session.worker_id ?? null, { dondur: freeze });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}

/** Dondurulmuş hesabı geri açar (is_active=true). Oturumlar kapalı kalır. */
export async function unfreezeAccountAction(
  workerId: string
): Promise<SecurityActionResult> {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return { ok: false, error: "layer_disabled" };

  const r = await hesabiGeriAc(workerId, session.worker_id ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}
