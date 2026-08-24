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
  /** Kalan dakika, 5'in katına yuvarlanmış. Vardıysa 0. */
  dakika: number;
  /** 90 dakikayı aşıyor mu — ekran "90+ dk" der. */
  ustSinirAsildi: boolean;
  /** Araç hedef dairenin İÇİNDE mi (ETA yerine "vardı"). */
  vardi: boolean;
  /** Hesapta kullanılan hız — şeffaflık için (ekranda gösterilmez). */
  kullanilanHizKms: number;
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
    return { dakika: 0, ustSinirAsildi: false, vardi: true, kullanilanHizKms: 0 };
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
