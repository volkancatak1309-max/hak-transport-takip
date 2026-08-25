import { AZG_DAILY_MAX_MS, AZG_NIGHT_DAILY_MAX_MS } from "@/lib/azg-rules";

/**
 * MEVZUAT ERKEN UYARI — SAF KATMAN (migration 086).
 *
 * Sorgu yok, `server-only` yok, saat okuması yok: girdi verilir, çıktı alınır.
 *
 * ═══ BU MODÜL UYUM GARANTİSİ DEĞİL, ERKEN UYARIDIR ═══
 *
 * Filoda takograf yok. Ölçebildiğimiz iki ayrı büyüklük var:
 *
 *   ÇALIŞMA SÜRESİ — ÖLÇÜLÜR (vardiya + kayıtlı mola). AZG/ArbZG tam olarak
 *                    bunu düzenler.
 *   SÜRÜŞ SÜRESİ   — TAHMİN (telemetri hareketi). AB 561/2006 bunu düzenler
 *                    ama takograf olmadan üretilen sayı kanıt değildir.
 *
 * Ayrım `OlcumTemeli` ile HER kayıtta ve her ekranda taşınır. Gerekçenin
 * tamamı ve hata payı ölçümleri migration 086 başlığında.
 */

const DK = 60_000;
const SA = 3_600_000;

export type KuralSeti = "AT_AZG" | "DE_ARBZG" | "EU_561";
export type OlcumTemeli = "calisma_suresi" | "surus_tahmini";
export type Kademe = "erken" | "yaklasti" | "son" | "ihlal";

/** Kademeler daralarak: 60 → 30 → 15 → ihlal. */
export const KADEME_SIRASI: Kademe[] = ["erken", "yaklasti", "son", "ihlal"];

/**
 * VARSAYILAN KADEMELER (dakika).
 *
 * 15 dk UYDURMA DEĞİL: akıllı takograf sürücüyü 4,5 saatlik kesintisiz
 * sürüşe **15 dakika kala** uyarır — 165/2014 düzeninin kendi standardı.
 * Ürün o eşiği taban alıp üstüne iki erken kademe koyuyor, çünkü bizim
 * uyarımız cihazda değil telefonda ve şoförün park yeri bulması zaman ister.
 */
export const VARSAYILAN_KADEME = { erken: 60, yaklasti: 30, son: 15 } as const;

/**
 * 🔴 KAPANMAMIŞ VARDİYA EŞİĞİ — 24 SAAT.
 *
 * CANLI KOŞUMDA YAKALANDI (HAK61, 25.08.2026): 9 açık vardiyanın 8'i 12
 * saatten, 7'si 36 SAATTEN uzundu. Bunlar 37 saattir çalışan insanlar değil,
 * KAPANMAMIŞ KAYITLAR — otomatik kapanış 22.07.2026'da bilerek kaldırıldı ve
 * vardiyayı yalnız personel kapatıyor, bazen günler sonra.
 *
 * Bu satırlara "ihlal" demek 8 şoföre anında 24 sahte bildirim gönderirdi ve
 * özelliğin güvenilirliğini ilk gün bitirirdi — 22.07'de panelin 20 şoförü
 * kırmızı göstermesiyle aynı hata sınıfı.
 *
 * EŞİK NEDEN 24 SAAT:
 *   · Hiçbir kural seti 24 saatlik bir çalışma gününe izin vermiyor
 *     (AT 12 sa · DE 10 sa · AB sürüş 9-10 sa + zorunlu dinlenme). 24 saati
 *     aşan bir kayıt tanım gereği tek bir çalışma günü olamaz.
 *   · ÖLÇÜLDÜ: canlı açık vardiyalarda 11,9 · 14,7 saatten sonra 36,9'a
 *     ATLAYAN bir boşluk var. 24 saat bu boşluğun ortasından geçiyor:
 *     14,7 saatlik gerçek (ve AT'de ihlal olan) vardiya DEĞERLENDİRİLMEYE
 *     devam ediyor, 37 saatlik kayıtlar eleniyor.
 *   · ÖLÇÜLDÜ: 90 günde kapanmış 583 vardiyanın %8,2'si 24 saati aşıyor
 *     (medyan 9,1 · p90 16,9 · max 133,1 saat). Maliyet motoru aynı olguyu
 *     `hourCapShifts` ile zaten kayda geçiriyor.
 *
 * ⚠️ BU SATIRLAR GİZLENMİYOR: "kapanmamış kayıt" olarak AYRI gösteriliyor ve
 * yöneticiye asıl yapılacak iş söyleniyor — vardiyayı kapat.
 */
export const VARDIYA_BAYAT_MS = 24 * 3_600_000;

// ══════════════════════════════════════════════════════════════════════════
// KURAL SETLERİ
// ══════════════════════════════════════════════════════════════════════════

export type KuralTanimi = {
  /** Kod adı — `mevzuat_uyarilari.kural` bu değeri saklar. */
  ad: string;
  /** Hangi büyüklüğe bakıyor. */
  temel: OlcumTemeli;
  /** Eşik (ms). Gece tavanı gibi koşullu eşikler `esikSec` ile gelir. */
  esikMs: number;
  /** Gece penceresine değen günde geçerli eşik (varsa). */
  geceEsikMs?: number;
  /** Hukuki dayanak — ekranda ZORUNLU görünür. */
  dayanak: string;
  /**
   * Bu kural bir MOLA yükümlülüğü mü (eşiği aşınca mola gerekir) yoksa
   * TAVAN mı (eşiği aşmak ihlaldir)?
   */
  tur: "tavan" | "mola";
  /** Mola kuralıysa: gereken asgari mola (dakika). */
  molaDk?: number;
};

/**
 * AVUSTURYA — Arbeitszeitgesetz. ÇALIŞMA süresi ekseni.
 *
 * Eşikler `lib/azg-rules.ts`ten ithal ediliyor, KOPYALANMIYOR: iki dosyada
 * iki farklı 12 saat olsaydı rapor ile canlı katman ayrışırdı ve ayrışma
 * sessiz olurdu.
 */
export const AT_AZG: KuralTanimi[] = [
  {
    ad: "gunluk_tavan",
    temel: "calisma_suresi",
    esikMs: AZG_DAILY_MAX_MS,
    geceEsikMs: AZG_NIGHT_DAILY_MAX_MS,
    dayanak: "§ 9 Abs. 1 AZG · § 14 Abs. 2 (gece 10 sa)",
    tur: "tavan",
  },
  {
    ad: "mola_6sa",
    temel: "calisma_suresi",
    esikMs: 6 * SA,
    dayanak: "§ 13c Abs. 1 AZG (6 sa üstü → 30 dk)",
    tur: "mola",
    molaDk: 30,
  },
  {
    ad: "mola_9sa",
    temel: "calisma_suresi",
    esikMs: 9 * SA,
    dayanak: "§ 13c Abs. 1 AZG (9 sa üstü → 45 dk)",
    tur: "mola",
    molaDk: 45,
  },
];

/**
 * ALMANYA — Arbeitszeitgesetz. ÇALIŞMA süresi ekseni.
 *
 * ⚠️ AVUSTURYA'DAN EN KESKİN FARK GÜNLÜK TAVAN: § 3 ArbZG günlük 8 saat der
 * ve **10 saate** kadar uzatmaya yalnız "24 hafta / 6 takvim ayı ortalaması
 * 8 saati aşmazsa" izin verir. Avusturya'da tavan 12 saat (§ 9 Abs. 1).
 * Aynı vardiya Almanya'da ihlal, Avusturya'da temiz olabilir — kural setini
 * kiracıya seçtirmenin sebebi tam olarak bu.
 *
 * ⚠️ 8 SAATLİK NORMAL EŞİK BURADA UYARI OLARAK KULLANILMIYOR: § 3'ün 8 saati
 * ORTALAMA üzerinden yükümlülük doğurur, tek bir günün 8'i aşması TEK BAŞINA
 * ihlal değildir. Tek güne bakan bir motorun ihlal diyebileceği tek sayı
 * 10 saattir. Ortalama denetimi geçmişe dönük raporun işidir.
 */
export const DE_ARBZG: KuralTanimi[] = [
  {
    ad: "gunluk_tavan",
    temel: "calisma_suresi",
    esikMs: 10 * SA,
    dayanak: "§ 3 ArbZG (8 sa; 24 hafta ortalaması korunursa 10 sa)",
    tur: "tavan",
  },
  {
    ad: "mola_6sa",
    temel: "calisma_suresi",
    esikMs: 6 * SA,
    dayanak: "§ 4 ArbZG (>6–9 sa → 30 dk)",
    tur: "mola",
    molaDk: 30,
  },
  {
    ad: "mola_9sa",
    temel: "calisma_suresi",
    esikMs: 9 * SA,
    dayanak: "§ 4 ArbZG (>9 sa → 45 dk)",
    tur: "mola",
    molaDk: 45,
  },
];

/**
 * AB 561/2006 — SÜRÜŞ süresi ekseni. TAHMİN.
 *
 * ⚠️ KAPSAM (Art. 2): yük >3,5 t · yolcu >9 kişi. 01.07.2026'dan beri
 * ULUSLARARASI taşıma ve kabotajda >2,5 t da kapsamda (2020/1054) ve akıllı
 * takograf zorunlu. Yurt içi taşıma kapsam dışı.
 *
 * ⚠️ Bu set yalnız kiracı AÇIKÇA seçerse çalışır. HAK61 için ölçüldü
 * (Volkan teyidi 22.07.2026): araçlar 2,5 t altında ve sınır geçmiyor →
 * 561/2006 uygulanmaz.
 */
export const EU_561: KuralTanimi[] = [
  {
    ad: "surus_molasi",
    temel: "surus_tahmini",
    esikMs: 4.5 * SA,
    dayanak: "Art. 7 · 561/2006 (4,5 sa sürüş → 45 dk; 15+30 bölünebilir)",
    tur: "mola",
    molaDk: 45,
  },
  {
    ad: "gunluk_surus",
    temel: "surus_tahmini",
    esikMs: 9 * SA,
    dayanak: "Art. 6(1) · 561/2006 (günlük 9 sa; haftada 2 kez 10 sa)",
    tur: "tavan",
  },
];

export const KURAL_SETLERI: Record<KuralSeti, KuralTanimi[]> = {
  AT_AZG,
  DE_ARBZG,
  EU_561,
};

/** Setin kullandığı eksen — ekran başlığı ve uyarı metni buna göre değişir. */
export function setinTemeli(set: KuralSeti): OlcumTemeli {
  return set === "EU_561" ? "surus_tahmini" : "calisma_suresi";
}

// ══════════════════════════════════════════════════════════════════════════
// KALAN SÜRE
// ══════════════════════════════════════════════════════════════════════════

export type OlcumGirdi = {
  /**
   * Vardiya `VARDIYA_BAYAT_MS`ten uzun süredir açık mı. true → kayıt
   * kapanmamıştır; hiçbir kural değerlendirilmez, uyarı gitmez.
   */
  vardiyaBayat?: boolean;
  /**
   * ÖLÇÜLEN çalışma süresi (ms) — vardiya süresi eksi KAYITLI mola.
   * null → vardiya yok / ölçülemedi. 0 DEĞİL.
   */
  calismaMs: number | null;
  /** Vardiya gece penceresine (00:00–04:00) değiyor mu — AT tavanını indirir. */
  gece: boolean;
  /** Kayıtlı mola (dk). null → KAYIT YOK (mola verilmedi anlamına GELMEZ). */
  molaDk: number | null;
  /**
   * TAHMİN edilen kesintisiz sürüş süresi (ms). null → telemetri yok →
   * ölçülemedi. Yalnız EU_561 + `surusTahmini` açıkken doldurulur.
   */
  surusMs: number | null;
  /** Telemetri boşluğu (ms) — ne sürüş ne durak sayılabilen band. */
  surusBelirsizMs: number | null;
};

export type KuralDurumu = {
  kural: string;
  temel: OlcumTemeli;
  dayanak: string;
  tur: "tavan" | "mola";
  /** Geçerli eşik (dk) — gece tavanı uygulanmışsa o. */
  esikDk: number;
  /** Ölçülen/tahmin edilen değer (dk). null → ölçülemedi. */
  olculenDk: number | null;
  /** Eşiğe kalan dakika. Negatifse eşik AŞILMIŞ. null → ölçülemedi. */
  kalanDk: number | null;
  /** Bu anda hangi kademe geçerli. null → hiçbiri (henüz uzak) ya da ölçülemedi. */
  kademe: Kademe | null;
  /** Mola kuralıysa gereken asgari mola (dk). */
  gerekenMolaDk: number | null;
  /** Mola yükümlülüğü kayıtlı molayla KARŞILANMIŞ mı. null → kayıt yok. */
  molaKarsilandi: boolean | null;
  /** Sürüş tahmininin belirsizlik bandı (dk). Çalışma ekseninde null. */
  belirsizDk: number | null;
  /** Neden ölçülemedi — "0" ile karışmasın diye ayrı alan. */
  olculemediSebep: string | null;
};

export type KademeAyari = { erken: number; yaklasti: number; son: number };

/** Kalan süreye göre kademe. Eşik aşıldıysa 'ihlal'. */
export function kademeSec(kalanDk: number, ayar: KademeAyari): Kademe | null {
  if (kalanDk < 0) return "ihlal";
  if (kalanDk <= ayar.son) return "son";
  if (kalanDk <= ayar.yaklasti) return "yaklasti";
  if (kalanDk <= ayar.erken) return "erken";
  return null;
}

/**
 * BİR KURALIN CANLI DURUMU.
 *
 * ⚠️ ÖLÇÜLEMEYEN DEĞER `null` DÖNER, SIFIR DEĞİL. "0 dk çalıştı" ile
 * "çalıştığını ölçemedik" aynı ekranda aynı görünürse kullanıcı ikisini de
 * ölçüm sanar (lib/km-quality.ts dersi).
 */
export function kuralDurumu(
  k: KuralTanimi,
  g: OlcumGirdi,
  ayar: KademeAyari
): KuralDurumu {
  const esikMs = k.geceEsikMs !== undefined && g.gece ? k.geceEsikMs : k.esikMs;
  const esikDk = Math.round(esikMs / DK);

  /**
   * KAPANMAMIŞ KAYIT DEĞERLENDİRİLMEZ. Ne zaman durduğunu bilmiyoruz;
   * "şu an 37 saattir çalışıyor" demek uydurma olurdu (bkz. VARDIYA_BAYAT_MS).
   */
  const olculenMs = g.vardiyaBayat
    ? null
    : k.temel === "calisma_suresi"
      ? g.calismaMs
      : g.surusMs;
  const sebep =
    olculenMs !== null
      ? null
      : g.vardiyaBayat
        ? "vardiya_bayat"
        : k.temel === "calisma_suresi"
          ? "vardiya_yok"
          : "telemetri_yok";

  if (olculenMs === null) {
    return {
      kural: k.ad,
      temel: k.temel,
      dayanak: k.dayanak,
      tur: k.tur,
      esikDk,
      olculenDk: null,
      kalanDk: null,
      kademe: null,
      gerekenMolaDk: k.molaDk ?? null,
      molaKarsilandi: null,
      belirsizDk:
        k.temel === "surus_tahmini" && g.surusBelirsizMs !== null
          ? Math.round(g.surusBelirsizMs / DK)
          : null,
      olculemediSebep: sebep,
    };
  }

  const olculenDk = Math.round(olculenMs / DK);
  const kalanDk = esikDk - olculenDk;

  /**
   * MOLA KURALINDA "KARŞILANDI" ÜÇÜNCÜ BİR DURUMDUR.
   *
   * ÖLÇÜLDÜ (HAK61, 30 gün): 6 saati aşan 391 vardiyanın yalnız 150'sinde
   * mola kaydı var. Kayıt yokluğunu "mola vermedi" saymak 241 sahte ihlal
   * üretirdi; "verdi" saymak ise uyarıyı susturur. Üçüncü durum: BİLİNMİYOR.
   */
  const molaKarsilandi =
    k.tur !== "mola" || k.molaDk === undefined
      ? null
      : g.molaDk === null
        ? null
        : g.molaDk >= k.molaDk;

  /**
   * Mola yükümlülüğü KARŞILANDIYSA kademe üretilmez: şoför zaten molasını
   * vermiş, ona "molaya gir" demek gürültüdür.
   */
  const kademe = molaKarsilandi === true ? null : kademeSec(kalanDk, ayar);

  return {
    kural: k.ad,
    temel: k.temel,
    dayanak: k.dayanak,
    tur: k.tur,
    esikDk,
    olculenDk,
    kalanDk,
    kademe,
    gerekenMolaDk: k.molaDk ?? null,
    molaKarsilandi,
    belirsizDk:
      k.temel === "surus_tahmini" && g.surusBelirsizMs !== null
        ? Math.round(g.surusBelirsizMs / DK)
        : null,
    olculemediSebep: null,
  };
}

export type SoforDurumu = {
  workerId: string;
  ad: string;
  entryId: string | null;
  kuralSeti: KuralSeti;
  kurallar: KuralDurumu[];
  /** En kritik kademe (ihlal > son > yaklasti > erken). null → risk yok. */
  enKritik: Kademe | null;
  /** En yakın eşiğe kalan dakika. null → hiçbiri ölçülemedi. */
  enYakinKalanDk: number | null;
  /** Mola kaydı olmayan bir mola kuralı var mı — ekranda rozet. */
  molaKaydiYok: boolean;
  /** Vardiya 24 saatten uzun süredir açık — kayıt kapanmamış, uyarı gitmez. */
  vardiyaBayat: boolean;
};

const KADEME_AGIRLIK: Record<Kademe, number> = {
  ihlal: 4,
  son: 3,
  yaklasti: 2,
  erken: 1,
};

/** Bir şoförün tüm kurallardaki durumunu tek satıra indirir. */
export function soforDurumu(
  workerId: string,
  ad: string,
  entryId: string | null,
  kuralSeti: KuralSeti,
  kurallar: KuralDurumu[],
  vardiyaBayat = false
): SoforDurumu {
  let enKritik: Kademe | null = null;
  for (const k of kurallar) {
    if (!k.kademe) continue;
    if (!enKritik || KADEME_AGIRLIK[k.kademe] > KADEME_AGIRLIK[enKritik]) {
      enKritik = k.kademe;
    }
  }

  const kalanlar = kurallar
    .map((k) => k.kalanDk)
    .filter((x): x is number => x !== null && x >= 0);

  return {
    workerId,
    ad,
    entryId,
    kuralSeti,
    kurallar,
    enKritik,
    enYakinKalanDk: kalanlar.length ? Math.min(...kalanlar) : null,
    molaKaydiYok: kurallar.some((k) => k.tur === "mola" && k.molaKarsilandi === null && k.olculenDk !== null),
    vardiyaBayat,
  };
}

/**
 * UYARI METNİ — şoförün telefonunda görecek olduğu cümle.
 *
 * ⚠️ SÜRÜŞ TAHMİNİNE DAYANAN UYARI BUNU SÖYLER. "Tahmini" kelimesi metinden
 * çıkarılamaz: takograf olmadan üretilmiş bir sayıyı kesin gibi bildirmek,
 * şoförü yanlış bir güvenle yola devam ettirir.
 */
export function uyariMetni(k: KuralDurumu, kademe: Kademe): { baslik: string; govde: string } {
  const tahmin = k.temel === "surus_tahmini" ? " (tahmini)" : "";
  const kalan = k.kalanDk ?? 0;

  if (kademe === "ihlal") {
    return {
      baslik: k.tur === "mola" ? "Mola zamanı geçti" : "Yasal süre aşıldı",
      govde:
        k.tur === "mola"
          ? `${k.esikDk / 60} saati doldurdunuz${tahmin} — ${k.gerekenMolaDk} dakika mola gerekiyor. ${k.dayanak}`
          : `Günlük ${k.esikDk / 60} saatlik sınır aşıldı${tahmin}. ${k.dayanak}`,
    };
  }

  return {
    baslik:
      k.tur === "mola"
        ? `${kalan} dakika sonra zorunlu mola`
        : `${kalan} dakika yasal süreniz kaldı`,
    govde:
      k.tur === "mola"
        ? `${k.esikDk / 60} saate ${kalan} dakika kaldı${tahmin}; sonrasında ${k.gerekenMolaDk} dakika mola gerekiyor. ${k.dayanak}`
        : `Günlük sınıra ${kalan} dakika kaldı${tahmin}. ${k.dayanak}`,
  };
}
