import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import {
  FUEL_PRICE_EUR_PER_L,
  FUEL_PRICE_IS_CUSTOM,
  FUEL_PRICE_SOURCE,
  FUEL_PRICE_AS_OF,
  LABOR_EUR_PER_HOUR,
  LABOR_EUR_PER_HOUR_IS_CUSTOM,
  LABOR_SOURCE,
  LABOR_AS_OF,
  VEHICLE_EUR_PER_DAY,
  VEHICLE_EUR_PER_DAY_IS_CUSTOM,
  VEHICLE_DAY_SOURCE,
  VEHICLE_DAY_AS_OF,
  FLEET_L_PER_100KM,
  FLEET_L_PER_100KM_IS_CUSTOM,
} from "@/lib/tenant";
import type { CostRates, CostRateOrigin, RateOrigin } from "@/lib/cost-model";

/**
 * MALİYET ORANLARININ KAYNAK ZİNCİRİ — tek karar yeri.
 *
 * ═══ ÜÇ KAYNAK, ÜÇ ETİKET (Volkan kararı, 23.08.2026) ═══
 *
 *   ÖLÇÜLDÜ    telemetriden gelir, kimse giremez     → L/100km
 *   GİRİLDİ     kiracının kendi rakamı               → panel satırı ya da env
 *   VARSAYILAN  bizim koyduğumuz başlangıç değeri    → kaynağıyla gösterilir
 *
 * Etiket ekranda her oranın yanında durur. Gerekçe: €/km bir KARAR sayısıdır
 * (araç alınır, güzergâh kapatılır, fiyat verilir). Karar veren kişi, baktığı
 * rakamın kendi verisi mi yoksa bizim tahminimiz mi olduğunu görmeden
 * kullanamaz. Rakiplerin "TCO" ekranları bu ayrımı çoğu zaman yapmıyor;
 * bizim ayırt edici tarafımız burası.
 *
 * ═══ ÖNCELİK ═══
 *
 *   panel satırı (tenant_cost_rates)  >  env  >  koddaki varsayılan
 *
 * Env KALDIRILMADI ama rolü değişti: artık yalnız VARSAYILAN sağlar. Panelden
 * bir değer girildiği an env sessizce devre dışı kalır — aksi hâlde müşteri
 * panelden yazar, ekran env'i gösterir ve kimse nedenini bulamazdı.
 *
 * ⚠️ ENV DE "GİRİLDİ" SAYILIR, "VARSAYILAN" DEĞİL. Env'e bir sayı yazan kişi
 * de o kiracıya ait bir karar vermiştir; onu "bizim varsayılanımız" diye
 * etiketlemek yalan olurdu. Ayrım `via` alanında: panel mı env mi.
 *
 * ═══ MIGRATION 076 YOKSA ═══
 *
 * Tablo yoksa (`tabloYokMu`) sessizce env/varsayılan zincirine düşülür ve
 * `tabloYok: true` döner. Rapor ÇALIŞMAYA DEVAM EDER; ayarlar ekranı ise
 * "migration bekliyor" der. Aynı kademeli düşüş deseni action_snoozes (058) ve
 * arıza bildiriminde (056/057) zaten var.
 *
 * ⚠️ `tabloYokMu` kolon hatasını (42703) BİLEREK yutmuyor — 11.08.2026'da bir
 * kez yuttu ve yönetici yanlış migration'ı çalıştırmaya gönderildi.
 */

/** Panelden girilmiş ham satır. Her alan null olabilir = "girilmedi". */
export type CostRateRow = {
  fuel_eur_per_l: number | null;
  labor_eur_per_hour: number | null;
  vehicle_eur_per_day: number | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type CostRateResolution = {
  rates: CostRates;
  origin: CostRateOrigin;
  /** migration 076 uygulanmamış → panel yolu kapalı, zincir env'den başlıyor. */
  tabloYok: boolean;
  /** Panelde duran ham değerler (form bunları gösterir). Tablo yoksa null. */
  row: CostRateRow | null;
};

/** Panel satırını okur. Tablo yoksa `{ row: null, tabloYok: true }`. */
export async function readCostRateRow(): Promise<{
  row: CostRateRow | null;
  tabloYok: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from("tenant_cost_rates")
    .select(
      "fuel_eur_per_l, labor_eur_per_hour, vehicle_eur_per_day, updated_at, updated_by"
    )
    .eq("id", "singleton")
    .maybeSingle();

  if (error) {
    // Tablo yok → migration bekliyor (kurtarılabilir). Başka her hata da
    // raporu çökertmemeli ama SESSİZ de kalmamalı: ikisi ayrı bayrakla döner.
    return { row: null, tabloYok: tabloYokMu(error) };
  }
  return { row: (data as CostRateRow | null) ?? null, tabloYok: false };
}

/** numeric(12,4) PostgREST'ten string gelebilir — sayıya çevir, geçersizi ele. */
function sayi(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Bir oranın kaynağını çözer: panel > env > varsayılan. */
function coz(
  panel: number | null,
  envIsCustom: boolean,
  envValue: number,
  kaynak: string,
  tarih: string
): { value: number; origin: RateOrigin } {
  if (panel !== null) {
    return { value: panel, origin: { source: "girildi", via: "panel" } };
  }
  if (envIsCustom) {
    return { value: envValue, origin: { source: "girildi", via: "env" } };
  }
  return {
    value: envValue,
    origin: { source: "varsayilan", kaynak, tarih },
  };
}

/**
 * DÖRT ORANI ÇÖZER — üç parasal oran zincirden, L/100km ÖLÇÜMDEN.
 *
 * `fleetLPer100KmMeasured` yakıt raporundan gelir (telemetri). Doluysa her
 * zaman kazanır: env'deki FLEET_L_PER_100KM yalnız ölçüm HİÇ yapılamayan
 * kurulumların yedeğidir ve o durumda etiketi "varsayılan"dır.
 */
export async function resolveCostRates(
  fleetLPer100KmMeasured: number | null
): Promise<CostRateResolution> {
  const { row, tabloYok } = await readCostRateRow();

  const fuel = coz(
    sayi(row?.fuel_eur_per_l),
    FUEL_PRICE_IS_CUSTOM,
    FUEL_PRICE_EUR_PER_L,
    FUEL_PRICE_SOURCE,
    FUEL_PRICE_AS_OF
  );
  const labor = coz(
    sayi(row?.labor_eur_per_hour),
    LABOR_EUR_PER_HOUR_IS_CUSTOM,
    LABOR_EUR_PER_HOUR,
    LABOR_SOURCE,
    LABOR_AS_OF
  );
  const vehicleDay = coz(
    sayi(row?.vehicle_eur_per_day),
    VEHICLE_EUR_PER_DAY_IS_CUSTOM,
    VEHICLE_EUR_PER_DAY,
    VEHICLE_DAY_SOURCE,
    VEHICLE_DAY_AS_OF
  );

  // L/100km — ÖLÇÜM ÖNCE. Panelde karşılığı YOK ve olmayacak (076 gerekçesi).
  const olculdu =
    fleetLPer100KmMeasured !== null && fleetLPer100KmMeasured > 0;
  const lPer100: { value: number; origin: RateOrigin } = olculdu
    ? { value: fleetLPer100KmMeasured, origin: { source: "olculdu" } }
    : FLEET_L_PER_100KM_IS_CUSTOM
      ? { value: FLEET_L_PER_100KM, origin: { source: "girildi", via: "env" } }
      : {
          value: FLEET_L_PER_100KM,
          origin: { source: "varsayilan", kaynak: "fallback", tarih: "" },
        };

  return {
    tabloYok,
    row,
    rates: {
      fuelEurPerL: fuel.value,
      lPer100Km: lPer100.value,
      laborEurPerHour: labor.value,
      vehicleEurPerDay: vehicleDay.value,
    },
    origin: {
      fuel: fuel.origin,
      lPer100: lPer100.origin,
      labor: labor.origin,
      vehicleDay: vehicleDay.origin,
    },
  };
}

export type CostRateWriteResult =
  | { ok: true }
  | { ok: false; sebep: "tablo_yok" | "hata"; mesaj?: string };

/**
 * Panelden gelen oranları yazar. NULL geçmek = "bu oranı temizle, varsayılana dön".
 *
 * Upsert: satır yoksa oluşturulur. `id` sabit olduğu için çakışma tek satırda
 * çözülür ve ikinci bir satır asla doğmaz (076'daki CHECK son hat).
 */
export async function writeCostRates(
  degerler: {
    fuel_eur_per_l: number | null;
    labor_eur_per_hour: number | null;
    vehicle_eur_per_day: number | null;
  },
  actorWorkerId: string | null
): Promise<CostRateWriteResult> {
  const { error } = await supabaseAdmin.from("tenant_cost_rates").upsert(
    {
      id: "singleton",
      ...degerler,
      updated_at: new Date().toISOString(),
      updated_by: actorWorkerId,
    },
    { onConflict: "id" }
  );
  if (error) {
    return {
      ok: false,
      sebep: tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error.message,
    };
  }
  return { ok: true };
}
