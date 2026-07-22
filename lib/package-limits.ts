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
  // ALINAN BİLİNMİYORKEN GERİ > 0 KABUL EDİLMEZ (22.07.2026).
  // Canlı örnekler: Sercan Kalkanli (alınan boş, geri 1), Abdulhamit Muslu
  // (alınan boş, geri 87.189). Alınan sayı olmadan "geri getirilen" bir şey
  // ifade etmez — teslim edilen hesaplanamaz, oran denetlenemez. Şoförden
  // önce aldığı sayıyı isteriz; bu bir reddetme değil, eksik bilgi talebidir.
  if (undelivered > 0) {
    return { ok: false, code: "undelivered_no_total" };
  }
  if (undelivered > MAX_SHIFT_PACKAGES) {
    return { ok: false, code: `undelivered_max:${MAX_SHIFT_PACKAGES}` };
  }
  return { ok: true };
}

/**
 * MANTIK DENETİMİ — arayüz katmanı (şoför paneli + yönetici düzenleme).
 *
 * `checkUndelivered` sunucunun SON SÖZÜdür (reddeder). Bu fonksiyon ise
 * kullanıcıya ne söyleyeceğimizi belirler ve üç seviyesi vardır:
 *   • block   → devam edilemez, eksik/imkânsız veri
 *   • confirm → mümkün ama sıra dışı; SORULUR, engellenmez. Gerçekten bütün
 *               paketler geri gelmiş olabilir (araç arızası, kapalı adres).
 *               Sistemin işi şoförü yalanlamak değil, "emin misin?" demek.
 *   • ok      → sessiz geç
 *
 * Kural kaynağı tek: aynı fonksiyonu hem kapatma formu hem yönetici düzenleme
 * dialogu çağırır, böylece iki taraf aynı matematiği uygular.
 */
export type UndeliveredCheck =
  | { level: "ok" }
  | { level: "confirm"; code: "all_returned" | "many_returned" }
  | { level: "block"; code: "no_total" | "over" | "invalid" };

export function classifyUndelivered(
  undelivered: number | null,
  taken: number | null | undefined
): UndeliveredCheck {
  if (undelivered === null || !Number.isFinite(undelivered) || undelivered < 0) {
    return { level: "block", code: "invalid" };
  }
  if (taken === null || taken === undefined) {
    // Alınan girilmemiş: 0 geri sorun değil, 1+ geri eksik bilgidir.
    return undelivered > 0 ? { level: "block", code: "no_total" } : { level: "ok" };
  }
  if (undelivered > taken) return { level: "block", code: "over" };
  // Hiç teslim edilmemiş: matematiksel olarak geçerli ama günün tamamının
  // boşa gittiği anlamına gelir — mutlaka teyit edilmeli.
  if (taken > 0 && undelivered === taken) {
    return { level: "confirm", code: "all_returned" };
  }
  // Yarısından fazlası geri: olağandışı, yumuşak teyit.
  if (taken > 0 && undelivered > taken / 2) {
    return { level: "confirm", code: "many_returned" };
  }
  return { level: "ok" };
}
