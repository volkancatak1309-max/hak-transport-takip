"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { workedMs, formatDate, formatTime } from "@/lib/format";

export type AZGSeverity = "warning" | "violation" | "serious_violation";

export type AZGViolation = {
  date: string;
  worker: string;
  end: string;
  workedHours: string;
  type: string;
  description: string;
  legalRef: string;
  severity: AZGSeverity;
};

export type AZGPerWorker = {
  name: string;
  total: number;
  worst: AZGSeverity | "none";
};

export type AZGData = {
  monthLabel: string;
  generatedAt: string;
  totalShifts: number;
  totalWorkers: number;
  totalViolations: number;
  perWorker: AZGPerWorker[];
  violations: AZGViolation[];
};

export type AZGResult =
  | { ok: true; data: AZGData }
  | { ok: false; error: string };

const SEVERITY_RANK: Record<AZGSeverity, number> = {
  warning: 1,
  violation: 2,
  serious_violation: 3,
};

// Austrian (German) locale uses a comma decimal separator — never a dot.
const fmtH = (hours: number): string => hours.toFixed(2).replace(".", ",");

// Vienna calendar day (YYYY-MM-DD) for an ISO timestamp. Used to group shifts
// by the day they *started* — including shifts that run past midnight, which
// are attributed to their start date (simple, defensible rule).
function viennaDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
}

function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${date.getUTCFullYear()}-W${week}`;
}

export async function getAZGReportData(month: string): Promise<AZGResult> {
  await requireAdmin();

  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return { ok: false, error: "bad_month" };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  const { data: entriesData, error } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id, started_at, ended_at, break_minutes")
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString())
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true });

  if (error) return { ok: false, error: error.message };
  const entries = entriesData ?? [];
  if (entries.length === 0) {
    return {
      ok: true,
      data: {
        monthLabel: month,
        generatedAt: new Date().toISOString(),
        totalShifts: 0,
        totalWorkers: 0,
        totalViolations: 0,
        perWorker: [],
        violations: [],
      },
    };
  }

  const workerIds = [...new Set(entries.map((e) => e.worker_id))];
  const { data: workersData } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .in("id", workerIds);
  const nameById = new Map((workersData ?? []).map((w) => [w.id, w.name as string]));

  const violations: AZGViolation[] = [];
  const weekly = new Map<string, { hours: number; worker: string; iso: string }>();
  // Daily totals include EVERY shift (even micro ones): legally every worked
  // minute counts toward the daily cap. Grouped by the shift's start date.
  const daily = new Map<string, { ms: number; worker: string; iso: string }>();

  for (const e of entries) {
    const worker = nameById.get(e.worker_id) ?? "—";
    const ms = workedMs({
      started_at: e.started_at,
      ended_at: e.ended_at,
      break_minutes: e.break_minutes ?? 0,
    });
    const hours = ms / 3_600_000;
    const dateStr = formatDate(e.started_at, "de");
    const endStr = formatTime(e.ended_at, "de");

    // Single-shift checks (kept as an extra layer on top of the daily total —
    // one shift alone exceeding the limit is still its own violation).
    if (hours > 10) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: fmtH(hours),
        type: "Einzelschicht über 10 Stunden",
        description: `Einzelschicht ${fmtH(hours)} Std. (Max: 10 Std.)`,
        legalRef: "§ 9 Abs. 1 AZG — Überschreitung (Geldstrafe 72–1.815 €)",
        severity: "serious_violation",
      });
    } else if (hours > 9) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: fmtH(hours),
        type: "Einzelschicht über 9 Stunden",
        description: `Einzelschicht ${fmtH(hours)} Std. (über 9 Std.)`,
        legalRef: "§ 9 Abs. 1 AZG (max. 10 Stunden täglich)",
        severity: "warning",
      });
    }

    const breakMin = e.break_minutes ?? 0;
    if (hours > 6 && breakMin < 30) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: fmtH(hours),
        type: "Unzureichende Ruhepause",
        description: `Ruhepause ${breakMin} Min bei ${fmtH(hours)} Std. Arbeit (mind. 30 Min)`,
        legalRef: "§ 11 Abs. 1 AZG (mind. 30 Min nach 6 Std)",
        severity: "violation",
      });
    }

    const wk = `${e.worker_id}:${isoWeekKey(e.started_at)}`;
    const acc = weekly.get(wk) ?? { hours: 0, worker, iso: e.started_at };
    acc.hours += hours;
    weekly.set(wk, acc);

    const dk = `${e.worker_id}:${viennaDateKey(e.started_at)}`;
    const dacc = daily.get(dk) ?? { ms: 0, worker, iso: e.started_at };
    dacc.ms += ms;
    if (new Date(e.started_at) < new Date(dacc.iso)) dacc.iso = e.started_at;
    daily.set(dk, dacc);
  }

  // Daily total work time — § 9 Abs. 1 AZG. This is the check the old report
  // was missing: individual shifts can each stay under 10 h while the day's
  // total blows past it (e.g. 0,01 + 5,18 + 4,57 + 1,84 = 11,60 h).
  for (const d of daily.values()) {
    const h = d.ms / 3_600_000;
    let severity: AZGSeverity | null = null;
    let limitLabel = "";
    let legalRef = "";
    let type = "";
    if (h > 12) {
      severity = "serious_violation";
      limitLabel = "Absolut: 12 Std.";
      type = "Absolute Tageshöchstgrenze überschritten";
      legalRef = "§ 9 Abs. 1 AZG — absolute Höchstgrenze (Geldstrafe 72–1.815 €)";
    } else if (h > 10) {
      severity = "violation";
      limitLabel = "Max: 10 Std.";
      type = "Tägliche Höchstarbeitszeit überschritten";
      legalRef = "§ 9 Abs. 1 AZG (max. 10 Std. täglich)";
    } else if (h > 8) {
      severity = "warning";
      limitLabel = "Normal: 8 Std.";
      type = "Tägliche Normalarbeitszeit überschritten";
      legalRef = "§ 9 Abs. 1 AZG (Normalarbeitszeit 8 Std. täglich)";
    }
    if (!severity) continue;
    violations.push({
      date: formatDate(d.iso, "de"),
      worker: d.worker,
      end: "—",
      workedHours: fmtH(h),
      type,
      description: `Tägliche Arbeitszeit ${fmtH(h)} Std. (${limitLabel})`,
      legalRef,
      severity,
    });
  }

  for (const acc of weekly.values()) {
    if (acc.hours > 48) {
      violations.push({
        date: formatDate(acc.iso, "de"),
        worker: acc.worker,
        end: "—",
        workedHours: fmtH(acc.hours),
        type: "Wöchentliche Höchstarbeitszeit überschritten",
        description: `Wochenarbeitszeit ${fmtH(acc.hours)} Std. (Max: 48 Std.)`,
        legalRef: "§ 9 Abs. 1 AZG (max. 48 Stunden wöchentlich)",
        severity: "violation",
      });
    }
  }

  violations.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const perWorkerMap = new Map<string, { total: number; worst: number }>();
  for (const v of violations) {
    const cur = perWorkerMap.get(v.worker) ?? { total: 0, worst: 0 };
    cur.total += 1;
    cur.worst = Math.max(cur.worst, SEVERITY_RANK[v.severity]);
    perWorkerMap.set(v.worker, cur);
  }
  const perWorker: AZGPerWorker[] = [...perWorkerMap.entries()]
    .map(([name, v]) => ({
      name,
      total: v.total,
      worst: (Object.keys(SEVERITY_RANK).find(
        (k) => SEVERITY_RANK[k as AZGSeverity] === v.worst
      ) as AZGSeverity) ?? "none",
    }))
    .sort((a, b) => b.total - a.total);

  return {
    ok: true,
    data: {
      monthLabel: month,
      generatedAt: new Date().toISOString(),
      totalShifts: entries.length,
      totalWorkers: workerIds.length,
      totalViolations: violations.length,
      perWorker,
      violations,
    },
  };
}
