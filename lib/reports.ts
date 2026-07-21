import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeSafetyScores,
  getVehicleDistanceKm,
  listVehiclesAndWorkers,
  scoreMinKmForRange,
} from "@/lib/analytics";
import type { DateRange, SafetyScoreRow } from "@/lib/analytics-shared";
import { workedMs, kmDiff, viennaDayKey } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

/**
 * Rapor merkezi (FAZ 3) veri katmanı.
 *
 * TEK KURAL: burada YENİ bir metrik icat edilmez. Üç raporun da sayıları
 * ekranda zaten var olan hesaplardan gelir —
 *   • güvenlik skoru      → computeSafetyScores (Analiz sayfasıyla AYNI)
 *   • mesafe              → getVehicleDistanceKm (odometre uç-noktaları + km-guard)
 *   • vardiya/km/teslimat → time_entries, admin panosuyla aynı alanlar
 * Böylece "Analiz 72 diyor, rapor 68 diyor" durumu doğmaz.
 *
 * MALİYET: hiçbir rapor telemetriyi satır satır çekmez. Aralıktaki telemetri
 * hacmi gün 49 bin, hafta 239 bin satır — sayfaya taşınamaz. Mesafe bu yüzden
 * araç başına İKİ indeksli limit-1 sorgusuyla (ilk/son odometre) çözülür.
 * Ortalama/maksimum hız ve yakıt/sıcaklık serileri Postgres tarafında
 * toplulaştırma ister (RPC) — bu dosyada BİLEREK yoklar.
 */

export type SpeedRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  violations: number;
  maxSpeedKmh: number | null;
  distanceKm: number | null;
  /** 100 km başına ihlal — Analiz'in km-normalizasyonuyla aynı mantık. */
  per100Km: number | null;
};

export type SpeedReport = {
  rows: SpeedRow[];
  totalViolations: number;
  maxSpeedKmh: number | null;
  /** İhlali olan araç sayısı (filodaki toplamla kıyas için). */
  vehiclesWithViolations: number;
  vehicleCount: number;
};

export type DistanceRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  km: number | null;
  /** Aralık uzunluğuna bölünmüş günlük ortalama — dönemler kıyaslanabilsin. */
  kmPerDay: number | null;
};

export type DistanceReport = {
  rows: DistanceRow[];
  totalKm: number;
  /** Mesafesi ÖLÇÜLEBİLEN araç sayısı; geri kalanı "veri yok". */
  measured: number;
  vehicleCount: number;
  days: number;
};

export type PerformanceRow = {
  workerId: string;
  name: string;
  shifts: number;
  workedMs: number;
  km: number | null;
  delivered: number;
  undelivered: number;
  /** Analiz'deki güvenlik skorunun AYNISI (null = yeterli km yok). */
  safetyScore: number | null;
  events: number;
  harshBraking: number;
  harshAcceleration: number;
  overspeeding: number;
};

export type PerformanceReport = {
  rows: PerformanceRow[];
  /** Skoru hesaplanabilen şoförlerin ortalaması (null'lar sayılmaz). */
  avgScore: number | null;
  totalShifts: number;
  totalWorkedMs: number;
  totalKm: number;
  scoredCount: number;
};

function rangeDays(range: DateRange): number {
  return Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)
  );
}

/**
 * Üç raporun da ihtiyaç duyduğu ortak taban: araç/şoför sözlüğü, aralıktaki
 * olaylar ve araç başına mesafe. Tek yerde toplanır ki üç rapor aynı sayıyı
 * iki farklı şekilde hesaplamasın.
 */
async function loadBase(range: DateRange) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const { vehicles, workers } = await listVehiclesAndWorkers();
  const [events, idleEpisodes, distanceEntries] = await Promise.all([
    listEventsInRange(startISO, endISO),
    listIdleEpisodesInRange(startISO, endISO),
    Promise.all(
      vehicles.map(
        async (v) => [v.id, await getVehicleDistanceKm(v.id, startISO, endISO)] as const
      )
    ),
  ]);
  return {
    startISO,
    endISO,
    vehicles,
    workers,
    events,
    idleEpisodes,
    distanceByVehicle: new Map(distanceEntries),
  };
}

/** HIZ RAPORU — ihlaller `vehicle_events`'ten (gerçek olay + kayıtlı hız). */
export async function buildSpeedReport(range: DateRange): Promise<SpeedReport> {
  const base = await loadBase(range);
  const workerName = new Map(base.workers.map((w) => [w.id, w.name]));

  const byVehicle = new Map<string, { count: number; max: number | null }>();
  for (const e of base.events) {
    if (e.event_type !== "overspeeding") continue;
    const cur = byVehicle.get(e.vehicle_id) ?? { count: 0, max: null };
    cur.count += 1;
    // Olayın kendi hızı — uydurma değil, cihazın ihlal anında bildirdiği değer.
    const s = e.speed_kmh;
    if (typeof s === "number" && (cur.max === null || s > cur.max)) cur.max = s;
    byVehicle.set(e.vehicle_id, cur);
  }

  const rows: SpeedRow[] = base.vehicles.map((v) => {
    const agg = byVehicle.get(v.id);
    const km = base.distanceByVehicle.get(v.id) ?? null;
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName: v.assigned_worker_id
        ? workerName.get(v.assigned_worker_id) ?? null
        : null,
      violations: agg?.count ?? 0,
      maxSpeedKmh: agg?.max ?? null,
      distanceKm: km,
      // Km bilinmiyorsa oran da bilinmez — 0'a bölüp "0 ihlal" demeyiz.
      per100Km: km !== null && km > 0 ? ((agg?.count ?? 0) / km) * 100 : null,
    };
  });

  rows.sort((a, b) => b.violations - a.violations || a.plate.localeCompare(b.plate));
  const maxAll = rows.reduce<number | null>(
    (m, r) => (r.maxSpeedKmh !== null && (m === null || r.maxSpeedKmh > m) ? r.maxSpeedKmh : m),
    null
  );
  return {
    rows,
    totalViolations: rows.reduce((a, r) => a + r.violations, 0),
    maxSpeedKmh: maxAll,
    vehiclesWithViolations: rows.filter((r) => r.violations > 0).length,
    vehicleCount: rows.length,
  };
}

/** FİLO MESAFE — odometre uç-noktaları (getVehicleDistanceKm, km-guard dahil). */
export async function buildDistanceReport(range: DateRange): Promise<DistanceReport> {
  const base = await loadBase(range);
  const workerName = new Map(base.workers.map((w) => [w.id, w.name]));
  const days = rangeDays(range);

  const rows: DistanceRow[] = base.vehicles.map((v) => {
    const km = base.distanceByVehicle.get(v.id) ?? null;
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName: v.assigned_worker_id
        ? workerName.get(v.assigned_worker_id) ?? null
        : null,
      km,
      kmPerDay: km === null ? null : km / days,
    };
  });

  rows.sort((a, b) => (b.km ?? -1) - (a.km ?? -1) || a.plate.localeCompare(b.plate));
  const measuredRows = rows.filter((r) => r.km !== null);
  return {
    rows,
    totalKm: measuredRows.reduce((a, r) => a + (r.km ?? 0), 0),
    measured: measuredRows.length,
    vehicleCount: rows.length,
    days,
  };
}

/**
 * SÜRÜCÜ PERFORMANSI — vardiya gerçekleri (time_entries) + Analiz'in güvenlik
 * skoru + sürüş alışkanlığı olayları, tek satırda.
 */
export async function buildPerformanceReport(
  range: DateRange
): Promise<PerformanceReport> {
  const base = await loadBase(range);

  // Aralıktaki vardiyalar — admin panosuyla aynı alanlar, aynı türetmeler.
  const { data: entryData } = await supabaseAdmin
    .from("time_entries")
    .select(
      "id, worker_id, started_at, ended_at, start_km, end_km, break_minutes, cargo_count, undelivered_count"
    )
    .gte("started_at", base.startISO)
    .lte("started_at", base.endISO);
  const entries = (entryData ?? []) as TimeEntry[];

  const safety = new Map<string, SafetyScoreRow>(
    computeSafetyScores(
      base.events,
      base.idleEpisodes,
      new Map(base.vehicles.map((v) => [v.id, v])),
      new Map(base.workers.map((w) => [w.id, w])),
      base.distanceByVehicle,
      scoreMinKmForRange(range)
    ).map((r) => [r.workerId, r])
  );

  // Olay sayıları şoföre ARAÇ ÜZERİNDEN bağlanır — güvenlik skorunun kullandığı
  // eşlemenin aynısı (atanmamış araç şoför istatistiğine girmez).
  const vehicleWorker = new Map(
    base.vehicles.map((v) => [v.id, v.assigned_worker_id ?? null])
  );
  type EvAcc = { total: number; braking: number; accel: number; speeding: number };
  const evByWorker = new Map<string, EvAcc>();
  for (const e of base.events) {
    const wid = vehicleWorker.get(e.vehicle_id);
    if (!wid) continue;
    const a =
      evByWorker.get(wid) ?? { total: 0, braking: 0, accel: 0, speeding: 0 };
    a.total += 1;
    if (e.event_type === "harsh_braking") a.braking += 1;
    else if (e.event_type === "harsh_acceleration") a.accel += 1;
    else if (e.event_type === "overspeeding") a.speeding += 1;
    evByWorker.set(wid, a);
  }

  type ShiftAcc = { shifts: number; ms: number; km: number; hasKm: boolean; delivered: number; undelivered: number };
  const shiftByWorker = new Map<string, ShiftAcc>();
  for (const e of entries) {
    if (!e.worker_id) continue;
    const a =
      shiftByWorker.get(e.worker_id) ??
      { shifts: 0, ms: 0, km: 0, hasKm: false, delivered: 0, undelivered: 0 };
    a.shifts += 1;
    a.ms += workedMs(e);
    const km = kmDiff(e);
    if (km !== null) {
      a.km += km;
      a.hasKm = true;
    }
    // Teslim edilen yalnız KAPANMIŞ vardiyada gerçektir (açık vardiyada
    // cargo_count hâlâ gün başı yer tutucusu) — panoyla aynı kural.
    if (e.ended_at !== null && e.cargo_count !== null) a.delivered += e.cargo_count;
    if (e.undelivered_count !== null) a.undelivered += e.undelivered_count;
    shiftByWorker.set(e.worker_id, a);
  }

  const rows: PerformanceRow[] = [];
  for (const w of base.workers) {
    const s = shiftByWorker.get(w.id);
    const ev = evByWorker.get(w.id);
    const sc = safety.get(w.id);
    // Aralıkta ne vardiyası ne olayı olan şoför rapora girmez — 0'larla dolu
    // satır, "çalışmadı" ile "veri yok"u karıştırır.
    if (!s && !ev) continue;
    rows.push({
      workerId: w.id,
      name: w.name,
      shifts: s?.shifts ?? 0,
      workedMs: s?.ms ?? 0,
      km: s?.hasKm ? s.km : null,
      delivered: s?.delivered ?? 0,
      undelivered: s?.undelivered ?? 0,
      safetyScore: sc?.score ?? null,
      events: ev?.total ?? 0,
      harshBraking: ev?.braking ?? 0,
      harshAcceleration: ev?.accel ?? 0,
      overspeeding: ev?.speeding ?? 0,
    });
  }

  // Sıralama: skoru olan şoförler önce (yüksek → düşük), skorsuzlar sonda.
  rows.sort((a, b) => {
    if (a.safetyScore === null && b.safetyScore === null) return b.shifts - a.shifts;
    if (a.safetyScore === null) return 1;
    if (b.safetyScore === null) return -1;
    return b.safetyScore - a.safetyScore;
  });

  const scored = rows.filter((r) => r.safetyScore !== null);
  return {
    rows,
    avgScore: scored.length
      ? Math.round(scored.reduce((a, r) => a + (r.safetyScore ?? 0), 0) / scored.length)
      : null,
    totalShifts: rows.reduce((a, r) => a + r.shifts, 0),
    totalWorkedMs: rows.reduce((a, r) => a + r.workedMs, 0),
    totalKm: rows.reduce((a, r) => a + (r.km ?? 0), 0),
    scoredCount: scored.length,
  };
}

/** Rapor başlığında gösterilecek dönem etiketi (gün sayısı + tarih aralığı). */
export function rangeLabel(range: DateRange): { from: string; to: string; days: number } {
  return {
    from: viennaDayKey(range.start),
    to: viennaDayKey(range.end),
    days: rangeDays(range),
  };
}
