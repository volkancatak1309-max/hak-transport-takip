import "server-only";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/request";

/**
 * MOBİL İSTEĞİN DİLİ (03.10.2026, aksiyon kartı dili).
 *
 * Mobil istemcinin panel çerezi (`hak_locale`) yok; uçlar bugüne dek kurulumun varsayılan
 * dilini kullanıyordu (`lib/mobile-labels.ts` notu). Kullanıcının KENDİ dili şu sırayla:
 *   1) `?dil=tr|de|en` — açık istek;
 *   2) `Accept-Language` başlığının İLK etiketi (tr/de/en ise). iOS'ta sistemin ağ katmanı
 *      bu başlığı uygulamanın desteklediği dillerden (app.json `locales`: tr/de/en) ve cihaz
 *      dilinden KENDİLİĞİNDEN ekler [ÖLÇÜLMEDİ — cihazda doğrulanacak]; React Native
 *      Android'de eklenmez. Mobil istemci başlığı kendi uygulama diliyle açıkça gönderirse
 *      (yapılacaklar: `docs/runbook/aksiyon-kart-dili.md`) iki platform ve uygulama içi dil
 *      seçimi de çalışır;
 *   3) kurulumun varsayılan dili (`DEFAULT_LOCALE`) — bugünkü davranış, geriye dönük uyum.
 * Desteklenmeyen dil (ör. `fr`) 3'e düşer: sessizce başka bir dile çevrilmez.
 */
export function istekDili(req: Request): Locale {
  const destek = (v: string | null | undefined): Locale | null => {
    const kod = (v ?? "").trim().slice(0, 2).toLowerCase();
    return (SUPPORTED_LOCALES as readonly string[]).includes(kod) ? (kod as Locale) : null;
  };
  const acik = destek(new URL(req.url).searchParams.get("dil"));
  if (acik) return acik;
  const ilkEtiket = req.headers.get("accept-language")?.split(",")[0]?.split(";")[0];
  return destek(ilkEtiket) ?? DEFAULT_LOCALE;
}
