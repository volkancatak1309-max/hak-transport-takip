/**
 * MALİYET MODELİ — €/km ve €/paket'in saf matematiği.
 *
 * ═══ NEDEN AYRI, İSTEMCİ-GÜVENLİ DOSYA ═══
 *
 * `lib/reports.ts` server-only (supabaseAdmin içeriyor). Ekran tarafı (FuelClient,
 * "use client") hesabın TÜRLERİNİ ve birim çevrimlerini bilmek zorunda; o dosyayı
 * import ederse sunucu zinciri istemci paketine sızar. Aynı ayrım
 * `lib/analytics-shared.ts` ↔ `lib/analytics.ts` ikilisinde zaten var, deseni
 * tekrarlıyoruz.
 *
 * Bu dosyada DB erişimi ve `process.env` okuması YOKTUR. Oranlar
 * `lib/tenant.ts`'te yaşar ve buraya ARGÜMAN olarak gelir — sunucu-tarafı env'i
 * burada okusaydık tarayıcıda sessizce varsayılana düşerdi (03.08.2026 dersi:
 * "Tenant env istemci tuzağı").
 *
 * ═══ MODEL BİR KESTİRİMDİR, ÖLÇÜM DEĞİL ═══
 *
 * Çıkan € rakamı dört ORANIN çarpımıdır; üçü piyasa varsayımı. Ekranda bunun
 * yazması ZORUNLU (`rolantiKatsayi` emsali: "bu € bir ölçüm değil kestirim").
 * Buna karşılık PAYDALAR ölçümdür: km, saat, paket ve araç-gün canlı vardiya
 * satırlarından gelir, tahmin edilmez.
 *
 * ═══ NEDEN VARDİYA EKSENİ (Volkan kararı, 23.08.2026) ═══
 *
 * İki km ekseni var ve %35 ayrışıyorlar (30 gün, HAK61): araç ekseni 28.396 km
 * (`buildDistanceReport`, odometre pencere uçları), vardiya ekseni 18.307 km.
 * Fark = vardiya dışı araç hareketi. Maliyet İŞİN maliyetidir; payı (şoför-saati,
 * araç-günü) zaten vardiyadan geliyor. Paydayı araç ekseninden alsaydık pay ile
 * payda farklı evrenleri sayar ve €/km yapay olarak düşerdi.
 *
 * ⚠️ Ham `shift_odometer_spans` RPC'si BU İŞ İÇİN KULLANILAMAZ: km muhafızı
 * uygulanmadan okunduğunda aynı 30 günlük pencerede 216.801 km veriyor
 * (23.08.2026 ölçümü) — DO-571GR okumalarının %7,3'ünde `odometer_km=0`
 * gönderiyor ve fark patlıyor. Payda `time_entries.start_km/end_km` +
 * `lib/km-quality.ts` kapısından geçer; o zincir 18.307 km veriyor.
 */

/** Maliyet hesabının dört oranı. Hepsi `lib/tenant.ts`'ten gelir. */
export type CostRates = {
  /** €/litre — FUEL_PRICE_EUR_PER_L. */
  fuelEurPerL: number;
  /** L/100km — ölçülen filo ortalaması ya da FLEET_L_PER_100KM. */
  lPer100Km: number;
  /** €/şoför-saati, işveren toplam maliyeti — LABOR_EUR_PER_HOUR. */
  laborEurPerHour: number;
  /** €/ÇALIŞILAN araç-günü — VEHICLE_EUR_PER_DAY. */
  vehicleEurPerDay: number;
};

/**
 * ═══════════ BİR ORANIN KAYNAĞI — ekranda ZORUNLU etiket ═══════════════
 *
 * `olculdu`     Telemetriden gelir, kimse giremez. Bugün yalnız L/100km.
 * `girildi`     Kiracının KENDİ rakamı — panelden (tenant_cost_rates) ya da
 *               kurulum env'inden. `via` hangisi olduğunu söyler.
 * `varsayilan`  Bizim koyduğumuz başlangıç değeri. `kaynak` + `tarih` ZORUNLU:
 *               kaynağı olmayan varsayılan, ölçüm kılığına girmiş tahmindir.
 *
 * NEDEN ZORUNLU: €/km bir KARAR sayısıdır (araç alınır, güzergâh kapatılır,
 * müşteriye fiyat verilir). Karar veren kişi baktığı rakamın kendi verisi mi
 * yoksa bizim tahminimiz mi olduğunu görmeden onu kullanamaz. Ürün bunu
 * söylemezse kullanıcı FARKI KENDİ UYDURUR — ve genellikle her şeyi ölçüm
 * sanar.
 */
export type RateSource = "olculdu" | "girildi" | "varsayilan";

export type RateOrigin =
  | { source: "olculdu" }
  | { source: "girildi"; via: "panel" | "env" }
  | { source: "varsayilan"; kaynak: string; tarih: string };

/** Dört oranın dördünün ayrı ayrı kaynağı. */
export type CostRateOrigin = {
  fuel: RateOrigin;
  /** Bugün her zaman `olculdu` olmalı; değilse telemetri yok demektir. */
  lPer100: RateOrigin;
  labor: RateOrigin;
  vehicleDay: RateOrigin;
};

/**
 * Modelin PAYDALARI — hepsi canlı vardiya satırlarından ölçülür.
 *
 * Her ölçümün yanında onu üreten vardiya SAYISI durur: 18.307 km'nin 429
 * vardiyanın 364'ünden geldiğini görmeyen okuyucu, kapsamayı %100 sanar.
 */
export type CostBasis = {
  /** Vardiya km toplamı (km_measured kapısını geçmiş, fark > 0 olanlar). */
  km: number;
  /** km üreten vardiya sayısı. */
  kmShifts: number;
  /**
   * Şoför-saati toplamı — AZG günlük tavanıyla SINIRLANMIŞ (bkz. hourCapShifts).
   */
  hours: number;
  hourShifts: number;
  /**
   * Tavana çarptığı için KISALTILAN vardiya sayısı.
   *
   * ⚠️ ÖLÇÜLDÜ (HAK61, 30 gün, 23.08.2026): 429 vardiyanın 42'si 24 SAATTEN
   * uzun görünüyor (en uzunu 133,1 saat) ve ham toplamın %34,4'ünü (1.824 sa)
   * bunlar üretiyor. Bunlar çalışma değil, GEÇ KAPATILMIŞ vardiya: otomatik
   * kapanış 22.07.2026'da bilinçli olarak kaldırıldı, vardiyayı yalnız personel
   * kapatıyor ve bazen günler sonra kapatıyor.
   *
   * İşçilik toplam maliyetin ~%80'i olduğu için bu satırları ham hâliyle
   * geçirmek €/km'yi üçte bir şişirirdi. Tavan `AZG_DAILY_MAX_MS` (§ 9 Abs. 1
   * AZG, 12 saat) — uydurulmuş bir sayı değil, kiracının kendi yasal ÜST
   * SINIRI ve repoda zaten tek kaynak. Aynı "sınırla + say" deseni
   * `computeEngineHours`'ın `clampedCount`'unda da var.
   *
   * Sayı EKRANDA gösterilir: sessizce sınırlamak, sessizce şişirmek kadar
   * kötüdür — ikisi de okuyucuya olmayan bir kesinlik vaat eder.
   */
  hourCapShifts: number;
  /** Teslim edilen paket toplamı (`cargo_count`). */
  parcels: number;
  parcelShifts: number;
  /** Ayrık (araç, gün) çifti sayısı — "çalışılan araç-günü". */
  vehicleDays: number;
  /** Aralıkta en az bir vardiya görmüş ayrık araç sayısı. */
  vehicles: number;
  /** Aralıktaki toplam vardiya sayısı (kapsama paydası). */
  totalShifts: number;
};

/** Modelin çıktısı. Bölünemeyen her oran `null` — SIFIR DEĞİL. */
export type CostBreakdown = {
  /** Modelin ürettiği litre: km × L/100km ÷ 100. */
  modelLiters: number;
  fuelEur: number;
  laborEur: number;
  fixedEur: number;
  totalEur: number;
  /** €/km — payda 0 ise null. */
  eurPerKm: number | null;
  /** €/paket — paket 0 ise null. */
  eurPerParcel: number | null;
  /** Yalnız yakıt kalemi €/km — "yakıt toplamın ne kadarı" sorusunun paydası. */
  fuelEurPerKm: number | null;
  /** Yakıt kaleminin toplam içindeki payı (0-1) — null: toplam 0. */
  fuelShare: number | null;
  laborShare: number | null;
  fixedShare: number | null;
};

/** Boş payda "0 €/km" değil, "ölçülemedi"dir (bkz. lib/km-quality.ts dersi). */
function ratio(pay: number, payda: number): number | null {
  return payda > 0 ? pay / payda : null;
}

/**
 * Dört oranı dört paydaya uygular.
 *
 * Yakıt kalemi ÖLÇÜLEN litreden değil MODELDEN türer (km × L/100km): ölçülen
 * litre yalnız 23/29 araçta var ve o araç kümesi km paydasının kümesiyle aynı
 * değil. Farklı evrenleri bölmek €/km'yi sessizce bozardı. Ölçülen litre
 * raporda AYRI gösterilir ve modelle karşılaştırılır (`fuelRealityCheck`).
 */
export function computeCost(basis: CostBasis, rates: CostRates): CostBreakdown {
  const modelLiters = (basis.km * rates.lPer100Km) / 100;
  const fuelEur = modelLiters * rates.fuelEurPerL;
  const laborEur = basis.hours * rates.laborEurPerHour;
  const fixedEur = basis.vehicleDays * rates.vehicleEurPerDay;
  const totalEur = fuelEur + laborEur + fixedEur;

  return {
    modelLiters,
    fuelEur,
    laborEur,
    fixedEur,
    totalEur,
    eurPerKm: ratio(totalEur, basis.km),
    eurPerParcel: ratio(totalEur, basis.parcels),
    fuelEurPerKm: ratio(fuelEur, basis.km),
    fuelShare: ratio(fuelEur, totalEur),
    laborShare: ratio(laborEur, totalEur),
    fixedShare: ratio(fixedEur, totalEur),
  };
}

/**
 * MODEL vs ÖLÇÜM — yakıt kaleminin gerçeklik denetimi.
 *
 * Model litresi ile telemetriden ölçülen litre yakınsa oran ~1 çıkar ve
 * L/100km varsayımı doğrulanmış olur. Uzaklaşırsa ekranda görünür: model
 * yanlış oranla mı çalışıyor, yoksa sensör kapsaması mı düştü.
 *
 * `null` döner: ölçülen litre yoksa (rapor kullanılamıyor / hiç veri yok).
 */
export function fuelRealityCheck(
  modelLiters: number,
  measuredLiters: number | null
): number | null {
  if (measuredLiters === null || measuredLiters <= 0) return null;
  return modelLiters / measuredLiters;
}

/** Araç ekseninde tek satır — tablodaki €/km sütununun kaynağı. */
export type CostVehicleRow = {
  vehicleId: string;
  km: number;
  hours: number;
  vehicleDays: number;
  parcels: number;
  totalEur: number;
  eurPerKm: number | null;
  eurPerParcel: number | null;
};

/**
 * Tek aracın maliyeti — filo hesabıyla AYNI fonksiyondan geçer.
 *
 * Aynı formülü ikinci kez elle yazmıyoruz: `co2Kg()`'nin başına gelen tam
 * olarak buydu (fonksiyon tanımlıydı, çağıran katsayıyı elle çarpıyordu ve
 * formül iki yerde yaşıyordu — bkz. docs/MOBIL-KESIF.md:1296).
 */
export function computeVehicleCost(
  vehicleId: string,
  km: number,
  hours: number,
  vehicleDays: number,
  parcels: number,
  rates: CostRates
): CostVehicleRow {
  const c = computeCost(
    {
      km,
      kmShifts: 0,
      hours,
      hourShifts: 0,
      hourCapShifts: 0,
      parcels,
      parcelShifts: 0,
      vehicleDays,
      vehicles: 1,
      totalShifts: 0,
    },
    rates
  );
  return {
    vehicleId,
    km,
    hours,
    vehicleDays,
    parcels,
    totalEur: c.totalEur,
    eurPerKm: c.eurPerKm,
    eurPerParcel: c.eurPerParcel,
  };
}
