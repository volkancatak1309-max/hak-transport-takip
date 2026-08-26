/**
 * HAM TELEMETRİ SAKLAMA POLİTİKASI — saf katman (migration 090).
 *
 * Bu dosyada VERİTABANI YOK. Süre kuralları, kesim tarihi hesabı ve
 * "istenen pencere saklama sınırını aşıyor mu" sorusunun cevabı burada;
 * sorgular lib/saklama-db.ts'te.
 *
 * ═══ NEDEN 90 GÜN ═══
 *
 * Tam gerekçe docs/SAKLAMA-POLITIKASI.md'de (müşteriye ve denetime
 * gösterilecek belge). Özet:
 *
 *   · CMR Md. 32 — uluslararası taşımada 1 yıllık zamanaşımı. Teslimat
 *     anlaşmazlığı tipik olarak ilk haftalarda çıkar; çeyrek yıllık pay
 *     operasyonel ihtiyacı karşılar.
 *   · CNIL ham konum verisi için 2 ay diyor. 90 gün bunun ÜSTÜNDE — bu
 *     yüzden gerekçe yazılı olmak zorunda, ve zaten yazılı.
 *   · İtalya (Garante, Ocak 2025) 180 günü cezalandırdı — 50.000 €.
 *   · Almanya 400 ve 150 günü orantısız buldu.
 *
 * 90 gün bu bandın alt yarısında. Rakiplerin varsayılanı: Geotab 2 YIL,
 * Verizon Connect 13 ay, Samsara "müşteri olduğun sürece" (bkz.
 * docs/RAKIP-GDPR.md). Ayrıştığımız nokta tam olarak bu: onlar uzun
 * varsayılan koyup sorumluluğu müşteriye devrediyor.
 */

export const VARSAYILAN_HAM_GUN = 90;

/**
 * ALT SINIR 30 — daha kısası ürünün KENDİ varsayılan pencerelerini kırar
 * (CO₂ panosu 30 gün, sefer kârlılığı 30 gün). Ayar, ekranın altını oyamaz.
 */
export const HAM_GUN_MIN = 30;

/**
 * ÜST SINIR 400 — Almanya'nın açıkça orantısız bulduğu sayı. Ürün onu
 * yazdırmaz; sınırın kendisi bir beyandır.
 */
export const HAM_GUN_MAX = 400;

/**
 * GEREKÇE EŞİĞİ — bunun üstü yazılı gerekçe ister.
 *
 * ⚠️ Eşik, varsayılanın KENDİSİ (90). Yani varsayılanı bir gün bile aşan
 * kiracı sebebini yazmak zorunda. Denetimde sorulacak ilk soru bu olacak.
 */
export const GEREKCE_ESIGI = 90;

export const GUN_MS = 86_400_000;

export type SaklamaAyari = {
  hamGun: number;
  silmeAcik: boolean;
  gerekce: string | null;
  guncellendiAt: string | null;
  tabloYok: boolean;
};

export const VARSAYILAN_SAKLAMA_AYARI: SaklamaAyari = {
  hamGun: VARSAYILAN_HAM_GUN,
  // 🔴 FAIL-CLOSED: ayar tablosu okunamıyorsa bile silme KAPALI kabul edilir.
  silmeAcik: false,
  gerekce: null,
  guncellendiAt: null,
  tabloYok: true,
};

// ═══════════════════════════ AYAR DOĞRULAMA ═══════════════════════════

export type AyarHatasi =
  | "gun_araligi"
  | "gerekce_gerekli"
  | "gerekce_kisa";

/** Gerekçenin anlamlı olması için en az bu kadar karakter. */
export const GEREKCE_MIN_UZUNLUK = 20;

/**
 * Ayarı kabul edilebilir mi? null = kabul.
 *
 * ⚠️ `gerekce_gerekli` kapısı ürünün bu turdaki ana fikri: uzun saklamayı
 * YASAKLAMIYORUZ (bazı kiracının gerçek sebebi olabilir), ama sebepsiz
 * uzatmayı imkânsız kılıyoruz.
 */
export function ayarDenetle(hamGun: number, gerekce: string | null): AyarHatasi | null {
  if (!Number.isFinite(hamGun) || !Number.isInteger(hamGun)) return "gun_araligi";
  if (hamGun < HAM_GUN_MIN || hamGun > HAM_GUN_MAX) return "gun_araligi";
  if (hamGun > GEREKCE_ESIGI) {
    const g = (gerekce ?? "").trim();
    if (!g) return "gerekce_gerekli";
    if (g.length < GEREKCE_MIN_UZUNLUK) return "gerekce_kisa";
  }
  return null;
}

/** Ekranda gösterilecek uzatma uyarısı gerekiyor mu? */
export function uzatmaUyarisiGerekli(hamGun: number): boolean {
  return hamGun > GEREKCE_ESIGI;
}

// ═══════════════════════════ KESİM TARİHİ ═════════════════════════════

/** Bu andan geriye `hamGun` kadar: bundan eski ham satırlar silinebilir. */
export function kesimTarihi(hamGun: number, simdi: Date = new Date()): Date {
  const gun = Math.max(HAM_GUN_MIN, Math.min(HAM_GUN_MAX, Math.round(hamGun)));
  return new Date(simdi.getTime() - gun * GUN_MS);
}

// ═══════════════════════ PENCERE KAPSAM DENETİMİ ══════════════════════

/**
 * 🔴 ÜRÜNÜN EN ÖNEMLİ SÖZLEŞMESİ.
 *
 * Bugün ölçüldü (26.08.2026, HAK61 canlı): veri OLMAYAN bir pencerede
 * (01.03→01.04.2026)
 *
 *     buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç
 *     buildCostReport → totalEur:0 · fuelEur:0
 *     co2Panosu       → kg:null · 29 plaka "ölçülemedi"    ✅ DOĞRU olan bu
 *
 * Yani yakıt ve maliyet raporu ölçülmemiş bir dönemi "0 L · 0,00 €" diye
 * OLGU gibi basıyor. Silme açılırsa bu kusur, gerçek veriyi uydurma sıfıra
 * çeviren bir makineye dönüşür.
 *
 * Bu fonksiyon her rapor yüzeyinin çağırıp sonucu KULLANICIYA SÖYLEMESİ
 * için var. "ölçülemedi ≠ 0" kuralının saklama ayağı.
 */
export type KapsamTuru = "icinde" | "kismen_disi" | "tamamen_disi";

export type PencereKapsami = {
  tur: KapsamTuru;
  /** Kesimden önce kalan gün sayısı (kayıp kısım). 0 = kayıp yok. */
  kayipGun: number;
  /** Pencerenin ölçülebilen kısmı — hiç yoksa null. */
  olculebilirBas: string | null;
  kesim: string;
};

export function pencereKapsami(
  bas: Date,
  bit: Date,
  kesim: Date
): PencereKapsami {
  const kesimIso = kesim.toISOString();
  if (bas.getTime() >= kesim.getTime()) {
    return { tur: "icinde", kayipGun: 0, olculebilirBas: bas.toISOString(), kesim: kesimIso };
  }
  if (bit.getTime() <= kesim.getTime()) {
    return {
      tur: "tamamen_disi",
      kayipGun: Math.max(1, Math.ceil((bit.getTime() - bas.getTime()) / GUN_MS)),
      olculebilirBas: null,
      kesim: kesimIso,
    };
  }
  return {
    tur: "kismen_disi",
    kayipGun: Math.max(1, Math.ceil((kesim.getTime() - bas.getTime()) / GUN_MS)),
    olculebilirBas: kesimIso,
    kesim: kesimIso,
  };
}

// ═══════════════════════════ AY ANAHTARLARI ═══════════════════════════

/**
 * ⚠️ ÖZET GRANÜLERLİĞİ **AY** — ÖLÇÜMLE seçildi, tercihle değil.
 *
 * buildFuelReport'un 28 günlük gerçek cevabı 2.602,6 L. Aynı pencere
 * parçalanıp toplandığında (HAK61 canlı, 26.08.2026):
 *
 *     1 gün → 3.009,9 L  (+%15,6)      ← günlük özet
 *     2 gün → 2.986,0 L  (+%14,7)
 *     7 gün → 2.714,0 L   (+%4,3)
 *    14 gün → 2.591,9 L   (−%0,4)
 *    28 gün → 2.602,5 L   (−%0,0)      ← aylık özet
 *
 * İkinci ölçüm (14 gün): gerçek 1.194,98 L, günlük toplam 1.540,1 L = +%28,9.
 *
 * SEBEP: yakıt motoru (027 + 052) ardışık okuma DİZİSİ üzerinde çalışıyor —
 * 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme, dolum
 * tespiti. Gün sınırı diziyi kesiyor; gece yarısını aşan dolum iki kez
 * sayılıyor.
 */
export function ayBasi(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** [bas, bit) aralığına DEĞEN bütün ayların ilk günleri, artan sırada. */
export function aylar(bas: Date, bit: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(bas.getUTCFullYear(), bas.getUTCMonth(), 1));
  const son = new Date(Date.UTC(bit.getUTCFullYear(), bit.getUTCMonth(), 1));
  while (d.getTime() <= son.getTime()) {
    out.push(ayBasi(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Ayın [başlangıç, bitiş) sınırları — özet motoruna TEK pencere olarak verilir. */
export function aySiniri(ay: string): { bas: Date; bit: Date } {
  const [y, m] = ay.split("-").map(Number);
  return {
    bas: new Date(Date.UTC(y, m - 1, 1)),
    bit: new Date(Date.UTC(y, m, 1)),
  };
}

/**
 * Bir ay TAMAMEN kesimin gerisinde mi? Yalnız böyle aylar silinebilir.
 *
 * ⚠️ Kesimi ORTADAN BÖLEN ay silinemez: yarısı silinip yarısı kalan bir ay,
 * özetiyle de ham verisiyle de tutarsız olurdu.
 */
export function aySilinebilir(ay: string, kesim: Date): boolean {
  return aySiniri(ay).bit.getTime() <= kesim.getTime();
}

// ═══════════════════════ SİLME ÖN KOŞULLARI ══════════════════════════

export type SilmeEngeli =
  | "ayar_kapali"
  | "ozet_eksik"
  | "km_donmadi"
  | "omur_izi_yok"
  | "silinecek_ay_yok";

export type SilmeKapisi = {
  izin: boolean;
  engel: SilmeEngeli | null;
  /** Silinmeye hazır ay anahtarları. */
  hazirAylar: string[];
  ayrinti: string;
};

/**
 * 🔴 FAIL-CLOSED SİLME KAPISI.
 *
 * Silmenin başlaması için DÖRT şartın hepsi gerekir. Biri bile eksikse
 * silme reddedilir ve SEBEBİ döner — sessizce hiçbir şey yapmamak, çalışan
 * bir temizlik sanılırdı.
 *
 * ⚠️ SIRA ŞARTI (km_dondu): vardiya km yargısı ham silinmeden ÖNCE
 * dondurulmalı. Sonra dondurulursa ham zaten gitmiş olur ve backfill her
 * sıfır-farklı vardiyaya sessizce "ölçülemedi" yazar — düzeltmek istediği
 * hatayı kalıcılaştırır.
 */
export function silmeKapisi(girdi: {
  silmeAcik: boolean;
  hazirAylar: string[];
  ozetiEksikAylar: string[];
  kmDonmamisVardiya: number;
  omurIziSatir: number;
}): SilmeKapisi {
  const bos = { hazirAylar: [] as string[] };
  if (!girdi.silmeAcik) {
    return { izin: false, engel: "ayar_kapali", ...bos, ayrinti: "tenant_saklama.silme_acik = false" };
  }
  if (girdi.omurIziSatir <= 0) {
    return {
      izin: false,
      engel: "omur_izi_yok",
      ...bos,
      ayrinti: "vehicle_telemetry_lifetime boş — sessiz araç uyarısı silme sonrası kaybolur",
    };
  }
  if (girdi.kmDonmamisVardiya > 0) {
    return {
      izin: false,
      engel: "km_donmadi",
      ...bos,
      ayrinti: `${girdi.kmDonmamisVardiya} vardiyanın km yargısı dondurulmadı`,
    };
  }
  if (girdi.ozetiEksikAylar.length > 0) {
    return {
      izin: false,
      engel: "ozet_eksik",
      ...bos,
      ayrinti: `özeti yazılmamış ay: ${girdi.ozetiEksikAylar.join(", ")}`,
    };
  }
  if (girdi.hazirAylar.length === 0) {
    return { izin: false, engel: "silinecek_ay_yok", ...bos, ayrinti: "kesimin tamamen gerisinde ay yok" };
  }
  return { izin: true, engel: null, hazirAylar: girdi.hazirAylar, ayrinti: "" };
}

// ═══════════════════════ KURTARILAMAYAN YÜZEY ════════════════════════

/**
 * ⚠️ ROTA GEÇMİŞİ ÖZETTEN KURTARILAMAZ — ve bu bilinçli.
 *
 * Bir ayın konum dizisini saklamak "ham izi sakla" demenin başka bir yolu
 * olurdu; politikanın kendisini boşa çıkarırdı. Rota, saklama süresi
 * dolduğunda GERÇEKTEN kaybolur.
 *
 * Ürünün borcu onu kurtarmak değil, **kaybolduğunu söylemek**: ekran
 * "bu tarih saklama süresinin dışında" der, boş harita göstermez.
 */
export const KURTARILAMAYAN_YUZEYLER = ["rota_gecmisi"] as const;
