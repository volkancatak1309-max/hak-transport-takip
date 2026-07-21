/**
 * /admin/analiz — istemci-güvenli türler + sabitler (DB erişimi yok, "server-only"
 * DEĞİL). lib/analytics.ts (server-only, Supabase sorguları) bunları içe aktarıp
 * yeniden dışa verir; AnalizClient.tsx yalnız BU dosyadan import eder — aksi
 * halde server-only zinciri (supabaseAdmin/flespi) istemci paketine sızar.
 */

export type AnalyticsRangeKey = "gun" | "hafta" | "ay" | "ozel" | "tumzaman";

export type DateRange = { start: Date; end: Date };

/**
 * Güvenlik skoru ceza ağırlıkları — 100 puandan bu ağırlıklarla düşülür.
 * Aşırı hız + sinyal karıştırma en ağır (25), sert fren/hızlanma/viraj orta
 * (12), uzun rölanti hafif (5). AYARLANABİLİR — firma politikasına göre
 * değiştirilebilir, tek kaynak burası.
 */
export const SAFETY_SCORE_WEIGHTS: Record<string, number> = {
  overspeeding: 25,
  jamming: 25,
  harsh_braking: 12,
  harsh_acceleration: 12,
  harsh_cornering: 12,
  idling: 5,
};

/** Rölanti israfı tahmin katsayıları — AYARLANABİLİR, firma değerine göre. */
export const IDLE_FUEL_L_PER_HOUR = 0.9;
export const DIESEL_EUR_PER_L = 1.65;

export const TOP10_EVENT_TYPES = [
  "harsh_acceleration",
  "harsh_cornering",
  "harsh_braking",
  "overspeeding",
  "idling",
  "jamming",
] as const;
export type Top10EventType = (typeof TOP10_EVENT_TYPES)[number];

export type VehicleLite = { id: string; plate: string; assigned_worker_id: string | null };
export type WorkerLite = { id: string; name: string };

export type DriverTally = {
  key: string;
  label: string;
  count: number;
  /** Yalnız overspeeding — o türdeki en yüksek hız. */
  maxSpeedKmh?: number;
  /** Yalnız idling — toplam epizod süresi (ms). */
  idleMs?: number;
};

export type EventTypeAgg = {
  /** Seçili aralıkta bu tipten TÜM olaylar (yalnız top-10'un toplamı değil). */
  total: number;
  rows: DriverTally[];
};

export type SafetyScoreRow = {
  workerId: string;
  name: string;
  score: number;
  totalEvents: number;
  penalty: number;
  /** Ceza hangi birimle normalize edildi — km varsa km, yoksa gün. */
  basis: "km" | "gun";
  distanceKm: number | null;
  activeDays: number;
  trend: "up" | "down" | "flat" | null;
  prevScore: number | null;
};

export type IdleWasteRow = {
  key: string;
  name: string;
  totalMs: number;
  episodeCount: number;
  liters: number;
  euro: number;
};

export type IdleWasteSummary = { rows: IdleWasteRow[]; totalMs: number; totalEuro: number };
