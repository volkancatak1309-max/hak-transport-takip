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

export default getRequestConfig(async () => {
  const locale = await getLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: TENANT_TZ,
    now: new Date(),
  };
});
