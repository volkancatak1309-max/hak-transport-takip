/**
 * PAKET SAYISI ÜST SINIRLARI — vardiya kapanışı (22.07.2026).
 *
 * lib/validation.ts'teki MAX_COUNT (100.000) bir ŞEMA tavanıdır: "sayı, tamsayı,
 * negatif değil" der. Anlamlı bir sınır değildir — canlıda kapanışa 87.189
 * "teslim edilemeyen paket" girilebildi (time_entries.fc99240d) ve rapora öyle
 * yazıldı. Bir günlük dağıtımda alınan paket üst sınırı üç haneli.
 *
 * Sınır iki katmanlı:
 *  1. ANLAMSAL: teslim edilemeyen ≤ alınan. Teslim edilen = alınan − teslim
 *     edilemeyen olduğu için bu aşılırsa sonuç negatife düşer (kod Math.max ile
 *     0'a kırpıyordu, yani yanlış giriş sessizce yutuluyordu).
 *  2. MUTLAK: alınan bilinmiyorsa (şoför gün içinde girmediyse) tek vardiyada
 *     makul tavan. Bilinçli olarak cömert — meşru bir günü ASLA reddetmemeli
 *     (canlı gözlem: en yüksek gerçek değer 348).
 *
 * Sunucu son sözü söyler: hem online kapanış (app/actions/shift.ts) hem
 * çevrimdışı kuyruk replay'i (app/actions/offline.ts) bu modülü kullanır.
 */

/** Tek vardiyada makul paket tavanı (alınan sayı bilinmiyorken). */
export const MAX_SHIFT_PACKAGES = 2_000;

export type PackageBoundResult =
  | { ok: true }
  /** `code` doğrudan istemcinin mapErr'ine giden hata kodudur. */
  | { ok: false; code: string };

/**
 * Kapanışta girilen "teslim edilemeyen" değerini sınırlar.
 * @param undelivered kapanış formundaki değer
 * @param taken vardiyanın start_package_count'u (bilinmiyorsa null)
 */
export function checkUndelivered(
  undelivered: number,
  taken: number | null | undefined
): PackageBoundResult {
  if (!Number.isFinite(undelivered) || undelivered < 0) {
    return { ok: false, code: "undelivered_invalid" };
  }
  if (taken !== null && taken !== undefined) {
    if (undelivered > taken) {
      return { ok: false, code: `undelivered_over:${undelivered}:${taken}` };
    }
    return { ok: true };
  }
  if (undelivered > MAX_SHIFT_PACKAGES) {
    return { ok: false, code: `undelivered_max:${MAX_SHIFT_PACKAGES}` };
  }
  return { ok: true };
}
