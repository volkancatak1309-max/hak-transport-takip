/**
 * SEFER BAZLI KÂRLILIK — SAF KATMAN (migration 085).
 *
 * Bu dosyada sorgu YOK, `server-only` YOK, saat okuması YOK. Girdi verilir,
 * çıktı alınır — betikten de sunucudan da aynı şekilde sınanabilir.
 *
 * ═══ ÜRETTİĞİMİZ SAYI "NET KÂR" DEĞİL, "KATKI PAYI" ═══
 *
 *      katkı payı = gelir − (atfedilebilen yakıt + atfedilebilen işçilik)
 *
 * Araç sabit gideri (€/gün) BİLEREK dışarıda. Bir günün sabit giderini o
 * günün seferlerine bölmek — hangi anahtarla olursa olsun — PAYLAŞTIRMADIR,
 * ölçüm değil, ve kârlılık SIRALAMASINI sessizce değiştirir. Gerekçenin
 * tamamı migration 085 başlığında.
 *
 * Atfedilemeyen kalem gizlenmez: `AtifDurumu` her kalem için ayrı taşınır ve
 * ekranda ayrı bir satır olarak görünür.
 */

/** Bugün desteklenen tarife tabanları (bkz. 085 Ölçüm 1). */
export const GELIR_MODELLERI = ["sefer", "km", "paket", "saat"] as const;
export type GelirModeli = (typeof GELIR_MODELLERI)[number];

/** Miktarın kaynağı — ekranda ETİKET olarak zorunlu. */
export type MiktarKaynak = "elle" | "olculdu";

/**
 * Bir maliyet kaleminin sefere atfedilebilirliği.
 *
 * `olculdu`     kalem bu sefer için ölçüldü, sayı gerçek.
 * `olculemedi`  atfedilebilir bir kalem ama BU seferde ölçüm yok
 *               (odometre kenarı bayat, pencere yok…). null döner, 0 DEĞİL.
 * `atfedilemez` kalemin kendisi sefer eksenine inmiyor (araç sabit gideri).
 */
export type AtifDurumu = "olculdu" | "olculemedi" | "atfedilemez";

/** Sefer km'sinin neden ölçülemediği — "0 km" ile karıştırılmasın diye. */
export type KmOlcumDurumu =
  | "olculdu"
  | "arac_yok"
  | "pencere_yok"
  | "uc_okumasi_yok"
  | "kenar_bayat"
  | "fark_yok";

/**
 * ODOMETRE UÇ OKUMASININ PENCERE KENARINA AZAMİ UZAKLIĞI.
 *
 * ÖLÇÜLDÜ (HAK61, 14 gün, 40 pencere / 80 uç): medyan 0,1 dk · p75 4,2 dk ·
 * p90 249,8 dk. 15 dk eşiği uçların %81,6'sını geçiriyor; 60 dk'ya çıkarmak
 * yalnız +3,9 puan getiriyor ama 13 saate kadar bayat okumayı kabul ediyor —
 * o okuma BAŞKA bir seferin km'sini içerir.
 */
export const ODO_KENAR_ESIK_MS = 15 * 60 * 1000;

/** Zarar eden müşteri kuralının penceresi ve asgari örneklemi. */
export const ZARAR_PENCERE_GUN = 30;
export const ZARAR_MIN_SEFER = 3;

// ═══════════════════════════ GELİR ═══════════════════════════════════════

export type GelirSatiri = {
  id: string;
  durakId: string | null;
  model: GelirModeli;
  birimFiyat: number;
  miktar: number;
  tutarEur: number;
  miktarKaynak: MiktarKaynak;
  aciklama: string | null;
};

/**
 * Tutarı birim fiyat × miktardan üretir.
 *
 * ⚠️ Veritabanında `tutar_eur` ÜRETİLMİŞ kolondur; bu fonksiyon onun aynası
 * DEĞİL, form önizlemesi içindir. İkisinin aynı yuvarlamayı yapması şart:
 * `round(x, 2)` — Postgres `round(numeric, 2)` yarıyı yukarı yuvarlar
 * (half-up), JS `Math.round` de öyle. Negatif tutar yok (CHECK >= 0).
 */
export function gelirTutari(birimFiyat: number, miktar: number): number {
  if (!Number.isFinite(birimFiyat) || !Number.isFinite(miktar)) return 0;
  if (birimFiyat < 0 || miktar < 0) return 0;
  return Math.round(birimFiyat * miktar * 100) / 100;
}

/** Seferin toplam geliri — sefer düzeyi + durak düzeyi satırların TOPLAMI. */
export function toplamGelir(satirlar: GelirSatiri[]): number {
  return Math.round(satirlar.reduce((a, s) => a + s.tutarEur, 0) * 100) / 100;
}

// ═══════════════════════════ MALİYET ═════════════════════════════════════

/** Bir maliyet kaleminin sefer eksenindeki hâli. */
export type MaliyetKalemi = {
  /** Kalem tutarı — `durum !== "olculdu"` ise HER ZAMAN null. */
  eur: number | null;
  durum: AtifDurumu;
  /** Kalemin dayandığı ölçüm (km, saat…) — ekranda kanıt olarak görünür. */
  olcum: number | null;
  birim: string;
};

export type SeferMaliyeti = {
  yakit: MaliyetKalemi;
  iscilik: MaliyetKalemi;
  /** Araç sabit gideri — HER ZAMAN `atfedilemez`. */
  sabit: MaliyetKalemi;
  /** Atfedilebilen kalemlerin toplamı. Hiçbiri ölçülemediyse null. */
  atfedilenEur: number | null;
  /** Kaç kalem ölçülemedi — ekranda "eksik" rozetinin paydası. */
  olculemeyenKalem: number;
};

export type MaliyetGirdi = {
  /** Odometre penceresinden ölçülen km. null → ölçülemedi. */
  km: number | null;
  kmDurum: KmOlcumDurumu;
  /** Seferin çalışma saati (AZG tavanı UYGULANMIŞ). null → pencere yok. */
  saat: number | null;
  /** Tavana çarptı mı — ekranda gösterilir. */
  saatTavanUygulandi: boolean;
  lPer100Km: number;
  fuelEurPerL: number;
  laborEurPerHour: number;
};

/**
 * Sefer maliyeti — üç kalem, üç ayrı atıf durumu.
 *
 * Yakıt MODELDEN türer (km × L/100km × €/L), ölçülen litreden değil: ölçülen
 * litre yalnız bir araç altkümesinde var ve o küme km'nin kümesiyle aynı
 * değil. Aynı gerekçe `lib/cost-model.ts`'te filo ekseninde de yazılı —
 * SEFER EKSENİNDE İKİNCİ BİR YAKIT GERÇEĞİ ÜRETMİYORUZ.
 */
export function seferMaliyetiHesapla(g: MaliyetGirdi): SeferMaliyeti {
  const yakit: MaliyetKalemi =
    g.km !== null && g.km > 0
      ? {
          eur: ((g.km * g.lPer100Km) / 100) * g.fuelEurPerL,
          durum: "olculdu",
          olcum: g.km,
          birim: "km",
        }
      : { eur: null, durum: "olculemedi", olcum: null, birim: "km" };

  const iscilik: MaliyetKalemi =
    g.saat !== null && g.saat > 0
      ? { eur: g.saat * g.laborEurPerHour, durum: "olculdu", olcum: g.saat, birim: "saat" }
      : { eur: null, durum: "olculemedi", olcum: null, birim: "saat" };

  /**
   * SABİT GİDER — ATFEDİLEMEZ, HİÇBİR KOŞULDA.
   *
   * "Günde tek sefer varsa tamamını ona yükleyelim" seçeneği de reddedildi:
   * o zaman bazı seferler sabit gider taşır bazıları taşımaz ve seferler
   * birbiriyle kıyaslanamaz hâle gelir. Kıyaslanabilirlik bu ekranın tek
   * varlık sebebi.
   */
  const sabit: MaliyetKalemi = {
    eur: null,
    durum: "atfedilemez",
    olcum: null,
    birim: "gün",
  };

  const olculenler = [yakit, iscilik].filter((k) => k.durum === "olculdu");
  return {
    yakit,
    iscilik,
    sabit,
    atfedilenEur:
      olculenler.length === 0
        ? null
        : olculenler.reduce((a, k) => a + (k.eur ?? 0), 0),
    olculemeyenKalem: [yakit, iscilik].filter((k) => k.durum === "olculemedi").length,
  };
}

// ═══════════════════════════ KATKI PAYI ══════════════════════════════════

export type SeferKarliligi = {
  gelirEur: number;
  gelirSatiri: number;
  maliyet: SeferMaliyeti;
  /** gelir − atfedilen maliyet. Maliyetin HİÇBİR kalemi ölçülemediyse null. */
  katkiPayiEur: number | null;
  /** katkı payı / gelir (0-1). Gelir 0 ise null — sıfıra bölme değil, anlamsız. */
  marj: number | null;
  /**
   * KISMİ ÖLÇÜM UYARISI: en az bir kalem ölçüldü ama en az biri ölçülemedi.
   * Bu durumda katkı payı GERÇEĞİNDEN YÜKSEK çıkar — ekran bunu söylemek
   * zorunda, yoksa eksik maliyet kâr gibi okunur.
   */
  eksikMaliyet: boolean;
};

export function seferKarliligiHesapla(
  gelirSatirlari: GelirSatiri[],
  maliyet: SeferMaliyeti
): SeferKarliligi {
  const gelirEur = toplamGelir(gelirSatirlari);
  const katkiPayiEur =
    maliyet.atfedilenEur === null ? null : Math.round((gelirEur - maliyet.atfedilenEur) * 100) / 100;

  return {
    gelirEur,
    gelirSatiri: gelirSatirlari.length,
    maliyet,
    katkiPayiEur,
    marj: gelirEur > 0 && katkiPayiEur !== null ? katkiPayiEur / gelirEur : null,
    eksikMaliyet: maliyet.atfedilenEur !== null && maliyet.olculemeyenKalem > 0,
  };
}

// ═══════════════════════════ TOPLAMA ═════════════════════════════════════

export type KarlilikSatiri = {
  /** Toplama ekseninin kimliği (müşteri/araç/şoför/bölge id'si). */
  id: string | null;
  ad: string;
  seferSayisi: number;
  gelirEur: number;
  /** Ölçülebilen maliyetin toplamı. */
  maliyetEur: number;
  katkiPayiEur: number;
  marj: number | null;
  /** Katkı payı hesabına HİÇ maliyet girmemiş sefer sayısı — kapsama kanıtı. */
  maliyetsizSefer: number;
  /** En az bir kalemi eksik ölçülmüş sefer sayısı. */
  eksikMaliyetliSefer: number;
};

/**
 * Bir eksende toplama.
 *
 * ⚠️ MALİYETİ ÖLÇÜLEMEYEN SEFER TOPLAMA GİRER ama maliyeti 0 sayılmaz:
 * geliri toplanır, maliyeti toplanmaz ve `maliyetsizSefer` sayacı artar.
 * Sayaç ekranda görünür. Böyle bir seferi tamamen dışarıda bırakmak geliri
 * de silerdi — müşteri toplamı gerçeğinden küçük çıkardı.
 */
export function eksendeTopla(
  kayitlar: { id: string | null; ad: string; k: SeferKarliligi }[]
): KarlilikSatiri[] {
  const kova = new Map<string, KarlilikSatiri>();
  for (const { id, ad, k } of kayitlar) {
    const anahtar = id ?? " yok";
    const s =
      kova.get(anahtar) ??
      {
        id,
        ad,
        seferSayisi: 0,
        gelirEur: 0,
        maliyetEur: 0,
        katkiPayiEur: 0,
        marj: null,
        maliyetsizSefer: 0,
        eksikMaliyetliSefer: 0,
      };
    s.seferSayisi++;
    s.gelirEur += k.gelirEur;
    if (k.maliyet.atfedilenEur === null) s.maliyetsizSefer++;
    else s.maliyetEur += k.maliyet.atfedilenEur;
    if (k.eksikMaliyet) s.eksikMaliyetliSefer++;
    kova.set(anahtar, s);
  }

  return [...kova.values()]
    .map((s) => {
      const gelir = Math.round(s.gelirEur * 100) / 100;
      const maliyet = Math.round(s.maliyetEur * 100) / 100;
      const katki = Math.round((gelir - maliyet) * 100) / 100;
      return {
        ...s,
        gelirEur: gelir,
        maliyetEur: maliyet,
        katkiPayiEur: katki,
        /**
         * 🔴 ORAN KÜMESİ: marj YALNIZ ölçümü TAM satırlarda hesaplanır.
         *
         * `gelir` her seferden toplanıyor, `maliyet` ise yalnız
         * `atfedilenEur !== null` olanlardan. Maliyeti ölçülemeyen bir sefer
         * gelirini paya sokup maliyetini sokmazsa katkı payı — dolayısıyla
         * marj — ŞİŞER. Bu, "en kârlı müşteri" listesinde bir kez zaten
         * yaşandı (aşağıdaki `uclar` başlığı) ve orada sıralama kapısıyla
         * çözülmüştü; sayının KENDİSİ hâlâ şişik kalıyordu.
         *
         * Ölçümü eksik satırda marj `null` — "0 marj" DEĞİL, "bilinmiyor".
         * `maliyetsizSefer` / `eksikMaliyetliSefer` sayaçları hangi satırın
         * neden dışarıda kaldığını söylüyor. `docs/ORAN-KUME-KURALI.md`.
         */
        marj:
          gelir > 0 && s.maliyetsizSefer === 0 && s.eksikMaliyetliSefer === 0
            ? katki / gelir
            : null,
      };
    })
    .sort((a, b) => b.katkiPayiEur - a.katkiPayiEur || a.ad.localeCompare(b.ad));
}

/** Satırın maliyeti EKSİKSİZ ölçülmüş mü — sıralamaya girme koşulu. */
export function olcumTam(s: KarlilikSatiri): boolean {
  return s.maliyetsizSefer === 0 && s.eksikMaliyetliSefer === 0;
}

/**
 * En kârlı / en zararlı ilk N.
 *
 * 🔴 SIRALAMAYA YALNIZ ÖLÇÜMÜ TAM SATIRLAR GİRER — QA'da yakalandı.
 *
 * İlk yazımda liste ham katkı payına göre diziliyordu ve maliyetinin yarısı
 * ölçülemeyen bir müşteri "en kârlı" listesinde İKİNCİ SIRAYA çıktı: yakıtı
 * ölçülemediği için maliyeti eksik, dolayısıyla katkı payı şişmişti. Bu, bu
 * ekranın yapabileceği EN ZARARLI hatadır — kullanıcı zarar eden bir müşteriyi
 * ödüllendirebilirdi.
 *
 * Elenen satırlar GİZLENMİYOR: `olcumsuz` sayacı ekranda görünür ve tablo
 * satırında hangi seferin eksik olduğu zaten yazıyor. Sıralamadan çıkarmak
 * "yok saymak" değil, "bu sayıyla kıyaslama yapılamaz" demektir.
 */
export function uclar(satirlar: KarlilikSatiri[], n = 5) {
  const tam = satirlar.filter(olcumTam);
  return {
    enKarli: [...tam].sort((a, b) => b.katkiPayiEur - a.katkiPayiEur).slice(0, n),
    /**
     * Zararlı uç YALNIZ katkı payı NEGATİF olanlardan seçilir. Aksi hâlde
     * kârlı ama az kârlı bir müşteri "en zararlı" başlığı altında listelenir
     * ve ekran olmayan bir sorun uydurur.
     */
    enZararli: tam
      .filter((s) => s.katkiPayiEur < 0)
      .sort((a, b) => a.katkiPayiEur - b.katkiPayiEur)
      .slice(0, n),
    /** Ölçümü eksik olduğu için sıralamaya GİRMEYEN satır sayısı. */
    olcumsuz: satirlar.length - tam.length,
  };
}
