/**
 * TAHMİNİ VARIŞ (ETA) — SAF hesap, veritabanına dokunmaz.
 *
 * ═══ NE İLE HESAPLANIYOR — VE NE İLE DEĞİL ═══
 *
 * Depoda ROTA MOTORU YOK. Ölçüldü (24.08.2026): `lib/` altında yönlendirme
 * yapan tek bir modül yok; coğrafi hesabın tamamı `lib/geo.ts` içindeki
 * haversine'den ibaret. Harici bir rota servisi (OSRM/Mapbox/Google) eklemek
 * üç şey getirirdi: anahtar, kota, ve girişsiz bir sayfadan tetiklenen dış
 * istek. Üçü de bu özellik için kabul edilemez — özellikle sonuncusu: linki
 * kim açarsa açsın parası ödenen bir API çağrılırdı.
 *
 * Bu yüzden ETA şöyle: KUŞ UÇUŞU mesafe × yol katsayısı ÷ etkin hız.
 *
 * ═══ NEDEN "TAHMİNİ" DEMEK YETMİYOR, KABALAŞTIRIYORUZ ═══
 *
 * "17 dakika" demek, o hassasiyette bir bilgi olduğunu söylemektir — oysa
 * girdi kuş uçuşu bir çizgi. Sayı 5 dakikalık kademelere yuvarlanıyor ve
 * 90 dakikadan uzun tahminler "90+ dk" olarak veriliyor: yanlış kesinlik,
 * yanlış sayıdan daha zararlıdır (müşteri 17'yi randevu sanar).
 *
 * ═══ ETKİN HIZ ═══
 *
 * Araç hareketliyse KENDİ son hızı kullanılır — trafikte yavaşladıysa ETA
 * uzasın. Duruyorsa (ya da hız alanı boşsa) kiracı varsayılanı devreye girer;
 * "0 km/s → sonsuz dakika" demek, kırmızı ışıkta bekleyen aracı asla
 * varmayacak ilan etmek olurdu.
 *
 * Hız üst sınırı 90 km/s: otoyolda bir anlık 130 okuması, şehir içi teslimat
 * için gerçekçi olmayan bir ETA üretirdi.
 */

/** Hesabın girdileri — hepsi çağıranın ölçtüğü değerler. */
export type EtaGirdi = {
  /** Aracın son bilinen konumu. */
  aracLat: number;
  aracLng: number;
  /** Hedef bölgenin merkezi. */
  hedefLat: number;
  hedefLng: number;
  /** Hedef bölgenin yarıçapı (m) — içine girince "vardı" sayılır. */
  hedefYaricapM: number;
  /** Son ölçülen hız (km/s) — null/0 ise varsayılan hıza düşülür. */
  hizKms: number | null;
  /** Kuş uçuşu → yol katsayısı (kiracı ayarı). */
  yolKatsayisi: number;
  /** Hız ölçülemediğinde kullanılacak hız (km/s, kiracı ayarı). */
  varsayilanHizKms: number;
  /** Kuş uçuşu mesafe (m) — çağıran `haversineM` ile ölçer. */
  mesafeM: number;
};

export type EtaSonuc = {
  /** Kalan dakika, kademeye yuvarlanmış. Vardıysa 0. */
  dakika: number;
  /** Üst sınırı aşıyor mu — ekran "{ustSinirDk}+ dk" der. */
  ustSinirAsildi: boolean;
  /** Araç hedef dairenin İÇİNDE mi (ETA yerine "vardı"). */
  vardi: boolean;
  /** Hesapta kullanılan hız — şeffaflık için (ekranda gösterilmez). */
  kullanilanHizKms: number;
  /**
   * Bu tahminin üst sınırı (dk) — ekranın "90+" / "240+" cümlesini SAYIYI
   * GÖMEREK değil buradan kurması için. Tek hedefte 90, durak zincirinde 240:
   * 12 duraklı bir turda 90 dk tavanı her seferde "90+" derdi ve bilgi
   * taşımazdı (bkz. `durakEtaHesapla`).
   */
  ustSinirDk: number;
};

/** Tahminin üst sınırı; üstü "90+" olarak verilir. */
export const ETA_UST_SINIR_DK = 90;

/** Yuvarlama kademesi — yanlış kesinliğe karşı. */
export const ETA_KADEME_DK = 5;

/** Bir anlık yüksek okumanın tahmini bozmaması için hız tavanı. */
export const ETA_HIZ_TAVANI_KMS = 90;

/** Bu hızın altı "duruyor" sayılır (GPS gürültüsü). */
const DURUYOR_ESIGI_KMS = 3;

export function etaHesapla(g: EtaGirdi): EtaSonuc {
  // Hedef dairenin içindeysek iş bitmiştir: mesafe 0 değil ama VARILDI.
  if (g.mesafeM <= g.hedefYaricapM) {
    return { dakika: 0, ustSinirAsildi: false, vardi: true, kullanilanHizKms: 0, ustSinirDk: ETA_UST_SINIR_DK };
  }

  const olculen = g.hizKms ?? 0;
  const hiz =
    olculen >= DURUYOR_ESIGI_KMS
      ? Math.min(olculen, ETA_HIZ_TAVANI_KMS)
      : g.varsayilanHizKms;

  // Yarıçap düşülür: dairenin kenarına varmak "varmak"tır, merkezine değil.
  const yolKm = ((g.mesafeM - g.hedefYaricapM) / 1000) * g.yolKatsayisi;
  const hamDk = (yolKm / hiz) * 60;

  const kademeli = Math.max(
    ETA_KADEME_DK,
    Math.round(hamDk / ETA_KADEME_DK) * ETA_KADEME_DK
  );

  return {
    dakika: Math.min(kademeli, ETA_UST_SINIR_DK),
    ustSinirAsildi: kademeli > ETA_UST_SINIR_DK,
    vardi: false,
    kullanilanHizKms: hiz,
    ustSinirDk: ETA_UST_SINIR_DK,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// DURAK ZİNCİRİ (migration 083)
// ══════════════════════════════════════════════════════════════════════════

/**
 * ÇOK DURAKLI ETA — MÜŞTERİNİN KENDİ DURAĞINA.
 *
 * ═══ SEKTÖR FORMÜLÜ, BİREBİR ═══
 *
 * Ölçüldü (25.08.2026, upperinc.com/blog/delivery-eta ve locus.sh mühendislik
 * kılavuzu): *"A scheduled ETA is calculated as: distance to stop divided by
 * expected travel speed, PLUS planned service time at the stop, PLUS CUMULATIVE
 * TIME FROM PRIOR STOPS."* Uyguladığımız zincir aynen bu:
 *
 *   araç → S1 → S2 → … → MÜŞTERİNİN DURAĞI
 *   her bacak : haversine × yol katsayısı ÷ etkin hız
 *   her ARA durak : planlanan servis süresi
 *
 * ═══ MÜŞTERİNİN KENDİ SERVİS SÜRESİ SAYILMAZ ═══
 *
 * Sorulan şey VARIŞ, ayrılış değil. Kendi durağının 15 dakikasını eklemek,
 * müşteriye "aracın senden ayrılacağı saat"i varış saati diye sunmak olurdu.
 *
 * ═══ SABİT SERVİS SÜRESİ EN BÜYÜK HATA KAYNAĞI — VE BİZDE ALAN VAR ═══
 *
 * Aynı kaynağın uyarısı: *"Applying a UNIFORM service time estimate, such as
 * 3 minutes per stop, ignores the wide variance between delivery types … and is
 * often the LARGEST SOURCE OF ETA ERROR on multi-stop routes."*
 * Bu yüzden zincir önce DURAĞIN KENDİ `tahmini_sure_dk` değerini kullanıyor;
 * kiracı varsayılanı yalnız o alan BOŞSA devreye giriyor. Yani planlayan kişi
 * bir durağın 25 dakika süreceğini biliyorsa tahmin onu bilir.
 *
 * ═══ KOORDİNATSIZ DURAK — TAHMİN KABALAŞIR, SESSİZ KALMAZ ═══
 *
 * Serbest adresli bir durak koordinatsız olabilir (082: adres bir ETİKET).
 * Öyle bir durak zincirde BACAK üretemez; yalnız SERVİS SÜRESİ sayılır ve
 * zincir bir sonraki bilinen noktaya "atlar". Sonuç `kaba: true` ile
 * işaretlenir — çağıran isterse ekranda daha temkinli bir dil kullanır.
 *
 * ═══ ÜST SINIR 90 DEĞİL 240 ═══
 *
 * Tek hedefli ETA'da 90 dk tavanı doğruydu: tek bir teslimata 90 dakikadan
 * fazla varsa sayı zaten anlamsızdı. 12 duraklı bir turda ise 90 dk tavanı HER
 * SEFERİNDE "90+" derdi ve hiçbir bilgi taşımazdı. Tavan 240 dk; kademe de
 * büyüklükle kabalaşıyor (≤30 dk → 5, ≤90 dk → 10, üstü → 15): iki saatlik bir
 * tahmini 5 dakikaya yuvarlamak, olmayan bir hassasiyet iddiasıdır.
 */
export const ETA_ZINCIR_UST_SINIR_DK = 240;

/** Zincirdeki tek durak — geometrisi olmayabilir (serbest adres, koordinatsız). */
export type ZincirDuragi = {
  lat: number | null;
  lng: number | null;
  /** Varış yarıçapı (m) — bacaktan düşülür: dairenin kenarına varmak varmaktır. */
  yaricapM: number;
  /** Durağın planlanan süresi (dk). null → kiracı varsayılanı. */
  servisDk: number | null;
};

export type ZincirGirdi = {
  aracLat: number;
  aracLng: number;
  hizKms: number | null;
  yolKatsayisi: number;
  varsayilanHizKms: number;
  /** `servisDk` boş duraklarda kullanılacak süre (kiracı ayarı). */
  varsayilanServisDk: number;
  /**
   * Aracın ÖNÜNDEKİ AÇIK duraklar, SIRAYLA. SONUNCUSU müşterinin durağıdır.
   * Yani `duraklar.length - 1` = "önünüzde kaç durak var".
   */
  duraklar: ZincirDuragi[];
  /** İki nokta arası kuş uçuşu mesafe (m) — çağıran `haversineM`i geçirir. */
  mesafe: (aLat: number, aLng: number, bLat: number, bLng: number) => number;
};

export type ZincirSonuc = EtaSonuc & {
  /** Müşterinin durağından ÖNCE yapılacak açık durak sayısı. */
  onunuzdeDurak: number;
  /** Zincirde koordinatsız durak vardı → tahmin kabalaştı. */
  kaba: boolean;
};

/** Büyüdükçe kabalaşan yuvarlama — yanlış kesinliğe karşı. */
function zincirKademesi(hamDk: number): number {
  if (hamDk <= 30) return 5;
  if (hamDk <= 90) return 10;
  return 15;
}

export function durakEtaHesapla(g: ZincirGirdi): ZincirSonuc | null {
  const n = g.duraklar.length;
  if (n === 0) return null;

  const hedef = g.duraklar[n - 1];
  // Müşterinin kendi durağının geometrisi yoksa hesap kurulamaz. Uydurmak
  // yerine null döndürüp ekranın "tahmin yok" demesini sağlıyoruz.
  if (hedef.lat === null || hedef.lng === null) return null;

  const olculen = g.hizKms ?? 0;
  const hiz =
    olculen >= DURUYOR_ESIGI_KMS ? Math.min(olculen, ETA_HIZ_TAVANI_KMS) : g.varsayilanHizKms;

  let mesafeToplamM = 0;
  let servisToplamDk = 0;
  let kaba = false;
  let sonLat = g.aracLat;
  let sonLng = g.aracLng;
  /** Aracın, müşterinin durağının dairesi içinde olup olmadığı (yalnız ilk durakken anlamlı). */
  let ilkBacakM: number | null = null;

  for (let i = 0; i < n; i++) {
    const d = g.duraklar[i];
    if (d.lat === null || d.lng === null) {
      // Bacak ölçülemiyor: zincir bir sonraki BİLİNEN noktaya atlar.
      kaba = true;
    } else {
      const ham = g.mesafe(sonLat, sonLng, d.lat, d.lng);
      if (i === 0) ilkBacakM = ham;
      // Yarıçap düşülür (0'ın altına inmez): kenara varmak varmaktır.
      mesafeToplamM += Math.max(0, ham - d.yaricapM);
      sonLat = d.lat;
      sonLng = d.lng;
    }
    // ⚠️ SON durağın (müşterininki) servis süresi SAYILMAZ — sorulan VARIŞ.
    if (i < n - 1) servisToplamDk += d.servisDk ?? g.varsayilanServisDk;
  }

  /**
   * "VARDI" YALNIZ MÜŞTERİNİN DURAĞI SIRADAKİYSE.
   *
   * Duraklar birbirine yakınsa araç, müşterinin dairesi içindeyken hâlâ ondan
   * önceki bir durakta olabilir. O hâlde "vardı" demek yanlış olurdu; şart
   * zincirde başka durak OLMAMASI.
   */
  if (n === 1 && ilkBacakM !== null && ilkBacakM <= hedef.yaricapM) {
    return {
      dakika: 0,
      ustSinirAsildi: false,
      vardi: true,
      kullanilanHizKms: 0,
      ustSinirDk: ETA_ZINCIR_UST_SINIR_DK,
      onunuzdeDurak: 0,
      kaba,
    };
  }

  const yolKm = (mesafeToplamM / 1000) * g.yolKatsayisi;
  const hamDk = (yolKm / hiz) * 60 + servisToplamDk;
  const kademe = zincirKademesi(hamDk);
  const kademeli = Math.max(kademe, Math.round(hamDk / kademe) * kademe);

  return {
    dakika: Math.min(kademeli, ETA_ZINCIR_UST_SINIR_DK),
    ustSinirAsildi: kademeli > ETA_ZINCIR_UST_SINIR_DK,
    vardi: false,
    kullanilanHizKms: hiz,
    ustSinirDk: ETA_ZINCIR_UST_SINIR_DK,
    onunuzdeDurak: n - 1,
    kaba,
  };
}

/**
 * Konumun ne kadar bayat olduğu — sayfanın "canlı mı" cevabı.
 *
 * Cihaz sustuğunda ETA yanlış olmaz, ESKİ olur. İkisi farklı şeyler ve müşteri
 * hangisine baktığını bilmeli: 20 dakikalık bir nokta üzerinden "5 dk kaldı"
 * demek, aracın 20 dakika önce nerede olduğunu bugünkü tahmin gibi sunmaktır.
 */
export const KONUM_BAYAT_ESIGI_DK = 10;

export function konumBayatMi(recordedAtISO: string, simdi = new Date()): boolean {
  const t = Date.parse(recordedAtISO);
  if (!Number.isFinite(t)) return true;
  return simdi.getTime() - t > KONUM_BAYAT_ESIGI_DK * 60_000;
}
