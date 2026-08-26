/**
 * SAKLAMA — saf katman (migration 090).
 *
 * Bu dosyada VERİTABANI YOK. Uyarı eşiği, veri kategorileri, aralık kuralları
 * ve elle silme kapısı burada; sorgular lib/saklama-db.ts'te.
 *
 * ═══ 🔴 OTOMATİK SİLME YOK ═══
 *
 * Sistem **yalnız hesaplar ve UYARIR**. Silmeye bir insan karar verir,
 * /admin/saklama ekranından, aralığı kendisi seçerek, çift onayla.
 *
 * Neden: saklama süresi ve silme kararı **veri sorumlusunundur** (müşteri);
 * Galzura veri İŞLEYENDİR. Ürünün bir kiracının verisini kendi takvimine göre
 * silmesi, işleyenin sorumlu yerine karar vermesi olurdu.
 *
 * ═══ NEDEN 90 GÜNLÜK UYARI EŞİĞİ ═══
 *
 * Tam gerekçe docs/SAKLAMA-POLITIKASI.md'de. Özet:
 *   · CMR Md. 32 — uluslararası taşımada 1 yıllık zamanaşımı, ama teslimat
 *     anlaşmazlığının KANITI ePOD'dur (değişmez, silinmez), ham iz değil.
 *   · CNIL ham konum için 2 ay diyor.
 *   · İtalya (Garante, 01/2025) 180 günü cezalandırdı — 50.000 €.
 *   · Almanya 400 ve 150 günü orantısız buldu.
 *
 * ⚠️ Bu 90, YASAL bir çıpa DEĞİL, ürünün uyarı çıpasıdır. Yasal çıpa
 * `saklama_esikleri` tablosunda durur ve **bugün boştur** — eşikler ayrı bir
 * araştırma turuyla kaynaklı doldurulacak. Uydurma bir gün sayısı DACH
 * müşterisine giderse sorumluluk doğar.
 */

export const VARSAYILAN_UYARI_GUN = 90;
export const UYARI_GUN_MIN = 1;
export const UYARI_GUN_MAX = 3650;

export const GUN_MS = 86_400_000;

/** Çift onayın ikinci ayağı: kullanıcı bu metni ELLE yazar. */
export const SIL_ONAY_METNI = "SIL";

/** Silme sebebi bu uzunluğun altındaysa kabul edilmez. */
export const SEBEP_MIN_UZUNLUK = 10;

// ═══════════════════════════ KATEGORİLER ══════════════════════════════

/**
 * ÜÇ KATEGORİ.
 *
 *   'kisisel'       → uyarı çıkar, ELLE silinebilir
 *   'arac'          → serbest, uyarı çıkmaz
 *   'yasal_zorunlu' → SİLİNEMEZ; arayüz silme seçeneğini GÖSTERMEZ
 *
 * ═══ HUKUKİ DAYANAK — AYRIM "ARAÇ MI ŞOFÖR MÜ" DEĞİL ═══
 *
 * GPS izi hukuken ŞOFÖRÜN kişisel verisidir, aracın değil. Aracın firmaya ait
 * olması bunu DEĞİŞTİRMEZ. Doğru soru **"o an araçta kim vardı"**: bir konum
 * dizisi, o dizideki kişinin nerede olduğunu, ne zaman durduğunu, ne kadar
 * çalıştığını anlatır.
 */
export type VeriKategorisi = "kisisel" | "arac" | "yasal_zorunlu";

export type KategoriSatiri = {
  tabloAdi: string;
  kolonAdi: string | null;
  kategori: VeriKategorisi;
  gerekce: string;
};

/**
 * Bu kategori ELLE silinebilir mi?
 *
 * ⚠️ Arayüz bunu SİLME DÜĞMESİNİ RENDER ETMEDEN ÖNCE sorar. 'yasal_zorunlu'
 * için düğme hiç çizilmez — "denendi ve reddedildi" değil, "seçenek yok".
 * Reddetmek bir hatadır ve hata mesajı okunmayabilir; göstermemek bir
 * tasarımdır.
 */
export function silinebilirMi(kategori: VeriKategorisi): boolean {
  return kategori === "kisisel" || kategori === "arac";
}

/** Uyarı yalnız KİŞİSEL veri için çıkar — araç künyesi kimseyi izlemiyor. */
export function uyariCikarMi(kategori: VeriKategorisi): boolean {
  return kategori === "kisisel";
}

// ═══════════════════════════ YASAL ÇIPA ═══════════════════════════════

/**
 * ÜLKE BAZLI YASAL EŞİK.
 *
 * ⚠️ `esikGun: null` = **doğrulanmış çıpa YOK**. 0 değil, "sınırsız" değil —
 * bilinmiyor. Arayüz bu durumda hiçbir sayı göstermez.
 */
export type YasalEsik = {
  ulkeKodu: string;
  veriTuru: string;
  esikGun: number | null;
  yasalDayanak: string | null;
  kaynakUrl: string | null;
  dogrulanmaTarihi: string | null;
};

/**
 * Eşik gösterilebilir mi? Sayı varsa dayanağı da olmak ZORUNDA.
 *
 * Kaynaksız bir eşik uydurma bir eşiktir; ürün onu basmaz.
 */
export function esikGosterilebilir(e: YasalEsik | null): boolean {
  return (
    !!e &&
    e.esikGun !== null &&
    !!e.yasalDayanak &&
    !!e.kaynakUrl &&
    !!e.dogrulanmaTarihi
  );
}

// ═══════════════════════════ KİRACI AYARI ═════════════════════════════

export type SaklamaAyari = {
  uyariGun: number;
  ulkeKodu: string;
  gerekce: string | null;
  guncellendiAt: string | null;
  tabloYok: boolean;
};

export const VARSAYILAN_SAKLAMA_AYARI: SaklamaAyari = {
  uyariGun: VARSAYILAN_UYARI_GUN,
  ulkeKodu: "AT",
  gerekce: null,
  guncellendiAt: null,
  tabloYok: true,
};

export type AyarHatasi = "gun_araligi" | "ulke_kodu";

export function ayarDenetle(uyariGun: number, ulkeKodu: string): AyarHatasi | null {
  if (!Number.isFinite(uyariGun) || !Number.isInteger(uyariGun)) return "gun_araligi";
  if (uyariGun < UYARI_GUN_MIN || uyariGun > UYARI_GUN_MAX) return "gun_araligi";
  if (!/^[A-Z]{2}$/.test(ulkeKodu)) return "ulke_kodu";
  return null;
}

/** Bu andan geriye `uyariGun` kadar: bundan eskisi UYARIYA girer. */
export function uyariKesimi(uyariGun: number, simdi: Date = new Date()): Date {
  const gun = Math.max(UYARI_GUN_MIN, Math.min(UYARI_GUN_MAX, Math.round(uyariGun)));
  return new Date(simdi.getTime() - gun * GUN_MS);
}

// ═══════════════════════════ UYARI ════════════════════════════════════

/**
 * UYARI — sistemin ürettiği TEK çıktı. Hiçbir şey silmez.
 *
 * `yasalEsikGun: null` bir eksiklik değil bir BEYANDIR: "bu ülke/veri türü
 * için doğrulanmış bir çıpamız yok". Ekran o zaman yalnız kiracının kendi
 * eşiğini gösterir ve yasal çıpa satırına "doğrulanmadı" yazar.
 */
export type SaklamaUyarisi = {
  tabloAdi: string;
  kategori: VeriKategorisi;
  satirSayisi: number;
  enEski: string | null;
  enEskiGun: number | null;
  uyariGun: number;
  ulkeKodu: string;
  yasalEsikGun: number | null;
  yasalDayanak: string | null;
  kaynakUrl: string | null;
};

/** Uyarı var mı? Sıfır satır = uyarı yok. */
export function uyariVarMi(u: SaklamaUyarisi): boolean {
  return u.satirSayisi > 0 && uyariCikarMi(u.kategori);
}

/**
 * Uyarı ne kadar acil — 0..100.
 *
 * Eksen SATIR SAYISI değil YAŞ: 1.000 satır 91 günlükse bu bir hatırlatma,
 * 400 günlükse Almanya'nın orantısız bulduğu bandın içindesiniz demektir.
 * Satır sayısı yalnız kaç veri olduğunu söyler, ne kadar geciktiğinizi değil.
 */
export function uyariAciliyeti(u: SaklamaUyarisi): number {
  if (!uyariVarMi(u) || u.enEskiGun === null) return 0;
  const asim = u.enEskiGun - u.uyariGun;
  if (asim <= 0) return 0;
  // Eşiğin bir katı kadar aşım = tavan. 90 günlük eşikte 180 gün → 100.
  return Math.min(100, Math.round((asim / Math.max(1, u.uyariGun)) * 100));
}

// ═══════════════════════════ ARALIK SEÇİMİ ════════════════════════════

/**
 * SİLME ARALIĞI — yönetici seçer.
 *
 * 'hafta' · 'ay' · 'ozel' (iki tarih arası). Üçü de aynı yapıya iner;
 * ekranın üç ayrı seçenek sunması bir KOLAYLIK, üç ayrı kod yolu değil.
 */
export type AralikTuru = "hafta" | "ay" | "ozel";

export type Aralik = { bas: Date; bit: Date };

/** Pazartesi 00:00 (UTC) başlayan ISO haftası. */
export function haftaAraligi(icindeki: Date): Aralik {
  const d = new Date(Date.UTC(icindeki.getUTCFullYear(), icindeki.getUTCMonth(), icindeki.getUTCDate()));
  // getUTCDay: 0=Pazar. ISO'da hafta Pazartesi başlar.
  const gun = (d.getUTCDay() + 6) % 7;
  const bas = new Date(d.getTime() - gun * GUN_MS);
  return { bas, bit: new Date(bas.getTime() + 7 * GUN_MS) };
}

export function ayAraligi(icindeki: Date): Aralik {
  const bas = new Date(Date.UTC(icindeki.getUTCFullYear(), icindeki.getUTCMonth(), 1));
  const bit = new Date(Date.UTC(icindeki.getUTCFullYear(), icindeki.getUTCMonth() + 1, 1));
  return { bas, bit };
}

/**
 * Ekranın üç seçeneği tek yapıya iner.
 *
 * `hafta`/`ay` bir KOLAYLIK: yönetici "geçen ay" derken tarih yazmak zorunda
 * kalmasın. Üçü de aynı `Aralik` üretir ve aynı kapıdan geçer.
 *
 * ⚠️ SAF KATMANDA, sunucu eylemi dosyasında DEĞİL: `"use server"` dosyasının
 * her export'u async olmak zorunda (Next kuralı) ve bu fonksiyon veritabanına
 * hiç dokunmuyor — buraya ait.
 *
 * ⚠️ `ozel` türünde BİTİŞ GÜNÜ DAHİL: kullanıcı "1–7 Nisan" derken 7 Nisan'ı
 * kastediyor; yarı-açık aralığa çevirmek için bir gün ekleniyor.
 */
export function araligiCoz(
  tur: AralikTuru,
  girdi: { referans?: string; bas?: string; bit?: string }
): Aralik | null {
  if (tur === "hafta" || tur === "ay") {
    if (!girdi.referans) return null;
    const d = new Date(`${girdi.referans}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return tur === "hafta" ? haftaAraligi(d) : ayAraligi(d);
  }
  if (!girdi.bas || !girdi.bit) return null;
  const bas = new Date(`${girdi.bas}T00:00:00Z`);
  const bit = new Date(new Date(`${girdi.bit}T00:00:00Z`).getTime() + GUN_MS);
  if (Number.isNaN(bas.getTime()) || Number.isNaN(bit.getTime())) return null;
  return { bas, bit };
}

export type AralikHatasi =
  | "gecersiz_tarih"
  | "ters_aralik"
  | "gelecek"
  | "cok_uzun";

/** Tek seferde silinebilecek en uzun aralık. */
export const ARALIK_MAX_GUN = 400;

/**
 * Aralık kabul edilebilir mi? null = kabul.
 *
 * ⚠️ `gelecek` kapısı: bitişi bugünden ileri bir aralık, HENÜZ YAZILMAMIŞ
 * veriyi de kapsardı ve silme sırasında akan telemetriyi yerdi. Bitiş en geç
 * ŞİMDİ olabilir.
 *
 * ⚠️ `cok_uzun` kapısı bir güvenlik ağı: 400 gün, Almanya'nın orantısız
 * bulduğu süredir ve tek tıkla ondan fazlasını silmek "yanlış tarih girdim"
 * hatasını felakete çevirir. Daha fazlası için ikinci bir seçim gerekir.
 */
export function aralikDenetle(a: Aralik, simdi: Date = new Date()): AralikHatasi | null {
  if (!(a.bas instanceof Date) || !(a.bit instanceof Date)) return "gecersiz_tarih";
  if (Number.isNaN(a.bas.getTime()) || Number.isNaN(a.bit.getTime())) return "gecersiz_tarih";
  if (a.bit.getTime() <= a.bas.getTime()) return "ters_aralik";
  if (a.bit.getTime() > simdi.getTime()) return "gelecek";
  if ((a.bit.getTime() - a.bas.getTime()) / GUN_MS > ARALIK_MAX_GUN) return "cok_uzun";
  return null;
}

// ═══════════════════════════ AY ANAHTARLARI ═══════════════════════════

/**
 * ⚠️ ÖZET GRANÜLERLİĞİ **AY** — ÖLÇÜMLE seçildi, tercihle değil.
 *
 * buildFuelReport'un 28 günlük gerçek cevabı 2.602,6 L. Aynı pencere
 * parçalanıp toplandığında (HAK61 canlı, 26.08.2026):
 *
 *     1 gün → 3.009,9 L  (+%15,6)      ← günlük özet
 *     7 gün → 2.714,0 L   (+%4,3)
 *    28 gün → 2.602,5 L   (−%0,0)      ← aylık özet
 *
 * İkinci ölçüm (14 gün): gerçek 1.194,98 L, günlük toplam 1.540,1 L = +%28,9.
 *
 * SEBEP: yakıt motoru (027 + 052) ardışık okuma DİZİSİ üzerinde çalışıyor —
 * 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme. Gün sınırı
 * diziyi kesiyor; gece yarısını aşan dolum iki kez sayılıyor.
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
export function aySiniri(ay: string): Aralik {
  const [y, m] = ay.split("-").map(Number);
  return { bas: new Date(Date.UTC(y, m - 1, 1)), bit: new Date(Date.UTC(y, m, 1)) };
}

// ═══════════════════════ ELLE SİLME KAPISI ════════════════════════════

export type SilmeEngeli =
  | "kategori_yasal"
  | "aralik_gecersiz"
  | "ozet_eksik"
  | "km_donmadi"
  | "omur_izi_yok"
  | "onay_yanlis"
  | "sebep_kisa";

export type SilmeKapisi = {
  izin: boolean;
  engel: SilmeEngeli | null;
  ayrinti: string;
};

/**
 * 🔴 ELLE SİLME KAPISI — ALTI ŞART.
 *
 * Otomatik silme kaldırıldı ama ön koşullar KALDI: bir insanın "sil" demesi,
 * silmenin raporu bozmasını engellemez. Ölçüldü — silme 10 yüzeyden 7'sini
 * sessizce yanlış sayı üretir hâle getiriyordu.
 *
 * ⚠️ SIRA ŞARTI (km_donmadi): vardiya km yargısı ham silinmeden ÖNCE
 * dondurulmalı. Sonra dondurulursa ham zaten gitmiş olur ve dondurma her
 * sıfır-farklı vardiyaya sessizce "ölçülemedi" yazar — düzeltmek istediği
 * hatayı kalıcılaştırır.
 *
 * ⚠️ `kategori_yasal` buraya SON SAVUNMA olarak konuldu; ilk savunma arayüzün
 * düğmeyi hiç çizmemesi. İki katman bilinçli: bir gün başka bir çağıran
 * eklenirse kapı yine kapalı olsun.
 */
export function silmeKapisi(girdi: {
  kategori: VeriKategorisi;
  aralikHatasi: AralikHatasi | null;
  ozetiEksikAylar: string[];
  kmDonmamisVardiya: number;
  omurIziSatir: number;
  onayMetni: string;
  sebep: string;
}): SilmeKapisi {
  if (!silinebilirMi(girdi.kategori)) {
    return {
      izin: false,
      engel: "kategori_yasal",
      ayrinti: `kategori=${girdi.kategori} — bu veri silinemez`,
    };
  }
  if (girdi.aralikHatasi) {
    return { izin: false, engel: "aralik_gecersiz", ayrinti: girdi.aralikHatasi };
  }
  if (girdi.onayMetni.trim().toUpperCase() !== SIL_ONAY_METNI) {
    return { izin: false, engel: "onay_yanlis", ayrinti: `"${SIL_ONAY_METNI}" yazılmalı` };
  }
  if (girdi.sebep.trim().length < SEBEP_MIN_UZUNLUK) {
    return { izin: false, engel: "sebep_kisa", ayrinti: `en az ${SEBEP_MIN_UZUNLUK} karakter` };
  }
  if (girdi.omurIziSatir <= 0) {
    return {
      izin: false,
      engel: "omur_izi_yok",
      ayrinti: "vehicle_telemetry_lifetime boş — silme sonrası sessiz araç uyarısı kaybolur",
    };
  }
  if (girdi.kmDonmamisVardiya > 0) {
    return {
      izin: false,
      engel: "km_donmadi",
      ayrinti: `aralıkta ${girdi.kmDonmamisVardiya} vardiyanın km yargısı dondurulmadı`,
    };
  }
  if (girdi.ozetiEksikAylar.length > 0) {
    return {
      izin: false,
      engel: "ozet_eksik",
      ayrinti: `özeti yazılmamış ay: ${girdi.ozetiEksikAylar.join(", ")}`,
    };
  }
  return { izin: true, engel: null, ayrinti: "" };
}

// ═══════════════════════ KURTARILAMAYAN YÜZEY ════════════════════════

/**
 * ⚠️ ROTA GEÇMİŞİ ÖZETTEN KURTARILAMAZ — ve bu bilinçli.
 *
 * Bir ayın konum dizisini saklamak "ham izi sakla" demenin başka bir yolu
 * olurdu; politikanın kendisini boşa çıkarırdı. Rota, ham silindiğinde
 * GERÇEKTEN kaybolur.
 *
 * Ürünün borcu onu kurtarmak değil, **kaybolduğunu söylemek**: ekran "bu
 * tarih saklama süresinin dışında" der, boş harita göstermez.
 */
export const KURTARILAMAYAN_YUZEYLER = ["rota_gecmisi"] as const;

// ═══════════════════════ RAPOR KAPSAM ŞERİDİ ═════════════════════════

/**
 * 🔴 "ÖLÇÜLEMEDİ ≠ 0" KURALININ SAKLAMA AYAĞI.
 *
 * ÖLÇÜLDÜ (26.08.2026, HAK61 canlı): veri OLMAYAN bir pencerede
 * (01.03→01.04.2026)
 *
 *     buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç
 *     buildCostReport → totalEur:0 · fuelEur:0
 *     co2Panosu       → kg:null · 29 plaka "ölçülemedi"    ← DOĞRU olan bu
 *
 * Yakıt ve maliyet raporu ölçülmemiş bir dönemi "0 L · 0,00 €" diye OLGU gibi
 * basıyordu. Silme yapıldığında bu kusur, gerçek veriyi uydurma sıfıra
 * çeviren bir makineye dönüşür.
 *
 * ⚠️ Çıpa artık `uyariKesimi` DEĞİL, verinin GERÇEK başlangıcıdır: otomatik
 * silme olmadığı için "90 günden eski veri yok" varsayımı YANLIŞ olur —
 * kimse silmemişse veri orada durur ve rapor doğru çalışır.
 */
export type KapsamTuru = "icinde" | "kismen_disi" | "tamamen_disi";

export type PencereKapsami = {
  tur: KapsamTuru;
  /** Verinin başlangıcından önce kalan gün sayısı. 0 = kayıp yok. */
  kayipGun: number;
  olculebilirBas: string | null;
  /** Elde GERÇEKTEN bulunan en eski ham kayıt. null = hiç ham veri yok. */
  veriBaslangici: string | null;
};

export function pencereKapsami(
  bas: Date,
  bit: Date,
  veriBaslangici: Date | null
): PencereKapsami {
  // Ham veri hiç yoksa kapsam sorusu sorulamaz — rapor kendi "ölçülemedi"
  // yolunu kullanır, şerit yanıltıcı olurdu.
  if (!veriBaslangici) {
    return { tur: "icinde", kayipGun: 0, olculebilirBas: bas.toISOString(), veriBaslangici: null };
  }
  const v = veriBaslangici.getTime();
  const vIso = veriBaslangici.toISOString();
  if (bas.getTime() >= v) {
    return { tur: "icinde", kayipGun: 0, olculebilirBas: bas.toISOString(), veriBaslangici: vIso };
  }
  if (bit.getTime() <= v) {
    return {
      tur: "tamamen_disi",
      kayipGun: Math.max(1, Math.ceil((bit.getTime() - bas.getTime()) / GUN_MS)),
      olculebilirBas: null,
      veriBaslangici: vIso,
    };
  }
  return {
    tur: "kismen_disi",
    kayipGun: Math.max(1, Math.ceil((v - bas.getTime()) / GUN_MS)),
    olculebilirBas: vIso,
    veriBaslangici: vIso,
  };
}
