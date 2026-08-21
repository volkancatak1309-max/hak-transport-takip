import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { TENANT_TZ } from "@/lib/tz";

export const SUPPORTED_LOCALES = ["tr", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
/**
 * Çerezi olmayan ziyaretçinin gördüğü dil. HAK61'de Türkçe (şoförlerin dili);
 * Sendigo'da Almanca — yönetim ve belgeler Almanca yürüyor, panele yalnız
 * yönetici giriyor. Geçersiz değer sessizce Türkçeye düşer.
 */
const ENV_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim();
export const DEFAULT_LOCALE: Locale =
  ENV_LOCALE === "de" || ENV_LOCALE === "tr" ? ENV_LOCALE : "tr";
export const LOCALE_COOKIE = "hak_locale";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  if (v === "tr" || v === "de") return v;
  return DEFAULT_LOCALE;
}

/**
 * ⚠️ HATA DÜZELTMESİ (21.08.2026): geri çağırma ARGÜMANSIZ yazılmıştı.
 *
 * next-intl, `getTranslations({locale: "de"})` gibi AÇIK dil verilen
 * çağrılarda o dili buraya `locale` alanıyla geçirir (GetRequestConfigParams).
 * Argüman yok sayıldığı için her istek çereze düşüyordu: rapor kodu Almanca
 * istiyor, karşılığında panelin dili geliyordu. AZG PDF'i bu yüzden KARMA
 * çıkıyordu — şablon sabit Almanca, `t()`den geçen alanlar Türkçe.
 *
 * ⚠️ PANEL DAVRANIŞI DEĞİŞMEZ: panel bileşenleri dili AÇIKÇA vermiyor
 * (`useTranslations()` / `getTranslations()`), yani `istenen` undefined kalır
 * ve eskisi gibi çerez okunur. Değişen tek şey, dilini SÖYLEYEN çağrının
 * artık duyulması.
 */
export default getRequestConfig(async ({ locale: istenen }) => {
  const locale: Locale =
    istenen === "tr" || istenen === "de" ? istenen : await getLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: TENANT_TZ,
    now: new Date(),
  };
});
