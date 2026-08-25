/**
 * ŞOFÖR ÖDÜL VE LİDERLİK — SAF KATMAN (migration 088).
 *
 * Sorgu yok, `server-only` yok, saat okuması yok.
 *
 * ═══ NEDEN AYLIK, NEDEN HAFTALIK DEĞİL ═══
 *
 * ÖLÇÜLDÜ (HAK61, 25.08.2026) — 7 günlük pencerede km kapsama kapısını
 * geçebilen şoför sayısı:
 *
 *     hafta -0   22 kadro · 4 skorlanan · 80+ olan 0
 *     hafta -1   20 kadro · 3 skorlanan · 80+ olan 0
 *     hafta -2   22 kadro · 3 skorlanan · 80+ olan 0
 *     hafta -3   23 kadro · 3 skorlanan · 80+ olan 0
 *
 * 30 günlük pencerede aynı ölçüm: 28 kadro · **17 skorlanan** · 2 kişi 80+.
 *
 * "4 hafta üst üste 80+" rozeti kimsenin kazanamayacağı bir rozettir. Rozetler
 * AYLIK (30 gün) pencerede hesaplanır.
 */

/** Rozet eşiği — "iyi sürüş" sayılan skor. */
export const ROZET_SKOR_ESIK = 80;

/** "Üst üste" rozeti için gereken dönem sayısı. */
export const SERI_DONEM = 3;

/** Aylık ilk-N rozetinin N'i. */
export const ILK_N = 3;

/**
 * Bir dönemin uzunluğu (gün). 30 — ölçümle seçildi (yukarıdaki tablo).
 * Değiştirmek rozetlerin kazanılabilirliğini değiştirir; önce ölç.
 */
export const DONEM_GUN = 30;

export type SkorKapi = "km_yetersiz" | "kapsama_dusuk" | "vardiya_yok";

export type DonemSkoru = {
  workerId: string;
  donemBas: string;
  donemBit: string;
  /** null = yeterli veri yok. 0 DEĞİL. */
  skor: number | null;
  kapi: SkorKapi | null;
  olaySayisi: number;
  km: number | null;
  esikKm: number | null;
  /** Hesaplandığı kalibrasyon damgası (cihaz eşiği epoku). */
  epokAt: string | null;
  /** Dönem epok sınırından ÖNCE başlıyor mu. */
  epokOncesi: boolean;
};

// ══════════════════════════════════════════════════════════════════════════
// SIRALAMA
// ══════════════════════════════════════════════════════════════════════════

export type SiraSatiri = {
  workerId: string;
  /** Görünen ad — isim kapalıysa "Şoför #N". */
  ad: string;
  /** 1'den başlar. Skorsuz şoförde null — sıralamaya GİRMEZ. */
  sira: number | null;
  skor: number | null;
  kapi: SkorKapi | null;
  km: number | null;
  esikKm: number | null;
  /** Bu satır isteği yapan şoförün kendisi mi. */
  ben: boolean;
  /** Önceki döneme göre yön. null = kıyas yapılamıyor. */
  yon: "yukari" | "asagi" | "sabit" | null;
  oncekiSkor: number | null;
};

/**
 * LİDERLİK TABLOSU.
 *
 * ⚠️ SKORSUZ ŞOFÖR SIRALANMAZ. `sira` null döner ve satır listenin sonunda,
 * kendi bölümünde durur. Skorsuzu 0 sayıp en sona koymak "en kötü sürücü"
 * demek olurdu; oysa sayı yok, sürüş kötü değil.
 *
 * ⚠️ İSİM GİZLİYKEN ŞOFÖR KENDİ ADINI GÖRÜR. Diğerleri "Şoför #N" — N sıra
 * numarasıdır, kimliğe bağlı sabit bir takma ad DEĞİL: sabit olsaydı iki
 * dönem karşılaştırılarak kim olduğu çözülebilirdi.
 */
export function siralamaKur(
  donemler: DonemSkoru[],
  adlar: Map<string, string>,
  oncekiler: Map<string, number | null>,
  benWorkerId: string | null,
  isimGorunur: boolean,
  takmaEtiket: (n: number) => string
): { siralı: SiraSatiri[]; skorsuz: SiraSatiri[] } {
  const skorlu = donemler
    .filter((d) => d.skor !== null)
    .sort((a, b) => (b.skor ?? 0) - (a.skor ?? 0) || a.workerId.localeCompare(b.workerId));

  const siralı: SiraSatiri[] = skorlu.map((d, i) => {
    const ben = benWorkerId !== null && d.workerId === benWorkerId;
    const onceki = oncekiler.get(d.workerId) ?? null;
    return {
      workerId: d.workerId,
      ad: isimGorunur || ben ? (adlar.get(d.workerId) ?? "—") : takmaEtiket(i + 1),
      sira: i + 1,
      skor: d.skor,
      kapi: null,
      km: d.km,
      esikKm: d.esikKm,
      ben,
      yon: yonBul(d.skor, onceki),
      oncekiSkor: onceki,
    };
  });

  const skorsuz: SiraSatiri[] = donemler
    .filter((d) => d.skor === null)
    .map((d) => {
      const ben = benWorkerId !== null && d.workerId === benWorkerId;
      return {
        workerId: d.workerId,
        ad: isimGorunur || ben ? (adlar.get(d.workerId) ?? "—") : takmaEtiket(0),
        sira: null,
        skor: null,
        kapi: d.kapi,
        km: d.km,
        esikKm: d.esikKm,
        ben,
        yon: null,
        oncekiSkor: null,
      };
    })
    .sort((a, b) => (b.km ?? -1) - (a.km ?? -1));

  return { siralı, skorsuz };
}

/**
 * Yön — 3 puandan küçük fark "sabit" sayılır.
 *
 * Skor gürültülü bir sayı (payda km, pay olay); 1-2 puanlık salınımı "düşüş"
 * diye göstermek şoföre olmayan bir kötüleşme anlatırdı.
 */
export const YON_ESIK = 3;

export function yonBul(skor: number | null, onceki: number | null): SiraSatiri["yon"] {
  if (skor === null || onceki === null) return null;
  const fark = skor - onceki;
  if (Math.abs(fark) < YON_ESIK) return "sabit";
  return fark > 0 ? "yukari" : "asagi";
}

// ══════════════════════════════════════════════════════════════════════════
// ROZETLER
// ══════════════════════════════════════════════════════════════════════════

export type RozetKodu = "ay_iyi" | "seri_iyi" | "ay_ilk3" | "sifir_olay" | "yukselen";

export type RozetAdayi = {
  workerId: string;
  rozet: RozetKodu;
  donemBas: string;
  kanit: Record<string, unknown>;
};

/**
 * ⚠️ KALİBRASYON SINIRI — SERİ ROZETİNİN TEK KURALI.
 *
 * İki dönem ancak AYNI cihaz-eşiği epokundan sonra başlıyorsa
 * karşılaştırılabilir. 22–23.07.2026'da eşikler gevşetildi ve ham olay sayısı
 * değişti; o sınırın iki yakasındaki skorlar aynı cetvelle ölçülmemiştir ve
 * yeniden hesaplamayla düzelmez (olayın kendisi farklı üretilmiş).
 */
export function kiyaslanabilir(a: DonemSkoru, b: DonemSkoru): boolean {
  if (a.epokOncesi || b.epokOncesi) return false;
  return (a.epokAt ?? null) === (b.epokAt ?? null);
}

/**
 * Bir şoförün dönemlerinden rozet adaylarını çıkarır.
 *
 * `donemler` YENİDEN ESKİYE sıralı gelmeli; en yenisi değerlendirilen dönem.
 */
export function rozetleriHesapla(
  donemler: DonemSkoru[],
  ilk3WorkerIds: string[]
): RozetAdayi[] {
  const cikan: RozetAdayi[] = [];
  const son = donemler[0];
  if (!son) return cikan;

  // ── AYIN İYİSİ: dönem skoru eşiği geçti.
  if (son.skor !== null && son.skor >= ROZET_SKOR_ESIK) {
    cikan.push({
      workerId: son.workerId,
      rozet: "ay_iyi",
      donemBas: son.donemBas,
      kanit: { skor: son.skor, esik: ROZET_SKOR_ESIK, km: son.km },
    });
  }

  // ── AYIN İLK 3'Ü
  const sira = ilk3WorkerIds.indexOf(son.workerId);
  if (sira >= 0 && sira < ILK_N) {
    cikan.push({
      workerId: son.workerId,
      rozet: "ay_ilk3",
      donemBas: son.donemBas,
      kanit: { sira: sira + 1, skor: son.skor },
    });
  }

  // ── SIFIR OLAY: skorlanabildi VE hiç olay yok.
  if (son.skor !== null && son.olaySayisi === 0) {
    cikan.push({
      workerId: son.workerId,
      rozet: "sifir_olay",
      donemBas: son.donemBas,
      kanit: { olay: 0, km: son.km },
    });
  }

  // ── YÜKSELEN: önceki KIYASLANABİLİR döneme göre YON_ESIK'ten fazla artış.
  const onceki = donemler[1];
  if (
    son.skor !== null &&
    onceki?.skor != null &&
    kiyaslanabilir(son, onceki) &&
    son.skor - onceki.skor >= YON_ESIK
  ) {
    cikan.push({
      workerId: son.workerId,
      rozet: "yukselen",
      donemBas: son.donemBas,
      kanit: { skor: son.skor, oncekiSkor: onceki.skor, fark: son.skor - onceki.skor },
    });
  }

  // ── SERİ: üst üste SERI_DONEM dönem eşiği geçti — hepsi KIYASLANABİLİR.
  const seri = donemler.slice(0, SERI_DONEM);
  const seriTam =
    seri.length === SERI_DONEM &&
    seri.every((d) => d.skor !== null && d.skor >= ROZET_SKOR_ESIK) &&
    seri.every((d) => kiyaslanabilir(d, seri[0]));
  if (seriTam) {
    cikan.push({
      workerId: son.workerId,
      rozet: "seri_iyi",
      donemBas: son.donemBas,
      kanit: {
        donem: SERI_DONEM,
        skorlar: seri.map((d) => d.skor),
        esik: ROZET_SKOR_ESIK,
      },
    });
  }

  return cikan;
}

/**
 * SERİ ROZETİ HENÜZ KAZANILABİLİR Mİ.
 *
 * Kazanılamıyorsa ekran bunu SÖYLEMELİ. "3 ay üst üste 80+" rozetini boş
 * göstermek, şoföre kazanamadığını sanmasına yol açar; oysa sorun onda değil,
 * temiz veri henüz o kadar uzun değil (epok 23.07.2026).
 */
export function seriKazanilabilirMi(temizDonemSayisi: number): {
  olur: boolean;
  eksikDonem: number;
} {
  return {
    olur: temizDonemSayisi >= SERI_DONEM,
    eksikDonem: Math.max(0, SERI_DONEM - temizDonemSayisi),
  };
}
