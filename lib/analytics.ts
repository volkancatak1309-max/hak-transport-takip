import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  startOfWeekVienna,
  endOfWeekVienna,
  startOfMonthVienna,
  endOfMonthVienna,
  startOfDayViennaFromYmd,
  endOfDayViennaFromYmd,
  viennaDayKey,
} from "@/lib/format";
import { IDLE_TRIGGER_S } from "@/lib/telemetry";
import type { VehicleEventWithPlate, IdleEpisodeWithPlate } from "@/lib/telemetry";
import {
  SAFETY_SCORE_WEIGHTS,
  IDLE_FUEL_L_PER_HOUR,
  DIESEL_EUR_PER_L,
  TOP10_EVENT_TYPES,
  type AnalyticsRangeKey,
  type DateRange,
  type Top10EventType,
  type VehicleLite,
  type WorkerLite,
  type DriverTally,
  type EventTypeAgg,
  type SafetyScoreRow,
  type IdleWasteRow,
  type IdleWasteSummary,
} from "@/lib/analytics-shared";

// Client-safe sabitler/türler lib/analytics-shared.ts'te yaşar; burada
// yeniden dışa verilir ki mevcut çağıranlar (page.tsx) tek yerden import etsin.
export {
  SAFETY_SCORE_WEIGHTS,
  IDLE_FUEL_L_PER_HOUR,
  DIESEL_EUR_PER_L,
  TOP10_EVENT_TYPES,
  type AnalyticsRangeKey,
  type DateRange,
  type Top10EventType,
  type VehicleLite,
  type WorkerLite,
  type DriverTally,
  type EventTypeAgg,
  type SafetyScoreRow,
  type IdleWasteRow,
  type IdleWasteSummary,
};

/**
 * /admin/analiz veri katmanı — FAZ 1: olay-tipi top-10, güvenlik skoru,
 * rölanti israf panosu. Tüm ağır hesap burada (server-only); client yalnız
 * render eder. Tarih aralığı hesapları Europe/Vienna (lib/format.ts ile aynı
 * DST-güvenli desen). İstemci-güvenli türler/sabitler → lib/analytics-shared.ts.
 */

// Filo bu tarihten eskiye gitmiyor — "tüm zamanlar" alt sınırı, sonsuz sorgu
// aralığından kaçınır (fetchAllRows'un tüm tabloyu taramasını sınırlar).
const FLEET_EPOCH = new Date("2026-06-01T00:00:00.000Z");

/**
 * Güvenlik skoru için "yeterli sürüş" eşiği — GÜN BAŞINA minimum güvenilir km.
 * Toplam eşik seçili aralığa göre ölçeklenir (bkz. scoreMinKmForRange): günlük
 * ~40 km, haftalık ~280 km, aylık ~1200 km. Sebep: "adil bir skor için gereken
 * sürüş" pencere uzunluğuyla orantılıdır — SABİT 150 km günlük görünümde neredeyse
 * herkesi "veri yok" yapardı. AYARLANABİLİR: firmanın günlük teslimat km yoğunluğuna
 * göre tek yerden değiştirilir.
 */
export const SCORE_MIN_KM_PER_DAY = 40;

/**
 * Aralık için toplam km eşiği = SCORE_MIN_KM_PER_DAY × aralığın GEÇEN gün sayısı.
 * "Geçen": dönem sonu gelecekteyse (bu hafta/bu ay) şimdiye kadar kırpılır —
 * telemetri km'si de yalnız şimdiye kadar biriktiği için eşik de öyle olmalı ki
 * hafta/ay ortasında herkes haksızca "veri yok" düşmesin. En az 1 gün.
 */
export function scoreMinKmForRange(range: DateRange): number {
  const effectiveEnd = Math.min(Date.now(), range.end.getTime());
  const spanMs = Math.max(0, effectiveEnd - range.start.getTime());
  const spanDays = Math.max(1, Math.round(spanMs / 86_400_000));
  return SCORE_MIN_KM_PER_DAY * spanDays;
}

export function computeAnalyticsRange(
  key: AnalyticsRangeKey,
  customFrom?: string | null,
  customTo?: string | null
): DateRange {
  switch (key) {
    case "gun":
      return { start: startOfTodayVienna(), end: endOfTodayVienna() };
    case "ay":
      return { start: startOfMonthVienna(), end: endOfMonthVienna() };
    case "ozel": {
      const start = (customFrom && startOfDayViennaFromYmd(customFrom)) || startOfWeekVienna();
      const end = (customTo && endOfDayViennaFromYmd(customTo)) || endOfWeekVienna();
      return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
    }
    case "tumzaman":
      return { start: FLEET_EPOCH, end: endOfTodayVienna() };
    case "hafta":
    default:
      return { start: startOfWeekVienna(), end: endOfWeekVienna() };
  }
}

/**
 * Aynı uzunlukta ÖNCEKİ dönem — trend oku için. "Tüm zamanlar"da veya
 * dönem filo başlangıcına dayanıyorsa önceki dönem anlamsız → null.
 */
export function previousPeriod(range: DateRange): DateRange | null {
  const spanMs = range.end.getTime() - range.start.getTime();
  if (spanMs <= 0) return null;
  if (range.start.getTime() <= FLEET_EPOCH.getTime()) return null;
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  return {
    start: prevStart.getTime() < FLEET_EPOCH.getTime() ? FLEET_EPOCH : prevStart,
    end: prevEnd,
  };
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

export async function listVehiclesAndWorkers(): Promise<{
  vehicles: VehicleLite[];
  workers: WorkerLite[];
}> {
  const scope = await getTestScope();
  // test-filtered: dropTestRows — Analiz sayfasının ve Hız/Mesafe/Performans
  // raporlarının ORTAK araç/şoför evreni (lib/reports.ts loadBase buradan okur).
  const [{ data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate, assigned_worker_id"),
    supabaseAdmin.from("workers").select("id, name").eq("is_active", true),
  ]);
  return {
    vehicles: dropTestRows(
      (vData ?? []) as VehicleLite[],
      (v) => ({ vehicle: v.id }),
      scope
    ),
    workers: dropTestRows(
      (wData ?? []) as WorkerLite[],
      (w) => ({ worker: w.id }),
      scope
    ),
  };
}

/**
 * Bir günde bir teslimat aracının makul üst sınırı — bu değeri aşan bir
 * "mesafe" test/demo verisindeki bozuk tek bir odometer okumasının belirtisidir
 * (QA'da görüldü: bir ay filtresinde bir şoför için 124.181 km çıktı — gerçek
 * bir teslimat aracı bunu süremez). Böyle durumlarda km UYDURULMAK yerine
 * güvenilmez sayılır, çağıran gün-bazlı normalizasyona düşer.
 */
const MAX_PLAUSIBLE_KM_PER_DAY = 800;

/**
 * Bir aracın seçili aralıktaki kat ettiği mesafe (km), device_telemetry'nin
 * odometer_km alanından. Aralıktaki EN ERKEN ve EN GEÇ dolu okumanın farkı —
 * tüm satırları çekmez (28 araçlık filoda ucuz, 2 indeksli sorgu). Yeterli
 * okuma yoksa, fark negatifse (sayaç sıfırlanmışsa) veya günlük makul üst
 * sınırı (bozuk tekil okuma belirtisi) aşıyorsa null döner — çağıran bu
 * durumda km yerine gün-bazlı normalizasyona düşer, UYDURMA km üretilmez.
 */
export async function getVehicleDistanceKm(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<number | null> {
  const [{ data: first }, { data: last }] = await Promise.all([
    supabaseAdmin
      .from("device_telemetry")
      .select("odometer_km")
      .eq("vehicle_id", vehicleId)
      .not("odometer_km", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("device_telemetry")
      .select("odometer_km")
      .eq("vehicle_id", vehicleId)
      .not("odometer_km", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const a = first?.odometer_km as number | null | undefined;
  const b = last?.odometer_km as number | null | undefined;
  if (a == null || b == null) return null;
  const diff = b - a;
  if (diff < 0) return null;
  const spanDays = Math.max(1, (new Date(endISO).getTime() - new Date(startISO).getTime()) / 86_400_000);
  if (diff > spanDays * MAX_PLAUSIBLE_KM_PER_DAY) return null;
  return diff;
}

function idleEpisodeDurationMs(ep: { started_at: string; ended_at: string | null; last_seen_at: string }): number {
  const startMs = new Date(ep.started_at).getTime();
  const endMs = new Date(ep.ended_at ?? ep.last_seen_at).getTime();
  return Math.max(0, endMs - startMs) + IDLE_TRIGGER_S * 1000;
}

function resolveDriver(
  vehicleId: string,
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): { key: string; label: string; workerId: string | null } {
  const v = vehiclesById.get(vehicleId);
  const plate = v?.plate ?? "—";
  if (v?.assigned_worker_id) {
    const w = workersById.get(v.assigned_worker_id);
    if (w) return { key: v.assigned_worker_id, label: w.name, workerId: v.assigned_worker_id };
  }
  return { key: `unassigned:${vehicleId}`, label: `Atanmamış · ${plate}`, workerId: null };
}

// ── Bölüm 1: olay tipi bazında top-10 personel ──────────────────────────────

export function computeTopDriversByType(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): Record<Top10EventType, EventTypeAgg> {
  const buckets = new Map<Top10EventType, Map<string, DriverTally>>();
  for (const ty of TOP10_EVENT_TYPES) buckets.set(ty, new Map());
  let idlingTotal = 0;

  for (const e of events) {
    const ty = e.event_type as Top10EventType;
    const map = buckets.get(ty);
    if (!map || ty === "idling") continue; // idling bu listede idle_episodes'tan gelir
    const { key, label } = resolveDriver(e.vehicle_id, vehiclesById, workersById);
    const cur = map.get(key) ?? { key, label, count: 0 };
    cur.count++;
    if (ty === "overspeeding" && e.speed_kmh != null) {
      cur.maxSpeedKmh = Math.max(cur.maxSpeedKmh ?? 0, e.speed_kmh);
    }
    map.set(key, cur);
  }

  const idleMap = buckets.get("idling")!;
  for (const ep of idleEpisodes) {
    idlingTotal++;
    const { key, label } = resolveDriver(ep.vehicle_id, vehiclesById, workersById);
    const durationMs = idleEpisodeDurationMs(ep);
    const cur = idleMap.get(key) ?? { key, label, count: 0, idleMs: 0 };
    cur.count++;
    cur.idleMs = (cur.idleMs ?? 0) + durationMs;
    idleMap.set(key, cur);
  }

  const out = {} as Record<Top10EventType, EventTypeAgg>;
  for (const ty of TOP10_EVENT_TYPES) {
    const map = buckets.get(ty)!;
    const arr = [...map.values()];
    arr.sort((a, b) =>
      ty === "overspeeding"
        ? b.count - a.count || (b.maxSpeedKmh ?? 0) - (a.maxSpeedKmh ?? 0)
        : ty === "idling"
          ? (b.idleMs ?? 0) - (a.idleMs ?? 0)
          : b.count - a.count
    );
    const total = ty === "idling" ? idlingTotal : arr.reduce((s, r) => s + r.count, 0);
    out[ty] = { total, rows: arr.slice(0, 10) };
  }
  return out;
}

// ── Bölüm 2: şoför güvenlik skoru ────────────────────────────────────────────

export function computeSafetyScores(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>,
  distanceByVehicle: Map<string, number | null>,
  minKm: number
): SafetyScoreRow[] {
  type Acc = { penalty: number; totalEvents: number; days: Set<string> };
  const acc = new Map<string, Acc>();

  function bump(workerId: string, weight: number, dayKey: string) {
    const cur = acc.get(workerId) ?? { penalty: 0, totalEvents: 0, days: new Set<string>() };
    cur.penalty += weight;
    cur.totalEvents += 1;
    cur.days.add(dayKey);
    acc.set(workerId, cur);
  }

  for (const e of events) {
    const v = vehiclesById.get(e.vehicle_id);
    if (!v?.assigned_worker_id) continue; // atanmamış araç şoför liginde yer almaz
    const weight = SAFETY_SCORE_WEIGHTS[e.event_type];
    if (weight === undefined) continue;
    bump(v.assigned_worker_id, weight, viennaDayKey(e.occurred_at));
  }
  for (const ep of idleEpisodes) {
    const v = vehiclesById.get(ep.vehicle_id);
    if (!v?.assigned_worker_id) continue;
    bump(v.assigned_worker_id, SAFETY_SCORE_WEIGHTS.idling ?? 0, viennaDayKey(ep.started_at));
  }

  // Şoför → atanmış araç(lar). Temiz (hiç olayı olmayan) şoförün de km'sini bilmek
  // için TÜM araçlardan kurulur, yalnız olay üreten araçlardan değil. Böylece "çok
  // sürüp hiç ihlal yapmayan" şoför gerçek km'siyle skor alır (eskiden zorla 100'dü).
  const vehiclesByWorker = new Map<string, string[]>();
  for (const v of vehiclesById.values()) {
    if (!v.assigned_worker_id) continue;
    const arr = vehiclesByWorker.get(v.assigned_worker_id) ?? [];
    arr.push(v.id);
    vehiclesByWorker.set(v.assigned_worker_id, arr);
  }

  const rows: SafetyScoreRow[] = [];
  for (const w of workersById.values()) {
    const a = acc.get(w.id);
    const penalty = a?.penalty ?? 0;
    const totalEvents = a?.totalEvents ?? 0;
    const activeDays = a?.days.size ?? 0;

    // Güvenilir km: şoförün atanmış araçlarının toplam mesafesi (null okumalar
    // hariç). Hiç güvenilir okuma yoksa null (yetersiz veri).
    let km = 0;
    let anyKm = false;
    for (const vid of vehiclesByWorker.get(w.id) ?? []) {
      const d = distanceByVehicle.get(vid);
      if (d != null) {
        km += d;
        anyKm = true;
      }
    }
    const reliableKm = anyKm ? km : null;

    // YETERLİ VERİ KAPISI: güvenilir km eşiğin altındaysa (ya da hiç yoksa) SKOR
    // YOK → null ("Veri yok"). Ne yeşil 100 ne kırmızı 0. Skor SADECE eşiği geçen
    // şoför için, ihlal/1000km oranıyla hesaplanır — düşük skor artık yalnız
    // "yeterince sürüp çok ihlal yapan"a düşer, seyrek-veri gürültüsüne değil.
    const qualifies = reliableKm != null && reliableKm >= minKm;
    const score = qualifies
      ? Math.max(0, Math.min(100, Math.round(100 - penalty / (reliableKm! / 1000))))
      : null;

    rows.push({
      workerId: w.id,
      name: w.name,
      score,
      totalEvents,
      penalty,
      basis: "km",
      distanceKm: reliableKm,
      activeDays,
      trend: null,
      prevScore: null,
    });
  }

  // Skorlular önce (skora göre azalan, eşitlikte olayı çok olan aşağıda), "veri
  // yok" olanlar en altta ayrı — cezalandırılmış gibi değil, isimle sıralı.
  rows.sort((a, b) => {
    const an = a.score === null;
    const bn = b.score === null;
    if (an !== bn) return an ? 1 : -1;
    if (!an && !bn) return (b.score as number) - (a.score as number) || b.totalEvents - a.totalEvents;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

// ── Bölüm 3: rölanti israf panosu ────────────────────────────────────────────

export function computeIdleWaste(
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): IdleWasteSummary {
  const acc = new Map<string, { totalMs: number; episodeCount: number }>();
  let totalMs = 0;

  for (const ep of idleEpisodes) {
    const durationMs = idleEpisodeDurationMs(ep);
    totalMs += durationMs;
    const { key } = resolveDriver(ep.vehicle_id, vehiclesById, workersById);
    const cur = acc.get(key) ?? { totalMs: 0, episodeCount: 0 };
    cur.totalMs += durationMs;
    cur.episodeCount += 1;
    acc.set(key, cur);
  }

  const rows: IdleWasteRow[] = [...acc.entries()].map(([key, a]) => {
    const label = key.startsWith("unassigned:")
      ? resolveDriver(key.slice("unassigned:".length), vehiclesById, workersById).label
      : (workersById.get(key)?.name ?? "—");
    const hours = a.totalMs / 3_600_000;
    const liters = hours * IDLE_FUEL_L_PER_HOUR;
    return { key, name: label, totalMs: a.totalMs, episodeCount: a.episodeCount, liters, euro: liters * DIESEL_EUR_PER_L };
  });
  rows.sort((a, b) => b.totalMs - a.totalMs);

  const totalHours = totalMs / 3_600_000;
  const totalEuro = totalHours * IDLE_FUEL_L_PER_HOUR * DIESEL_EUR_PER_L;
  return { rows, totalMs, totalEuro };
}
