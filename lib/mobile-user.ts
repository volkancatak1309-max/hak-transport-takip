import "server-only";
import { getManagedFleet } from "@/lib/fleet-scope";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/request";
import { TENANT } from "@/lib/brand";
import { kiraciAyarlari, type BirimSistemi } from "@/lib/tenant-settings";

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
 * mobilde öyle bir çerez olmayacak. Personel kaydında uygulama dili tutan
 * bir alan da yok; varsayarak seçmek ölçülmemiş bir karar olurdu.
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

/** Mobil yanıtlardaki kiracı nesnesi — TEK KAYNAK (/login ve /me aynısını döner). */
export type MobileTenant = {
  kod: string;
  dil: Locale;
  /** IANA saat dilimi, ör. "Europe/Vienna". Bkz. `saatDilimi` notu aşağıda. */
  saatDilimi: string;
  /**
   * ÖLÇÜ BİRİMİ — 'metric' | 'imperial' (migration 108, 19.09.2026).
   *
   * ⚠️ SUNUCU BU BAYRAĞA GÖRE ÇEVİRİM YAPMIYOR ve bu bilinçli: sayılar her
   * zaman metrik dönüyor (km · L · L/100km), bayrak istemciye NASIL
   * GÖSTERECEĞİNİ söylüyor. Sunucuda çevirseydik aynı alan kimi kiracıda mil
   * kimi kiracıda km taşırdı ve istemci hangisi olduğunu ancak bu bayrağa
   * bakarak bilebilirdi — yani bayrak yine gerekliydi, üstüne bir de
   * yuvarlama hatası birikirdi.
   *
   * Para birimi burada YOK: EUR sabit.
   */
  birimSistemi: BirimSistemi;
};

/**
 * /login ve /me'nin döndürdüğü kiracı kimliği — hangi dağıtıma bağlıyız.
 *
 * ── `saatDilimi` NEDEN BURADA (09.08.2026) ─────────────────────────────────
 * Mobil uygulama saatleri CİHAZIN dilimine göre çiziyordu: panelde 06:17 olan
 * vardiya UTC+3'teki bir telefonda 07:17 görünüyordu. Panelin sabitini mobil
 * tarafa KOPYALAMAK ikinci bir gerçek kaynağı üretirdi; onun yerine dilim
 * `lib/tz.ts`'ten — panelin de okuduğu tek kaynaktan — geçiliyor.
 *
 * ⚠️ HEM /login HEM /me DÖNER ve bu bilinçli: mobil yalnız /me'yi bekleseydi
 * ilk açılışta saatler cihaz diliminde çizilip yanıt gelince ZIPLAYACAKTI.
 */
export async function mobileTenant(): Promise<MobileTenant> {
  /**
   * ⚠️ ARTIK ASENKRON (19.09.2026). Saat dilimi ve ölçü birimi kiracı ayarı
   * oldu (migration 108) ve tablodan okunuyor. Senkron kalsaydı mobil, panelin
   * göstereceği dilimden BAŞKA bir dilim döndürürdü — 09.08.2026'da bu alanın
   * var olma sebebi olan kusurun aynısı, yalnız kaynağı farklı.
   *
   * `kiraciAyarlari()` 30 sn'lik süreç-içi önbellekli; sekiz çağıran uç başına
   * bir DB gidiş-gelişi ANLAMINA GELMEZ.
   */
  const ayar = await kiraciAyarlari();
  return {
    kod: TENANT,
    dil: DEFAULT_LOCALE,
    saatDilimi: ayar.saatDilimi,
    birimSistemi: ayar.birimSistemi,
  };
}
