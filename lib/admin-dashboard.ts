import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna, workedMs, kmDiff } from "@/lib/format";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import type { TimeEntry, Worker, VehicleLiveStatus } from "@/lib/types";

const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
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
    };

export type DashboardData = {
  todayOps: TodayOps;
  fleet: FleetStatus;
  performance: DriverPerf[];
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

  const [todayRes, rangeRes, vehicles, workersRes] = await Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select(ENTRY_COLS)
      .gte("started_at", todayStart.toISOString()),
    supabaseAdmin
      .from("time_entries")
      .select(ENTRY_COLS)
      .gte("started_at", rangeStart)
      .lte("started_at", rangeEnd),
    listVehiclesWithStatus(),
    supabaseAdmin.from("workers").select("id, name"),
  ]);

  const todayEntries = (todayRes.data ?? []) as LiteEntry[];
  const rangeEntries = (rangeRes.data ?? []) as LiteEntry[];
  const names = new Map(
    ((workersRes.data ?? []) as Pick<Worker, "id" | "name">[]).map((w) => [w.id, w.name])
  );

  const fleet = buildFleet(vehicles);
  const todayOps = buildTodayOps(todayEntries);
  // "Vehicles delivering" is the live fleet count, not derived from shifts.
  todayOps.vehiclesDelivering = fleet.counts.sevkiyatta;

  return {
    todayOps,
    fleet,
    performance: buildPerformance(rangeEntries, names),
    attention: buildAttention(rangeEntries, todayEntries, vehicles, names, todayStart),
  };
}

function buildTodayOps(entries: LiteEntry[]): TodayOps {
  let driversInField = 0;
  let onBreak = 0;
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
    if (e.ended_at === null) {
      driversInField++;
      if (e.break_started_at) onBreak++;
    }
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
    driversInField,
    vehiclesDelivering: 0, // filled from fleet snapshot by caller-free merge below
    onBreak,
    totalKmToday: hasKm ? km : null,
    loaded: hasLoaded ? loaded : null,
    delivered: hasDelivered ? delivered : null,
    undelivered: hasUndelivered ? undelivered : null,
    overNine,
    shiftsToday: entries.length,
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

function buildPerformance(
  entries: LiteEntry[],
  names: Map<string, string>
): DriverPerf[] {
  const byWorker = new Map<string, DriverPerf>();
  for (const e of entries) {
    if (!e.worker_id) continue;
    // Performance is measured on COMPLETED shifts only, so all four columns
    // (shifts / hours / km / delivered) describe the exact same set of shifts.
    // Previously `shifts` counted active shifts too while hours/km did not,
    // making "5 shifts / 2h" rows that didn't add up. Active shifts have no
    // final km or delivered count yet, so they are excluded entirely here.
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
      };
      byWorker.set(e.worker_id, row);
    }
    row.shifts++;
    row.ms += workedMs(e);
    const d = kmDiff(e);
    if (d !== null) row.km += d;
    if (e.cargo_count !== null) row.delivered += e.cargo_count;
  }
  // Default sort: most km first (caller can re-sort client-side).
  return [...byWorker.values()].sort((a, b) => b.km - a.km);
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
  todayStart: Date
): AttentionItem[] {
  const items: AttentionItem[] = [];

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

  // Most urgent first: overdue/soonest docs, then biggest overruns/backlogs.
  const weight = (i: AttentionItem): number => {
    switch (i.kind) {
      case "inspection":
      case "insurance":
        return i.days; // overdue (negative) and soonest first
      case "over9h":
        return 1000 - i.ms / 3_600_000; // longest overrun first
      case "undelivered":
        return 2000 - i.count; // biggest backlog first
    }
  };
  return items.sort((a, b) => weight(a) - weight(b));
}
