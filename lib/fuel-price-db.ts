import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import type { FuelPriceRecord } from "@/lib/fuel-price-source";

/**
 * YAKIT FİYATI REFERANSI — okuma/yazma ve TAZELİK sınıflaması.
 *
 * ═══ TAZELİK EŞİKLERİ KAYNAĞIN RİTMİNDEN TÜRETİLİR ═══
 *
 * Sabit "10 gün" yazmak, aylık yayınlanan bir kaynağı (İsviçre BFS) doğduğu
 * gün bayat ilan ederdi. Eşik her satırın kendi `expected_period_days`
 * değerinden hesaplanır:
 *
 *   taze  ≤ periyot + 3        haftalıkta 10 gün
 *   bayat ≤ taze + 21          haftalıkta 31 gün
 *   üstü  → terk
 *
 * +3 nereden: kaynağın yayın gecikmesi (WOB Pazartesi'yi ölçer, Perşembe
 * yayınlar). Yani sağlıklı işleyişte veri en fazla periyot+3 günlük olur;
 * bunu aşmak FİYAT HAREKETİNİN değil, kaynağın ya da cron'un durduğunun
 * sinyalidir. +21 ise "hâlâ gerçek ama yaşı görünmeli" bandı: bir haftalık
 * kaynakta üç yayın kaçmışsa sayı hâlâ kullanılabilir, güvenilirliği düşer.
 *
 * ═══ BAYATLIK reference_date'TEN ÖLÇÜLÜR ═══
 *
 * `fetched_at` DEĞİL. Cron her gün başarıyla koşup aynı haftalık satırı
 * yeniden yazsa bile veri yaşlanır; fetched_at'e bakan bir ölçü, çalışan bir
 * cron'u "taze veri" sanardı.
 */

export type FuelPriceFreshness = "taze" | "bayat" | "terk";

export type FuelPriceRow = {
  countryCode: string;
  fuelType: string;
  referenceDate: string;
  priceEur: number;
  currency: string;
  statistic: string;
  sourceKey: string;
  sourceUrl: string;
  licenseNote: string;
  expectedPeriodDays: number;
  fetchedAt: string | null;
};

export type FuelPriceLookup = {
  row: FuelPriceRow | null;
  /** Satır yoksa null. */
  freshness: FuelPriceFreshness | null;
  /** reference_date'ten bugüne tam gün. */
  ageDays: number | null;
  /** migration 077 uygulanmamış → referans yolu kapalı, zincir env'e düşer. */
  tabloYok: boolean;
};

/** Yayın gecikmesi payı — "sağlıklı işleyişte veri en fazla bu kadar eskir". */
const YAYIN_GECIKMESI_GUN = 3;
/** Bayat bandının genişliği: hâlâ gerçek ama yaşı görünmeli. */
const BAYAT_PAYI_GUN = 21;

export function tazelikEsikleri(expectedPeriodDays: number): {
  tazeMax: number;
  bayatMax: number;
} {
  const tazeMax = expectedPeriodDays + YAYIN_GECIKMESI_GUN;
  return { tazeMax, bayatMax: tazeMax + BAYAT_PAYI_GUN };
}

export function tazelikSinifla(
  ageDays: number,
  expectedPeriodDays: number
): FuelPriceFreshness {
  const { tazeMax, bayatMax } = tazelikEsikleri(expectedPeriodDays);
  if (ageDays <= tazeMax) return "taze";
  if (ageDays <= bayatMax) return "bayat";
  return "terk";
}

function gunFarki(isoDate: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(isoDate + "T00:00:00Z")) / 86_400_000);
}

/**
 * Bir ülke+yakıt için EN YENİ referans satırını okur.
 *
 * ⚠️ Kaynak seçmiyor: aynı gün için birden çok kaynaktan satır varsa (çapraz
 * kontrol senaryosu) `reference_date` en yeni olan kazanır, eşitlikte
 * `fetched_at`. Bugün tek kaynak var; bu sıralama o gün için hazır duruyor.
 */
export async function readLatestFuelPrice(
  countryCode: string,
  fuelType: string,
  now: Date = new Date()
): Promise<FuelPriceLookup> {
  const { data, error } = await supabaseAdmin
    .from("fuel_price_reference")
    .select(
      "country_code, fuel_type, reference_date, price_eur, currency, statistic, source_key, source_url, license_note, expected_period_days, fetched_at"
    )
    .eq("country_code", countryCode)
    .eq("fuel_type", fuelType)
    .order("reference_date", { ascending: false })
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { row: null, freshness: null, ageDays: null, tabloYok: tabloYokMu(error) };
  }
  if (!data) return { row: null, freshness: null, ageDays: null, tabloYok: false };

  const d = data as Record<string, unknown>;
  const row: FuelPriceRow = {
    countryCode: String(d.country_code),
    fuelType: String(d.fuel_type),
    referenceDate: String(d.reference_date),
    // numeric PostgREST'ten string gelebilir.
    priceEur: Number(d.price_eur),
    currency: String(d.currency),
    statistic: String(d.statistic),
    sourceKey: String(d.source_key),
    sourceUrl: String(d.source_url),
    licenseNote: String(d.license_note),
    expectedPeriodDays: Number(d.expected_period_days),
    fetchedAt: d.fetched_at ? String(d.fetched_at) : null,
  };
  if (!Number.isFinite(row.priceEur) || row.priceEur <= 0) {
    // Bozuk satır YOK sayılır — hesabı sessizce sıfıra çekmesindense zincir
    // bir alt kademeye düşsün.
    return { row: null, freshness: null, ageDays: null, tabloYok: false };
  }
  const ageDays = gunFarki(row.referenceDate, now);
  return {
    row,
    ageDays,
    freshness: tazelikSinifla(ageDays, row.expectedPeriodDays),
    tabloYok: false,
  };
}

export type FuelPriceWriteResult =
  | { ok: true; yazilan: number }
  | { ok: false; sebep: "tablo_yok" | "hata"; mesaj?: string };

/**
 * Cron'un yazma yolu. Upsert — 077'deki UNIQUE (ülke, yakıt, tarih, kaynak)
 * üzerinden idempotent: aynı gün beş kez koşsa da tek satır kalır.
 */
export async function upsertFuelPrices(
  records: FuelPriceRecord[]
): Promise<FuelPriceWriteResult> {
  if (records.length === 0) return { ok: true, yazilan: 0 };
  const { error } = await supabaseAdmin.from("fuel_price_reference").upsert(
    records.map((r) => ({
      country_code: r.countryCode,
      fuel_type: r.fuelType,
      reference_date: r.referenceDate,
      price: r.price,
      currency: r.currency,
      price_eur: r.priceEur,
      // Kaynak EUR yayınlıyor → çevrim yok. CH/TR geldiğinde burası dolacak.
      fx_rate: null,
      statistic: r.statistic,
      source_key: r.sourceKey,
      source_url: r.sourceUrl,
      license_note: r.licenseNote,
      expected_period_days: r.expectedPeriodDays,
      fetched_at: new Date().toISOString(),
    })),
    { onConflict: "country_code,fuel_type,reference_date,source_key" }
  );
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  return { ok: true, yazilan: records.length };
}
