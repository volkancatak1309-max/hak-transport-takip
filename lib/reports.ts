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

// ── YAKIT RAPORU (fuel) ─────────────────────────────────────────────────────
//
// Kaynak: device_telemetry.fuel_level_pct (cihazın gerçek % okuması) +
// vehicles.tank_capacity_l. Yüzde istatistikleri 258 bin satırlık telemetriden
// Postgres tarafında toplulaştırılır (report_fuel_stats RPC, migration 026) —
// satırlar sayfaya taşınmaz. Litre/L100km çevrimi BURADA, kapasiteyle yapılır;
// kapasitesi olmayan araçta (DO-671GY) yalnız % gösterilir, UYDURMA litre yok.

export type FuelRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  /** vehicles.tank_capacity_l — null ise litre/L100km hesaplanamaz. */
  tankCapacityL: number | null;
  /** RPC bu araç için satır döndü mü (aralıkta yakıt okuması var mı). */
  hasData: boolean;
  sampleCount: number;
  avgPct: number | null;
  minPct: number | null;
  maxPct: number | null;
  refillCount: number;
  refillPct: number;
  /** Kapasite biliniyorsa dolum litresi, yoksa null. */
  refillLiters: number | null;
  /** Dönemde yakılan yakıt = dolumlar + (ilk − son), 0'a kırpılı (yüzde). */
  consumedPct: number;
  consumedLiters: number | null;
  km: number | null;
  lPer100Km: number | null;
  /** Hareketsizken düşüş = olası kaçak/hırsızlık (odometre ilerlemedi). */
  suspiciousDropCount: number;
  suspiciousDropPct: number;
  suspiciousDropLiters: number | null;
};

export type FuelReport = {
  /** false → report_fuel_stats fonksiyonu henüz yok (migration 026 bekliyor). */
  available: boolean;
  rows: FuelRow[];
  vehicleCount: number;
  /** Aralıkta yakıt verisi olan araç sayısı. */
  measured: number;
  /** Kapasitesi bilinen araçların toplam tüketimi (litre). */
  totalConsumedLiters: number;
  fleetLPer100Km: number | null;
  refillTotalCount: number;
  refillTotalLiters: number;
  /** En az bir şüpheli düşüşü olan araç sayısı. */
  suspiciousVehicles: number;
  /** Verisi olan ama kapasitesi girilmemiş araç sayısı (litre gösterilemez). */
  capacityMissing: number;
};

type FuelStatRow = {
  vehicle_id: string;
  sample_count: number;
  avg_pct: number | null;
  min_pct: number | null;
  max_pct: number | null;
  first_pct: number | null;
  last_pct: number | null;
  refill_count: number;
  refill_pct: number;
  drop_count: number;
  drop_pct: number;
};

export async function buildFuelReport(range: DateRange): Promise<FuelReport> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  const [{ data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin
      .from("vehicles")
      .select("id, plate, assigned_worker_id, tank_capacity_l"),
    supabaseAdmin.from("workers").select("id, name").eq("is_active", true),
  ]);
  const vehicles = (vData ?? []) as {
    id: string;
    plate: string;
    assigned_worker_id: string | null;
    tank_capacity_l: number | null;
  }[];
  const workerName = new Map(
    ((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name])
  );

  const empty = (): FuelReport => ({
    available: false,
    rows: [],
    vehicleCount: vehicles.length,
    measured: 0,
    totalConsumedLiters: 0,
    fleetLPer100Km: null,
    refillTotalCount: 0,
    refillTotalLiters: 0,
    suspiciousVehicles: 0,
    capacityMissing: 0,
  });

  // 258 bin satır Postgres'te toplulaştırılır. Fonksiyon yoksa (migration 026
  // uygulanmadıysa) rapor çökmez — "migrasyon bekliyor" boş durumuna düşer.
  const { data: statData, error } = await supabaseAdmin.rpc("report_fuel_stats", {
    p_from: startISO,
    p_to: endISO,
  });
  if (error) return empty();

  const stats = new Map(
    ((statData ?? []) as FuelStatRow[]).map((s) => [s.vehicle_id, s])
  );

  // L/100km için mesafe — mesafe raporuyla AYNI kaynak (odometre uç-noktaları +
  // km-guard). Araç başına iki indeksli sorgu, telemetri satırı taşımaz.
  const distEntries = await Promise.all(
    vehicles.map(
      async (v) => [v.id, await getVehicleDistanceKm(v.id, startISO, endISO)] as const
    )
  );
  const distByVehicle = new Map(distEntries);

  const rows: FuelRow[] = vehicles.map((v) => {
    const cap = v.tank_capacity_l != null ? Number(v.tank_capacity_l) : null;
    const km = distByVehicle.get(v.id) ?? null;
    const driverName = v.assigned_worker_id
      ? workerName.get(v.assigned_worker_id) ?? null
      : null;
    const s = stats.get(v.id);
    if (!s || Number(s.sample_count) === 0) {
      return {
        vehicleId: v.id,
        plate: v.plate,
        driverName,
        tankCapacityL: cap,
        hasData: false,
        sampleCount: 0,
        avgPct: null,
        minPct: null,
        maxPct: null,
        refillCount: 0,
        refillPct: 0,
        refillLiters: null,
        consumedPct: 0,
        consumedLiters: null,
        km,
        lPer100Km: null,
        suspiciousDropCount: 0,
        suspiciousDropPct: 0,
        suspiciousDropLiters: null,
      };
    }
    const first = s.first_pct != null ? Number(s.first_pct) : 0;
    const last = s.last_pct != null ? Number(s.last_pct) : 0;
    const refillPct = Number(s.refill_pct) || 0;
    const dropPct = Number(s.drop_pct) || 0;
    // Yakıt dengesi kimliği: yakılan = alınan (dolum) + net düşüş (ilk − son).
    // Küçük gürültüde negatife düşerse 0'a kırpılır (net dolu bitti demektir).
    const consumedPct = Math.max(0, refillPct + (first - last));
    const consumedLiters = cap != null ? (consumedPct / 100) * cap : null;
    const lPer100Km =
      consumedLiters != null && km != null && km > 0
        ? (consumedLiters / km) * 100
        : null;
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName,
      tankCapacityL: cap,
      hasData: true,
      sampleCount: Number(s.sample_count),
      avgPct: s.avg_pct != null ? Number(s.avg_pct) : null,
      minPct: s.min_pct != null ? Number(s.min_pct) : null,
      maxPct: s.max_pct != null ? Number(s.max_pct) : null,
      refillCount: Number(s.refill_count) || 0,
      refillPct,
      refillLiters: cap != null ? (refillPct / 100) * cap : null,
      consumedPct,
      consumedLiters,
      km,
      lPer100Km,
      suspiciousDropCount: Number(s.drop_count) || 0,
      suspiciousDropPct: dropPct,
      suspiciousDropLiters: cap != null ? (dropPct / 100) * cap : null,
    };
  });

  // En çok yakan önce (litre biliniyorsa litreye, yoksa yüzdeye göre); verisi
  // olmayan araçlar en altta.
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    const av = a.consumedLiters ?? a.consumedPct;
    const bv = b.consumedLiters ?? b.consumedPct;
    return bv - av || a.plate.localeCompare(b.plate);
  });

  let totalConsumedLiters = 0;
  let kmForConsumed = 0;
  let refillTotalLiters = 0;
  let refillTotalCount = 0;
  let suspiciousVehicles = 0;
  let measured = 0;
  let capacityMissing = 0;
  for (const r of rows) {
    if (r.hasData) measured++;
    if (r.hasData && r.tankCapacityL == null) capacityMissing++;
    if (r.consumedLiters != null) {
      totalConsumedLiters += r.consumedLiters;
      if (r.km != null && r.km > 0) kmForConsumed += r.km;
    }
    if (r.refillLiters != null) refillTotalLiters += r.refillLiters;
    refillTotalCount += r.refillCount;
    if (r.suspiciousDropCount > 0) suspiciousVehicles++;
  }
  const fleetLPer100Km =
    kmForConsumed > 0 ? (totalConsumedLiters / kmForConsumed) * 100 : null;

  return {
    available: true,
    rows,
    vehicleCount: vehicles.length,
    measured,
    totalConsumedLiters,
    fleetLPer100Km,
    refillTotalCount,
    refillTotalLiters,
    suspiciousVehicles,
    capacityMissing,
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
