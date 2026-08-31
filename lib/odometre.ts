/**
 * ODOMETRE OKUMA KALİTESİ — bozuk cihaz okumalarını eleyen tek karar noktası.
 *
 * ═══ SORUN (HAK61 canlı, 31.08.2026 ölçümü) ═══════════════════════════════
 *
 * Cihaz zaman zaman **tekil bozuk odometre** bildiriyor. Ölçüldü:
 *
 *     1.803.566 satır · odometre dolu 1.518.613
 *     odometer_km = 0        114 satır (%0,0075) · 4/30 araç
 *     monotonluk ihlali      123 olay  · 13/30 araç · en büyüğü 113.009 km
 *     negatif odometre         0
 *
 * Bozukluk TEKİLDİR, kalıcı değil — seri hemen normale döner:
 *
 *     10:01:19   123836
 *     10:01:20   123836
 *     10:01:21    24063   ← tek satır
 *     10:01:23   123836   ← hemen geri
 *
 * Yani bu bir **sayaç sıfırlanması / cihaz değişimi DEĞİL**; o kalıcı olurdu.
 *
 * ═══ ZARARI — ölçüldü ═════════════════════════════════════════════════════
 *
 * `telemetry_month_spans` ayın **`min`/`max`**'ını alıyor. Tek bozuk okuma
 * ayın minimumunu götürüyor ve açıklık şişiyor. 2026-07, HAK61:
 *
 *     ölçülebilen araç   min/max ile 23  →  temizlenmiş seriyle 26   (+3)
 *     DO-777GS km        36.187          →  1.141      (%3.070 hata, ve bu
 *                                            değer makullük kapısından GEÇİYORDU)
 *
 * Kapsama kaybı CO₂ oranına da vuruyordu: km'si ölçülemeyen araç
 * `olculemedi_sebep = "odometre_yok"` alıyor ve oran kümesinin dışında kalıyor.
 *
 * ═══ KURAL — ikisi de FİZİKTEN, hiçbiri filoya bağlı değil ════════════════
 *
 *  ① **Monotonluk.** Odometre azalmaz. Koşan maksimumdan geri giden okuma
 *     bozuktur. (Sıfır ayrı bir kural değil — o da bir azalmadır.)
 *  ② **Fiziksel atlama.** İki okuma arasındaki artış, geçen sürede mümkün
 *     olandan büyük olamaz. Üst hız VERİDEN ölçüldü: 1,8M satırda
 *     `speed_kmh > 200` olan **hiç** satır yok.
 *
 * ① tek başına yetmez: bozuk okuma serinin BAŞINDAYSA azalma değildir
 * (0 → 98.783 artıştır). Ölçüldü — yalnız ① ile kazanç **+0**; ② eklenince
 * **+3 araç**. İkisi birlikte gerekli.
 *
 * 🔴 ÖLÇEKTEN BAĞIMSIZ: plaka yok, araç sayısı yok, filoya özel eşik yok.
 * 10 araçta da 1000 araçta da, hangi araç hangi gün bozuk okusa da aynı
 * çalışır. Tek sabit `UST_HIZ_KMS` ve o bir **fiziksel sınır**, filo değil.
 *
 * Ayrıntı: `docs/BOZUK-TELEMETRI.md`.
 */

/**
 * Bir aracın fiziksel üst hızı (km/s). Veriden ölçüldü: 1,8M telemetri
 * satırında `speed_kmh > 200` olan hiç satır yok. Cömert tutuldu — amaç
 * "hızlı gitti" demek değil, "iki okuma arasında 100.000 km atlayamaz" demek.
 */
export const UST_HIZ_KMS = 200;

/** İki okuma arasında mümkün olan en büyük odometre artışı (km). */
export function mumkunArtisKm(gecenSaniye: number): number {
  // 1 km taban: aynı saniyeye düşen iki okuma arasında da yuvarlama payı kalsın.
  return Math.max(1, (gecenSaniye / 3600) * UST_HIZ_KMS);
}

export type OdometreOkumasi = { odometer_km: number; recorded_at: string };

export type OdometreSpani = {
  /** Temizlenmiş serinin ilk okuması. Seri boşsa null. */
  ilk: number | null;
  /** Temizlenmiş serinin son okuması. */
  son: number | null;
  /** `son - ilk`. İki geçerli okuma yoksa null — "0 km" DEĞİL. */
  km: number | null;
  ilkAn: string | null;
  sonAn: string | null;
  /** Kaç okuma bozuk sayıldı — sessiz eksik YASAK, sayı dışarı çıkar. */
  atilan: number;
  toplam: number;
};

/**
 * Bozuk okumaları eler. Girdi **zamana göre artan** sırada olmalı.
 *
 * Üç adım:
 *   1. Monotonluk — koşan maksimumdan geri gideni at.
 *   2. Baştaki imkansız atlamayı soy — ilk çift fiziksel olarak bağlanamıyorsa
 *      bozuk olan İLK okumadır (serinin geri kalanı kendi içinde tutarlı).
 *   3. Sondaki imkansız atlamayı soy — simetrik.
 *
 * 2 ve 3 döngüdür: baştaki iki okuma da bozuksa ikisi de soyulur.
 */
export function odometreTemizle(okumalar: readonly OdometreOkumasi[]): OdometreOkumasi[] {
  const monoton: OdometreOkumasi[] = [];
  let kosanMax = -Infinity;
  for (const r of okumalar) {
    if (r.odometer_km < kosanMax) continue;
    kosanMax = r.odometer_km;
    monoton.push(r);
  }

  const bagli = (a: OdometreOkumasi, b: OdometreOkumasi) => {
    const dt = (new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()) / 1000;
    return b.odometer_km - a.odometer_km <= mumkunArtisKm(dt);
  };

  /**
   * 🔴 ARDIŞIK EŞİT DEĞER BLOĞU TEK BİRİMDİR (31.08.2026, ölçümle bulundu).
   *
   * Komşu çifte bakmak yetmiyor: DO-505GS'te ayın başında **13 ardışık sıfır**
   * var. `0 → 0` geçişi fiziksel olarak kusursuz (artış 0), yani kapı onları
   * geçiriyor; yalnız son sıfır `0 → 120.849` çiftinde takılıyor ve geriye
   * 12 sıfır kalıyor — `min` hâlâ 0. DO-512GT çözülmüştü çünkü sıfırı TEKTİ.
   *
   * Doğrusu: bir okumayı SONRAKİ FARKLI DEĞERE bağlamak. Böylece eşit blok
   * bütün olarak soyulur. Ek sabit gerekmez — kuralın kendi uzantısı.
   */
  const sonrakiFarkli = (i: number) => {
    for (let j = i + 1; j < monoton.length; j++) {
      if (monoton[j].odometer_km !== monoton[i].odometer_km) return j;
    }
    return -1;
  };
  const oncekiFarkli = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      if (monoton[j].odometer_km !== monoton[i].odometer_km) return j;
    }
    return -1;
  };

  let bas = 0;
  for (;;) {
    const j = sonrakiFarkli(bas);
    if (j === -1 || bagli(monoton[bas], monoton[j])) break;
    bas = j;
  }
  let son = monoton.length;
  for (;;) {
    const i = son - 1;
    const j = oncekiFarkli(i);
    if (j === -1 || j < bas || bagli(monoton[j], monoton[i])) break;
    son = j + 1;
  }

  return monoton.slice(bas, son);
}

/** Temizlenmiş seriden açıklık. Tek karar noktası — çağıranlar kendi hesabını yapmaz. */
export function odometreSpani(okumalar: readonly OdometreOkumasi[]): OdometreSpani {
  const t = odometreTemizle(okumalar);
  const bos: OdometreSpani = {
    ilk: null, son: null, km: null, ilkAn: null, sonAn: null,
    atilan: okumalar.length - t.length, toplam: okumalar.length,
  };
  if (t.length < 2) return bos;
  const ilk = t[0], son = t[t.length - 1];
  return {
    ilk: ilk.odometer_km,
    son: son.odometer_km,
    km: son.odometer_km - ilk.odometer_km,
    ilkAn: ilk.recorded_at,
    sonAn: son.recorded_at,
    atilan: okumalar.length - t.length,
    toplam: okumalar.length,
  };
}

/**
 * Tek bir okumanın kendi başına imkansız olup olmadığı — seri gerektirmez.
 * Seri bağlamı olan yerlerde `odometreTemizle` kullanılır; bu, yazma yolunda
 * ve muhafızda kullanılan ucuz kapıdır.
 */
export function odometreImkansizMi(km: number | null | undefined): boolean {
  if (km === null || km === undefined) return false;
  // Negatif bir odometre yoktur; 0 ise araç hiç yol almamış demektir ve bu
  // filoda hiçbir aracın gerçek değeri değil (en düşük gerçek okuma 12.543).
  // Yine de "0" tek başına REDDEDİLMEZ: yeni bir araç teorik olarak 0'da
  // olabilir. Karar seriye bırakılır — burada yalnız fiziksel imkansızlık.
  return km < 0 || !Number.isFinite(km);
}
