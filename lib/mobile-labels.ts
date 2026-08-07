import "server-only";
import { getTranslations } from "next-intl/server";
import { fleetLabel } from "@/lib/vehicle-ui";
import { DEFAULT_LOCALE } from "@/i18n/request";

/**
 * Mobil yanıtlardaki görünen etiketler — panelle AYNI kaynaktan.
 *
 * Panel `fleetLabel(fleet, t)` çağırıyor (lib/vehicle-ui.ts): önce kiracının
 * env ezmesi (FLEET_LABELS), yoksa i18n sözlüğü (`vehicles.fleet.*`). Mobilde
 * ikinci bir eşleme kurmak, kiracı etiketini değiştirdiğinde app'i panelden
 * ayrıştırırdı.
 *
 * DİL: mobil istemcinin `hak_locale` çerezi yok; kurulumun varsayılan dili
 * kullanılır (HAK61 → tr, Sendigo → de) — lib/mobile-user.ts'teki `dil` alanıyla
 * aynı kaynak, aynı gerekçe.
 */
export async function fleetLabeller(): Promise<(fleet: string) => string> {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: "vehicles",
  });
  return (fleet: string) => fleetLabel(fleet, t as unknown as (k: string) => string);
}
