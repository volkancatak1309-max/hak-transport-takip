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

  for (const e of entries) {
    const worker = nameById.get(e.worker_id) ?? "—";
    const ms = workedMs({
      started_at: e.started_at,
      ended_at: e.ended_at,
      break_minutes: e.break_minutes ?? 0,
    });
    const hours = ms / 3_600_000;
    const hoursStr = hours.toFixed(2);
    const dateStr = formatDate(e.started_at, "de");
    const endStr = formatTime(e.ended_at, "de");

    if (hours > 10) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: hoursStr,
        type: "Tägliche Höchstarbeitszeit überschritten (>10 h)",
        legalRef: "§ 9 Abs. 1 AZG — Überschreitung (Geldstrafe 72–1.815 €)",
        severity: "serious_violation",
      });
    } else if (hours > 9) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: hoursStr,
        type: "Arbeitszeit über 9 Stunden",
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
        workedHours: hoursStr,
        type: `Unzureichende Ruhepause (${breakMin} Min)`,
        legalRef: "§ 11 Abs. 1 AZG (mind. 30 Min nach 6 Std)",
        severity: "violation",
      });
    }

    const wk = `${e.worker_id}:${isoWeekKey(e.started_at)}`;
    const acc = weekly.get(wk) ?? { hours: 0, worker, iso: e.started_at };
    acc.hours += hours;
    weekly.set(wk, acc);
  }

  for (const acc of weekly.values()) {
    if (acc.hours > 48) {
      violations.push({
        date: formatDate(acc.iso, "de"),
        worker: acc.worker,
        end: "—",
        workedHours: acc.hours.toFixed(2),
        type: `Wochenarbeitszeit überschritten (${acc.hours.toFixed(1)} h)`,
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
