/**
 * KURULUM MODU KATMANI — müşteri başına davranış ayarları (31.07.2026).
 *
 * `lib/brand.ts` uygulamanın nasıl GÖRÜNDÜĞÜNÜ, bu dosya nasıl ÇALIŞTIĞINI
 * belirler. İkisi ayrı: marka değişimi risksizdir, davranış değişimi değildir.
 *
 * ── DEĞİŞMEZLİK SÖZLEŞMESİ ─────────────────────────────────────────────────
 * Her ayarın varsayılanı, 31.07.2026 öncesindeki HAK61 sabitinin BİREBİR
 * kendisidir. Env tanımlı değilken bu modül bugünkü davranışı üretir; HAK61
 * Vercel projesine tek bir env eklenmez. `scripts/check-tenant-defaults.mjs`
 * her varsayılanı kayıt altına alınmış eski değerle karşılaştırır ve kayarsa
 * `npm run verify`'ı kırar. Sabit koddan kalkarken DEĞERİ değil yalnız
 * KAYNAĞI değişir.
 *
 * ── NEDEN NEXT_PUBLIC_ ─────────────────────────────────────────────────────
 * İstemciye ulaşan her ayar `NEXT_PUBLIC_` önekiyle okunur. Öneksiz env
 * tarayıcıda `undefined`'dır; o durumda ayar sessizce varsayılana düşer ve
 * "Sendigo'da kapalı olması gereken modül şoförün ekranında açılır" biçiminde,
 * yalnız üretimde görünen bir hata doğardı. Yalnız SUNUCUDA okunanlar
 * (vardiya otomatı, FLEET_EPOCH) öneksizdir.
 *
 * ── SUNUCU SON SÖZÜ SÖYLER ─────────────────────────────────────────────────
 * Bayraklar görünürlüğü kapatır; kapatılan modülün sunucu eylemleri de aynı
 * bayrağı kontrol eder (mevcut `LEAVES_ENABLED` deseni). Menüden link
 * kaldırmak yetki değildir.
 */

/** "true"/"1"/"yes" → true, "false"/"0"/"no" → false, tanımsız → varsayılan. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function envEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = process.env[name]?.trim().toLowerCase() as T | undefined;
  return raw && allowed.includes(raw) ? raw : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODÜL BAYRAKLARI
// Varsayılanlar 21.07.2026'da Volkan'ın verdiği kararların aynısı (eski
// lib/features.ts): HAK61 yakıt/masraf/bakım kullanmıyor, izin takvimi açık.
// ─────────────────────────────────────────────────────────────────────────────

/** Yakıt modülü (/admin/yakit, /panel/yakit). */
export const FUEL_ENABLED = envBool("NEXT_PUBLIC_FUEL_ENABLED", false);
/** Masraf modülü (/admin/masraflar, /panel/masraflar). */
export const EXPENSE_ENABLED = envBool("NEXT_PUBLIC_EXPENSE_ENABLED", false);
/** Bakım modülü (yakıt sayfasını paylaşır). */
export const MAINTENANCE_ENABLED = envBool("NEXT_PUBLIC_MAINTENANCE_ENABLED", false);
/**
 * İzin takvimi (/admin/izinler). ⚠️ AÇMADAN ÖNCE migration 031 çalıştırılmış
 * olmalı — tablo yoksa okuma boş döner ama YAZMA hata verir.
 */
export const LEAVES_ENABLED = envBool("NEXT_PUBLIC_LEAVES_ENABLED", true);

// ─────────────────────────────────────────────────────────────────────────────
// KURULUM MODU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ŞOFÖR PANELİ (/panel/*).
 *
 * Kapalıyken: şoför rotaları /admin'e yönlenir, giriş yalnız yöneticiye açıktır
 * ve üst çubukta şoför menüsü çıkmaz. Sendigo'da kimse telefondan girmiyor —
 * takip tamamen araç ekseninde.
 *
 * ⚠️ Kapalıyken vardiyayı BAŞLATIP BİTİRECEK bir insan kalmaz; bu yüzden
 * SHIFT_AUTO_END açık olmak ZORUNDADIR (aşağıda fail-closed doğrulanır).
 */
export const DRIVER_PANEL_ENABLED = envBool("NEXT_PUBLIC_DRIVER_PANEL_ENABLED", true);

/**
 * PAKET SAYACI (alınan / teslim edilen / teslim edilemeyen).
 *
 * HAK61 paket dağıtımı yapıyor ve vardiya kapanışının çekirdeği bu üç sayıdır.
 * Sendigo ilaç lojistiği: sevkiyat paket adediyle ölçülmüyor. Kapalıyken
 * kapanış formundaki alanlar, yönetici düzenleme dialogundaki karşılıkları ve
 * PDF/rapor sütunları görünmez; VERİ MODELİ AYNEN DURUR (kolonlar silinmez,
 * geçmiş kayıtlar okunabilir kalır).
 */
export const PACKAGES_ENABLED = envBool("NEXT_PUBLIC_PACKAGES_ENABLED", true);

/**
 * LENKZEIT UYARISI (4 sa ön uyarı / 4,5 sa zorunlu mola, VO (EG) 561/2006).
 *
 * lib/azg-rules.ts'e göre 2,5 t altı, sınır geçmeyen filoda AB sürüş-dinlenme
 * tüzüğü UYGULANMAZ — yani bu uyarı hukuken gereksiz. Yine de HAK61'de AÇIK
 * bırakıldı (Volkan, 31.07.2026): şoförler bu uyarıya alışkın ve kaldırmak
 * "HAK61'e dokunma" kuralının istisnası olurdu. Sendigo'da kapalı.
 */
export const LENKZEIT_WARNING_ENABLED = envBool(
  "NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED",
  true
);

/**
 * GÜVENLİK SKORU KALİBRASYONU.
 *
 * K sabiti (lib/metric-thresholds.ts) HAK61 filosunun canlı medyanına ve
 * HAK61 Teltonika eşik parametrelerine göre seçildi. Başka bir filoda aynı K
 * ile üretilen skor mutlak bir anlam taşımaz. Kapalıyken skor ham/görece
 * okunur, "kalibre edilmiş" iddiası taşımaz.
 */
export const SAFETY_SCORE_CALIBRATED = envBool(
  "NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED",
  true
);

/**
 * FİLO ETİKETLERİ. DB'deki kod adları (`bordo` / `mavi`) ve FLEET_STYLE
 * DEĞİŞMEZ — yalnız kullanıcıya gösterilen metin. Boş bırakılırsa i18n
 * sözlüğündeki bugünkü karşılıklar ("Bordo Filo" / "Mavi Filo") kullanılır.
 */
export const FLEET_LABELS: Record<string, string> = {
  bordo: process.env.NEXT_PUBLIC_FLEET_BORDO_LABEL?.trim() || "",
  mavi: process.env.NEXT_PUBLIC_FLEET_MAVI_LABEL?.trim() || "",
};

/**
 * KULLANILAN FİLOLAR — hangi filo kullanıcıya SEÇENEK olarak sunulur.
 *
 * 31.07.2026 (Sendigo kabul testi): tek filolu kurulumda Araçlar sayfasında
 * "Bordo Filo 0" çipi duruyordu — o filoya hiç araç girmeyecek, kavramın
 * kendisi o müşteride yok. Etiket env'i (yukarıdaki FLEET_LABELS) yalnız ADI
 * değiştiriyor, filoyu gizlemiyordu.
 *
 * DB'DEKİ KOD ADLARI DEĞİŞMEZ: `vehicles.fleet` hâlâ 'bordo'/'mavi' tutar ve
 * migration 023'ün CHECK kısıtı olduğu gibi kalır. Buradaki liste yalnız
 * ARAYÜZ süzgeci: gösterilmeyen filoya yeni araç atanamaz, ama veri düzeyinde
 * hiçbir şey kısıtlanmaz (eski kayıt varsa okunmaya devam eder).
 *
 * Varsayılan HAK61'in bugünkü hâli: iki filo da açık.
 */
export const ACTIVE_FLEETS: string[] = (() => {
  const raw = process.env.NEXT_PUBLIC_FLEETS?.trim();
  if (!raw) return ["bordo", "mavi"];
  const known = ["bordo", "mavi"];
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => known.includes(s));
  // Tanınmayan/boş liste sessizce filoyu yok etmesin — bugünkü davranışa döner.
  return picked.length > 0 ? picked : ["bordo", "mavi"];
})();

/** Bu filo arayüzde gösterilsin mi (bkz. ACTIVE_FLEETS). */
export function isFleetVisible(fleet: string | null | undefined): boolean {
  return fleet ? ACTIVE_FLEETS.includes(fleet) : true;
}

// ─────────────────────────────────────────────────────────────────────────────
// VARDİYA OTOMATI (yalnız sunucu — lib/auto-shift.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftStartTrigger = "depot_entry" | "first_ignition";
export type ShiftAutoEndMode = "off" | "depot_idle";

/**
 * VARDİYA BAŞLANGICI.
 *
 *  • `depot_entry`    — araç depo bölgesine girip kontağı AÇIKKEN bekliyorsa
 *                       mesai başlar (HAK61, 25.07.2026'dan beri).
 *  • `first_ignition` — Viyana gününün İLK kontak açılışı mesai başlangıcıdır.
 *                       Araçlar geceyi depoda geçiren filolar için: sabah
 *                       çalıştırma zaten mesai başlangıcıdır ve depo geofence'i
 *                       teğet geçme/telemetri boşluğu sorunlarına açık değildir.
 */
export const SHIFT_START_TRIGGER: ShiftStartTrigger = envEnum(
  "SHIFT_START_TRIGGER",
  ["depot_entry", "first_ignition"] as const,
  "depot_entry"
);

/**
 * OTOMATİK KAPANMA.
 *
 *  • `off`        — vardiyayı YALNIZ personel kapatır. 22.07.2026'da alınan ve
 *                   20 şoförü kilitleyen olaydan sonra konan kural (HAK61).
 *  • `depot_idle` — kontak kapalı + araç depoda + `SHIFT_AUTO_END_IDLE_MIN`
 *                   dakika hareketsizlik → vardiya kapanır.
 *
 * ⚠️ Şoför paneli kapalıyken `off` olamaz: kapatacak kimse kalmaz ve vardiyalar
 * gece boyu açık kalır. `assertTenantConfig()` bunu fail-closed denetler.
 */
export const SHIFT_AUTO_END: ShiftAutoEndMode = envEnum(
  "SHIFT_AUTO_END",
  ["off", "depot_idle"] as const,
  "off"
);

/**
 * `depot_idle` için hareketsizlik eşiği (dakika).
 *
 * Varsayılan 30, çünkü lib/auto-shift.ts'teki bugünkü sabit (uykuda duran
 * DEFAULT_IDLE_END_MINUTES) 30'dur ve değişmezlik sözleşmesi varsayılanın
 * BUGÜNKÜ değer olmasını gerektirir. Sendigo'nun 20 dakikası bir kod
 * varsayılanı değil, o kurulumun env satırıdır.
 */
export const SHIFT_AUTO_END_IDLE_MIN = envInt("SHIFT_AUTO_END_IDLE_MIN", 30);

/**
 * Araç gün sonuna kadar depoya dönmezse vardiya SON HAREKET anında kapanır —
 * gece boyu açık kalmaz. Yalnız `depot_idle` modunda geçerlidir.
 */
export const SHIFT_AUTO_END_MIDNIGHT_FALLBACK = envBool(
  "SHIFT_AUTO_END_MIDNIGHT_FALLBACK",
  true
);

/**
 * FİLO BAŞLANGIÇ TARİHİ — "tüm zamanlar" aralığının tabanı ve önceki-dönem
 * karşılaştırmasının alt sınırı (lib/analytics.ts). Bu tarihten önce veri yok
 * sayılır; yanlış olması veriyi bozmaz, yalnız anlamsız boş bir dönem üretir.
 */
export const FLEET_EPOCH_ISO =
  process.env.FLEET_EPOCH?.trim() || "2026-06-01T00:00:00.000Z";

/**
 * KURULUM TUTARLILIK DENETİMİ — fail-closed.
 *
 * Yanlış env bileşimi sessiz bir veri kaybına dönüşebilir (şoför paneli yok +
 * otomatik kapanma yok = hiç kapanmayan vardiyalar). Bunu üretimde fark etmek
 * yerine kurulumda patlatıyoruz. Sunucu açılışında bir kez çağrılır.
 */
export function assertTenantConfig(): void {
  if (!DRIVER_PANEL_ENABLED && SHIFT_AUTO_END === "off") {
    throw new Error(
      "Kurulum hatası: NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false iken SHIFT_AUTO_END='off' olamaz — " +
        "vardiyayı kapatacak kimse kalmaz. SHIFT_AUTO_END='depot_idle' yapın."
    );
  }
}
