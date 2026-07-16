import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
  workedMs,
  kmDiff,
} from "@/lib/format";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { listFleetActiveDtc } from "@/lib/telemetry";
import type { TimeEntry, Worker, VehicleLiveStatus } from "@/lib/types";

const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
/**
 * Performans tile'ları vardiya tablosunun aralığından BAĞIMSIZ, sabit kayan bir
 * pencere kullanır (Volkan onayı, 17.07.2026). Gerekçe: tile'lar aralığa bağlıyken
 * "Bugün" seçilince hepsi boşalıyordu — Reveal de tile'larını sabit bir pencerede
 * ("Previous week") tutar. Tablo aralığı değişse de tile'lar hep son 7 günü gösterir.
 */
const PERF_WINDOW_DAYS = 7;
/** A shift with this many undelivered packages is surfaced as an action item. */
const UNDELIVERED_THRESHOLD = 5;
/** Inspection/insurance within this many days (or already overdue) is flagged. */
const DOC_DUE_WINDOW_DAYS = 30;

/** Live snapshot of "where are we right now / today" — independent of the
 *  range/worker/status filters that drive the shift table below. */
export type TodayOps = {
  driversInField: number; // active shifts (ended_at IS NULL)
  vehiclesDelivering: number; // vehicles whose live status is "sevkiyatta"
  onBreak: number; // active shifts currently on break
  totalKmToday: number | null; // sum of km on shifts started today (null = no data)
  loaded: number | null; // sum of start_package_count today (packages LOADED at start)
  delivered: number | null; // sum of cargo_count on ENDED shifts today (actually delivered)
  undelivered: number | null; // sum of undelivered_count today
  overNine: number; // shifts today already past 9h
  shiftsToday: number; // total shifts started today (for "no data" states)
};

export type FleetStatus = {
  total: number;
  counts: Record<VehicleLiveStatus, number>;
};

export type DriverPerf = {
  worker_id: string;
  name: string;
  km: number;
  ms: number; // worked time (break-excluded)
  delivered: number; // cargo_count sum
  shifts: number;
  undelivered: number; // undelivered_count sum (for delivery success rate)
  azgWarn: number; // per-shift §9 warnings (worked > 9h, <= 10h)
  azgViol: number; // per-shift §9/§11 violations (> 10h, or break < 30min after 6h)
  score: number; // 0..100 — see buildPerformance for the exact, real-data formula
};

export type AttentionItem =
  | { kind: "over9h"; id: string; worker_name: string; ms: number }
  | {
      kind: "inspection" | "insurance";
      id: string;
      plate: string;
      due: string;
      days: number; // days until due (negative = overdue)
    }
  | {
      kind: "undelivered";
      id: string;
      worker_name: string;
      count: number;
      date: string;
    }
  | {
      kind: "penalty"; // unpaid vehicle penalties, aggregated per vehicle
      id: string;
      plate: string;
      count: number;
      amount: number | null; // total amount of the unpaid penalties (null if none priced)
    }
  | {
      kind: "unconfirmed"; // v2: auto-started shift not confirmed by the driver
      id: string;
      worker_name: string;
      date: string; // shift start
      autoEnded: boolean; // true → shift already closed unconfirmed (more urgent)
    };

/** Per-driver / per-vehicle breakdown behind each OpsSummary tile, for the
 *  click-to-expand detail dialog. Read-only — derived from the same data as
 *  TodayOps, never mutated. */
export type OpsDetailRow = { name: string; value: number };
export type OpsDetail = {
  driversInField: { name: string; plate: string | null; since: string }[];
  vehiclesDelivering: { plate: string; driver_name: string | null }[];
  onBreak: { name: string; since: string | null }[];
  km: OpsDetailRow[];
  loaded: OpsDetailRow[];
  delivered: OpsDetailRow[];
  undelivered: OpsDetailRow[];
  overNine: { name: string; ms: number }[];
};

/** Filo geneli arıza (DTC) özeti — plaka + aktif kod sayısı + en uzun süredir
 *  açık kod. Şiddet alanı YOK: ne `vehicle_dtc`'de ne de kod sözlüğünde
 *  karşılaştırılabilir bir severity verisi var (bkz. listFleetActiveDtc). */
export type FleetDtcRow = {
  vehicle_id: string;
  plate: string;
  count: number;
  oldest_code: string | null;
  oldest_since: string | null;
};

export type DashboardData = {
  todayOps: TodayOps;
  opsDetail: OpsDetail;
  fleet: FleetStatus;
  performance: DriverPerf[];
  /** Performans tile'larının kapsadığı sabit pencere (tile altyazısı bunu yazar). */
  performanceWindowDays: number;
  dtc: FleetDtcRow[];
  attention: AttentionItem[];
};

type LiteEntry = Pick<
  TimeEntry,
  | "id"
  | "worker_id"
  | "started_at"
  | "ended_at"
  | "start_km"
  | "end_km"
  | "break_minutes"
  | "break_started_at"
  | "start_package_count"
  | "cargo_count"
  | "undelivered_count"
>;

const ENTRY_COLS =
  "id, worker_id, started_at, ended_at, start_km, end_km, break_minutes, break_started_at, start_package_count, cargo_count, undelivered_count";

/**
 * Everything the redesigned admin command panel needs, derived purely from the
 * existing tables (time_entries, vehicles, workers). All sections degrade to
 * empty/"no data" states rather than throwing when a table is empty.
 *
 * Three reads run in parallel: today's shifts (live ops), the selected range's
 * shifts (performance + action items) and the fleet status snapshot.
 */
export async function getDashboardData(
  rangeStart: string,
  rangeEnd: string
): Promise<DashboardData> {
  const todayStart = startOfTodayVienna();
  // Sabit kayan performans penceresi: bugün dahil son PERF_WINDOW_DAYS gün.
  // Tablo aralığından (rangeStart/rangeEnd) bilinçli olarak bağımsız.
  const perfStart = addCalendarDaysVienna(todayStart, -(PERF_WINDOW_DAYS - 1));
  const perfEnd = endOfTodayVienna();

  const [
    todayRes,
    rangeRes,
    perfRes,
    activeRes,
    vehicles,
    workersRes,
    penaltyRes,
    unconfirmedRes,
    dtcRows,
  ] = await Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select(ENTRY_COLS)
      .gte("started_at", todayStart.toISOString()),
    // Uzun aralıklar 1000 satır tavanını aşabilir → performans sıralaması ve
    // aksiyon kalemleri eksik hesaplanmasın diye sonuna kadar sayfalanır.
    fetchAllRows<LiteEntry>((from, to) =>
      supabaseAdmin
        .from("time_entries")
        .select(ENTRY_COLS)
        .gte("started_at", rangeStart)
        .lte("started_at", rangeEnd)
        .order("id")
        .range(from, to)
    ),
    // Performans penceresi — tablo aralığından ayrı, sabit son 7 gün.
    fetchAllRows<LiteEntry>((from, to) =>
      supabaseAdmin
        .from("time_entries")
        .select(ENTRY_COLS)
        .gte("started_at", perfStart.toISOString())
        .lte("started_at", perfEnd.toISOString())
        .order("id")
        .range(from, to)
    ),
    // Single source of truth for live status: EVERY open shift (ended_at IS
    // NULL), independent of the today/range window. The top summary, the
    // active-shift card and the table all derive their "active / on break /
    // in field" numbers from this one set so they can never disagree.
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, vehicle_id, started_at, break_started_at")
      .is("ended_at", null),
    listVehiclesWithStatus(),
    supabaseAdmin.from("workers").select("id, name"),
    // Unpaid vehicle penalties (Strafe) → surfaced as action items.
    supabaseAdmin
      .from("vehicle_penalties")
      .select("vehicle_id, amount")
      .eq("paid", false),
    // v2 (migration 020): şoför onayı bekleyen / onaysız kapanan vardiyalar →
    // dikkat listesinde "onaysız" rozeti. Migration 020 uygulanmadan önce
    // confirmation_status kolonu yoktur → sorgu error döner, data null → boş
    // liste (dashboard'ı asla bozmaz).
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, started_at, confirmation_status, auto_ended, auto_started")
      .in("confirmation_status", ["pending", "unconfirmed"])
      .order("started_at", { ascending: false })
      .limit(50),
    // Filo geneli aktif arıza kodları (migration 021 yoksa boş liste).
    listFleetActiveDtc(),
  ]);

  const todayEntries = (todayRes.data ?? []) as LiteEntry[];
  const rangeEntries = (rangeRes.data ?? []) as LiteEntry[];
  const perfEntries = (perfRes.data ?? []) as LiteEntry[];
  const activeShifts = (activeRes.data ?? []) as {
    id: string;
    worker_id: string | null;
    vehicle_id: string | null;
    started_at: string;
    break_started_at: string | null;
  }[];
  const names = new Map(
    ((workersRes.data ?? []) as Pick<Worker, "id" | "name">[]).map((w) => [w.id, w.name])
  );
  const unpaidPenalties = (penaltyRes.data ?? []) as {
    vehicle_id: string;
    amount: number | null;
  }[];
  const unconfirmedShifts = (unconfirmedRes.data ?? []) as {
    id: string;
    worker_id: string | null;
    started_at: string;
    confirmation_status: string;
    auto_ended: boolean | null;
  }[];

  const fleet = buildFleet(vehicles);
  const todayOps = buildTodayOps(todayEntries);
  // Live status counts come from the global active-shift set, NOT today's
  // window: a shift left open overnight is still "in field" right now.
  //   "Sahadaki şoför" = every open shift (drivers on break are still in field)
  //   "Molada"         = open shifts whose break_started_at is set
  // (so driversInField >= onBreak always holds).
  todayOps.driversInField = activeShifts.length;
  todayOps.onBreak = activeShifts.filter((s) => s.break_started_at).length;
  // "Vehicles delivering" is the live fleet count, not derived from shifts.
  todayOps.vehiclesDelivering = fleet.counts.sevkiyatta;

  // Arıza satırlarına plaka iliştirilir; plakası bulunamayan (silinmiş araç)
  // satır düşürülür — "—" plakalı hayalet satır göstermeyiz.
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const dtc: FleetDtcRow[] = dtcRows.flatMap((d) => {
    const plate = plateById.get(d.vehicle_id);
    if (!plate) return [];
    return [
      {
        vehicle_id: d.vehicle_id,
        plate,
        count: d.count,
        oldest_code: d.oldest?.code ?? null,
        oldest_since: d.oldest?.first_seen ?? null,
      },
    ];
  });

  return {
    todayOps,
    opsDetail: buildOpsDetail(todayEntries, activeShifts, vehicles, names),
    fleet,
    // Tablo aralığı değil, sabit son-7-gün penceresi (PERF_WINDOW_DAYS).
    performance: buildPerformance(
      perfEntries,
      names,
      perfStart.toISOString(),
      perfEnd.toISOString()
    ),
    performanceWindowDays: PERF_WINDOW_DAYS,
    dtc,
    attention: buildAttention(
      rangeEntries,
      todayEntries,
      vehicles,
      names,
      todayStart,
      unpaidPenalties,
      unconfirmedShifts
    ),
  };
}

function buildTodayOps(entries: LiteEntry[]): TodayOps {
  let overNine = 0;
  let km = 0;
  let hasKm = false;
  let loaded = 0;
  let hasLoaded = false;
  let delivered = 0;
  let hasDelivered = false;
  let undelivered = 0;
  let hasUndelivered = false;

  for (const e of entries) {
    if (workedMs(e) > NINE_HOURS_MS) overNine++;
    const d = kmDiff(e);
    if (d !== null) {
      km += d;
      hasKm = true;
    }
    // Yüklenen (loaded at start of day) — always the start_package_count.
    if (e.start_package_count !== null) {
      loaded += e.start_package_count;
      hasLoaded = true;
    }
    // Teslim edilen (actually delivered) — cargo_count is only the real
    // delivered figure once the shift has ENDED. On an active shift cargo_count
    // still holds the start-of-day placeholder, so it must NOT be counted here.
    if (e.ended_at !== null && e.cargo_count !== null) {
      delivered += e.cargo_count;
      hasDelivered = true;
    }
    if (e.undelivered_count !== null) {
      undelivered += e.undelivered_count;
      hasUndelivered = true;
    }
  }

  return {
    // driversInField / onBreak / vehiclesDelivering are the live status counts
    // and are filled in by getDashboardData from the global active-shift set.
    driversInField: 0,
    vehiclesDelivering: 0,
    onBreak: 0,
    totalKmToday: hasKm ? km : null,
    loaded: hasLoaded ? loaded : null,
    delivered: hasDelivered ? delivered : null,
    undelivered: hasUndelivered ? undelivered : null,
    overNine,
    shiftsToday: entries.length,
  };
}

/** Per-driver / per-vehicle breakdown for the click-to-expand tile dialogs.
 *  Derived from the same data as buildTodayOps — purely read-only. */
function buildOpsDetail(
  todayEntries: LiteEntry[],
  activeShifts: {
    worker_id: string | null;
    vehicle_id: string | null;
    started_at: string;
    break_started_at: string | null;
  }[],
  vehicles: {
    id: string;
    plate: string;
    live_status: VehicleLiveStatus;
    driver_name: string | null;
  }[],
  names: Map<string, string>
): OpsDetail {
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? "—" : "—");

  // Longest-running active shift first.
  const driversInField = activeShifts
    .map((s) => ({
      name: nameOf(s.worker_id),
      plate: s.vehicle_id ? plateById.get(s.vehicle_id) ?? null : null,
      since: s.started_at,
    }))
    .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime());

  const onBreak = activeShifts
    .filter((s) => s.break_started_at)
    .map((s) => ({ name: nameOf(s.worker_id), since: s.break_started_at }));

  const vehiclesDelivering = vehicles
    .filter((v) => v.live_status === "sevkiyatta")
    .map((v) => ({ plate: v.plate, driver_name: v.driver_name }));

  // Per-driver aggregates over today's shifts — identical rules to buildTodayOps.
  const km = new Map<string, number>();
  const loaded = new Map<string, number>();
  const delivered = new Map<string, number>();
  const undelivered = new Map<string, number>();
  const overNine: { name: string; ms: number }[] = [];
  for (const e of todayEntries) {
    const name = nameOf(e.worker_id);
    const d = kmDiff(e);
    if (d !== null) km.set(name, (km.get(name) ?? 0) + d);
    if (e.start_package_count !== null)
      loaded.set(name, (loaded.get(name) ?? 0) + e.start_package_count);
    if (e.ended_at !== null && e.cargo_count !== null)
      delivered.set(name, (delivered.get(name) ?? 0) + e.cargo_count);
    if ((e.undelivered_count ?? 0) > 0)
      undelivered.set(name, (undelivered.get(name) ?? 0) + (e.undelivered_count ?? 0));
    if (workedMs(e) > NINE_HOURS_MS) overNine.push({ name, ms: workedMs(e) });
  }

  const rows = (m: Map<string, number>): OpsDetailRow[] =>
    [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return {
    driversInField,
    vehiclesDelivering,
    onBreak,
    km: rows(km),
    loaded: rows(loaded),
    delivered: rows(delivered),
    undelivered: rows(undelivered),
    overNine: overNine.sort((a, b) => b.ms - a.ms),
  };
}

function buildFleet(vehicles: { live_status: VehicleLiveStatus }[]): FleetStatus {
  const counts: Record<VehicleLiveStatus, number> = {
    sevkiyatta: 0,
    molada: 0,
    bosta: 0,
    bakimda: 0,
  };
  for (const v of vehicles) counts[v.live_status]++;
  return { total: vehicles.length, counts };
}

const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function buildPerformance(
  entries: LiteEntry[],
  names: Map<string, string>,
  rangeStart: string,
  rangeEnd: string
): DriverPerf[] {
  const byWorker = new Map<string, DriverPerf>();
  for (const e of entries) {
    if (!e.worker_id) continue;
    // Performance is measured on COMPLETED shifts only, so all columns describe
    // the exact same set of shifts. Active shifts have no final km / delivered
    // count yet, so they are excluded entirely here.
    if (e.ended_at === null) continue;
    let row = byWorker.get(e.worker_id);
    if (!row) {
      row = {
        worker_id: e.worker_id,
        name: names.get(e.worker_id) ?? "—",
        km: 0,
        ms: 0,
        delivered: 0,
        shifts: 0,
        undelivered: 0,
        azgWarn: 0,
        azgViol: 0,
        score: 0,
      };
      byWorker.set(e.worker_id, row);
    }
    row.shifts++;
    const worked = workedMs(e);
    row.ms += worked;
    const d = kmDiff(e);
    if (d !== null) row.km += d;
    if (e.cargo_count !== null) row.delivered += e.cargo_count;
    if (e.undelivered_count !== null) row.undelivered += e.undelivered_count;
    // Per-shift AZG checks — the SAME § 9 / § 11 per-shift rules the AZG audit
    // report uses (worked time is break-excluded). Cross-shift checks (daily
    // total, weekly, rest period) are NOT included here; the score's AZG part is
    // the per-shift compliance only (explained to the admin in the (i) tooltip).
    const breakMin = e.break_minutes ?? 0;
    const isViolation = worked > TEN_HOURS_MS || (worked > SIX_HOURS_MS && breakMin < 30);
    if (isViolation) row.azgViol++;
    else if (worked > NINE_HOURS_MS) row.azgWarn++;
  }

  // Activity target scales with the selected range length (~5 shifts / week),
  // so "activity" is judged against the period, not against other drivers.
  const days = Math.max(
    1,
    Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000)
  );
  const activityTarget = Math.max(1, Math.round((days * 5) / 7));

  for (const row of byWorker.values()) {
    // Delivery success rate: delivered / (delivered + undelivered). No package
    // data at all → treated as 1.0 (no failed deliveries to penalise).
    const handled = row.delivered + row.undelivered;
    const deliveryRate = handled > 0 ? row.delivered / handled : 1;
    // AZG compliance: 1.0 with no issues; each violation costs more than a warning.
    const azgCompliance = Math.max(0, 1 - (0.34 * row.azgViol + 0.1 * row.azgWarn));
    // Activity: completed shifts vs the range's target (capped at 1.0).
    const activity = Math.min(1, row.shifts / activityTarget);
    // Weights: delivery 50, AZG compliance 35, activity 15 → 0..100.
    row.score = Math.round(50 * deliveryRate + 35 * azgCompliance + 15 * activity);
  }

  // Default sort: highest score first (caller can re-sort client-side).
  return [...byWorker.values()].sort((a, b) => b.score - a.score);
}

function buildAttention(
  rangeEntries: LiteEntry[],
  todayEntries: LiteEntry[],
  vehicles: {
    id: string;
    plate: string;
    inspection_due: string | null;
    insurance_due: string | null;
  }[],
  names: Map<string, string>,
  todayStart: Date,
  unpaidPenalties: { vehicle_id: string; amount: number | null }[],
  unconfirmedShifts: {
    id: string;
    worker_id: string | null;
    started_at: string;
    confirmation_status: string;
    auto_ended: boolean | null;
  }[]
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 0) v2 — onaysız vardiyalar: otomatik başlayıp şoförün onaylamadığı (pending)
  //    ya da onaylanmadan kapanan (unconfirmed) vardiyalar. Kapanmış olan daha
  //    acildir (şoför artık ekranı görmüyor → yalnız admin düzeltebilir).
  for (const u of unconfirmedShifts) {
    items.push({
      kind: "unconfirmed",
      id: `${u.id}-unconfirmed`,
      worker_name: u.worker_id ? names.get(u.worker_id) ?? "—" : "—",
      date: u.started_at,
      autoEnded: !!u.auto_ended,
    });
  }

  // 1) Shifts past the 9h AZG threshold — only the ones that are *actionable
  //    right now*: shifts that started today, plus any still-open (active)
  //    shift regardless of when it started (e.g. left running overnight). We do
  //    NOT scan the whole selected range, otherwise picking "month" floods the
  //    action list with every historical overrun. Deduped by entry id.
  const over9h = new Map<string, LiteEntry>();
  for (const e of todayEntries) {
    if (workedMs(e) > NINE_HOURS_MS) over9h.set(e.id, e);
  }
  for (const e of rangeEntries) {
    if (e.ended_at === null && workedMs(e) > NINE_HOURS_MS) over9h.set(e.id, e);
  }
  for (const e of over9h.values()) {
    items.push({
      kind: "over9h",
      id: e.id,
      worker_name: e.worker_id ? names.get(e.worker_id) ?? "—" : "—",
      ms: workedMs(e),
    });
  }

  // 2) Vehicle documents due soon or overdue (§57a inspection + insurance).
  //    Window is bounded on BOTH sides: a document that expired more than
  //    DOC_DUE_WINDOW_DAYS ago drops off the list instead of sitting at the top
  //    forever (otherwise an old, unmaintained record keeps the panel red).
  const dayMs = 24 * 60 * 60 * 1000;
  const today = todayStart.getTime();
  for (const v of vehicles) {
    for (const kind of ["inspection", "insurance"] as const) {
      const due = kind === "inspection" ? v.inspection_due : v.insurance_due;
      if (!due) continue;
      const days = Math.round((new Date(due).getTime() - today) / dayMs);
      if (days >= -DOC_DUE_WINDOW_DAYS && days <= DOC_DUE_WINDOW_DAYS) {
        items.push({ kind, id: `${v.id}-${kind}`, plate: v.plate, due, days });
      }
    }
  }

  // 3) Shifts with a high undelivered-package count.
  for (const e of rangeEntries) {
    if ((e.undelivered_count ?? 0) >= UNDELIVERED_THRESHOLD) {
      items.push({
        kind: "undelivered",
        id: `${e.id}-undelivered`,
        worker_name: e.worker_id ? names.get(e.worker_id) ?? "—" : "—",
        count: e.undelivered_count ?? 0,
        date: e.started_at,
      });
    }
  }

  // 4) Unpaid vehicle penalties (Strafe), aggregated per vehicle.
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const penByVehicle = new Map<string, { count: number; amount: number; hasAmount: boolean }>();
  for (const p of unpaidPenalties) {
    const acc = penByVehicle.get(p.vehicle_id) ?? { count: 0, amount: 0, hasAmount: false };
    acc.count += 1;
    if (p.amount !== null) {
      acc.amount += p.amount;
      acc.hasAmount = true;
    }
    penByVehicle.set(p.vehicle_id, acc);
  }
  for (const [vehicleId, acc] of penByVehicle) {
    items.push({
      kind: "penalty",
      id: `${vehicleId}-penalty`,
      plate: plateById.get(vehicleId) ?? "—",
      count: acc.count,
      amount: acc.hasAmount ? acc.amount : null,
    });
  }

  // Most urgent first: overdue/soonest docs, then biggest overruns/backlogs.
  const weight = (i: AttentionItem): number => {
    switch (i.kind) {
      case "inspection":
      case "insurance":
        return i.days; // overdue (negative) and soonest first
      case "unconfirmed":
        return i.autoEnded ? 40 : 60; // after overdue docs; closed-unconfirmed first
      case "penalty":
        return 100 - i.count; // unpaid fines: after overdue docs, before overruns
      case "over9h":
        return 1000 - i.ms / 3_600_000; // longest overrun first
      case "undelivered":
        return 2000 - i.count; // biggest backlog first
    }
  };
  return items.sort((a, b) => weight(a) - weight(b));
}
