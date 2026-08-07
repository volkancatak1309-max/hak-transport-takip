import "server-only";
import { getManagedFleet } from "@/lib/fleet-scope";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/request";
import { TENANT } from "@/lib/brand";

/**
 * Mobil yanıtlarındaki kullanıcı nesnesi — TEK KAYNAK.
 *
 * /login ve /me aynı şekli döndürmek zorunda; iki ayrı yerde kurulsaydı biri
 * alan eklerken diğeri geride kalırdı.
 */
export type MobileUser = {
  id: string;
  adSoyad: string;
  /** Türetilmiş: patron > filo şefi > şoför. */
  rol: "admin" | "fleet_chief" | "driver";
  isAdmin: boolean;
  isFleetChief: boolean;
  countsAsDriver: boolean;
  dil: Locale;
};

/**
 * DİL hakkında dürüst not: bu depoda kullanıcı BAŞINA uygulama dili tutan bir
 * kolon YOK. Tarayıcıda dil `hak_locale` çerezinden geliyor (i18n/request.ts),
 * mobilde öyle bir çerez olmayacak. `workers.telegram_locale` var ama o
 * ÖZELLİKLE Telegram bot dilidir; uygulama dili olarak kullanmak varsayım olur.
 * Bu yüzden kurulumun varsayılan dili döndürülüyor (HAK61 → tr, Sendigo → de).
 * Kullanıcı başına dil gerekirse yeni bir kolon ister — katman 1'in işi değil.
 */
export async function buildMobileUser(w: {
  id: string;
  name: string | null;
  is_admin: boolean;
  counts_as_driver: boolean | null;
}): Promise<MobileUser> {
  // Şeflik tek kaynaktan: getManagedFleet is_active'i de denetler ve enum
  // dışı değeri eler. Burada ikinci bir kopya kurmuyoruz.
  const fleet = await getManagedFleet(w.id);
  const isFleetChief = fleet !== null;
  return {
    id: w.id,
    adSoyad: w.name ?? "—",
    rol: w.is_admin ? "admin" : isFleetChief ? "fleet_chief" : "driver",
    isAdmin: w.is_admin === true,
    isFleetChief,
    countsAsDriver: w.counts_as_driver === true,
    dil: DEFAULT_LOCALE,
  };
}

/** /me'nin döndürdüğü kiracı kimliği — hangi dağıtıma bağlıyız. */
export function mobileTenant(): { kod: string; dil: Locale } {
  return { kod: TENANT, dil: DEFAULT_LOCALE };
}
