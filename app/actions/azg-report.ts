"use server";

import { getTranslations } from "next-intl/server";
import { listEditedEntryIds } from "@/lib/shift-edit-log";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
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
  shifts: number;
  totalHours: string;
  warnings: number;
  violations: number;
  total: number;
  worst: AZGSeverity | "none";
};

// Micro shifts (< 5 min) — likely test or mis-entries. Kept out of the
// statistics but surfaced separately so nothing is silently hidden.
export type AZGSuspicious = {
  date: string;
  worker: string;
  start: string;
  end: string;
  duration: string;
};

export type AZGData = {
  reportTitle: string;
  monthLabel: string;
  generatedAt: string;
  totalShifts: number;
  totalWorkers: number;
  totalViolations: number;
  warningCount: number;
  violationCount: number;
  seriousCount: number;
  perWorker: AZGPerWorker[];
  violations: AZGViolation[];
  suspicious: AZGSuspicious[];
  /** Bu dönemde elle düzeltilmiş vardiya sayısı (AZG dipnotu). */
  editedCount: number;
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

  // The AZG report is an official § 26 AZG document for the Austrian
  // Arbeitsinspektorat — it MUST be German regardless of the admin's UI
  // language. So every translated string here is forced to the "de" locale.
  const t = await getTranslations({ locale: "de", namespace: "azg" });
  const reportTitle = t("report_title");

  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return { ok: false, error: "bad_month" };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  // Resmî § 26 AZG raporu: aylık vardiyalar 1000 satır tavanını aşarsa rapor
  // eksik basılır — sorgu sonuna kadar sayfalanır.
  const { data: entriesData, error } = await fetchAllRows<{
    id: string;
    worker_id: string;
    started_at: string;
    ended_at: string | null;
    break_minutes: number | null;
  }>((from, to) =>
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, started_at, ended_at, break_minutes")
      .gte("started_at", start.toISOString())
      .lt("started_at", end.toISOString())
      .not("ended_at", "is", null)
      .order("started_at", { ascending: true })
      .order("id")
      .range(from, to)
  );

  if (error) return { ok: false, error: error.message };
  const entries = entriesData ?? [];
  if (entries.length === 0) {
    return {
      ok: true,
      data: {
        reportTitle,
        monthLabel: month,
        generatedAt: new Date().toISOString(),
        totalShifts: 0,
        totalWorkers: 0,
        editedCount: 0,
        totalViolations: 0,
        warningCount: 0,
        violationCount: 0,
        seriousCount: 0,
        perWorker: [],
        violations: [],
        suspicious: [],
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
  const daily = new Map<
    string,
    { ms: number; worker: string; iso: string; shifts: number }
  >();
  // Rest-period analysis ignores micro shifts (< 5 min): a test blip is not a
  // real work period to demand 11 h rest around.
  const MICRO_MS = 5 * 60_000;
  const restByWorker = new Map<
    string,
    { startTs: number; endTs: number; iso: string }[]
  >();
  // Suspicious (micro) shifts are excluded from the statistics below and shown
  // in their own section. Meaningful shifts are counted per worker for the
  // "Schichten" / "Stunden gesamt" columns.
  const suspicious: AZGSuspicious[] = [];
  const statByWorker = new Map<string, { shifts: number; ms: number }>();

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

    // Micro / test shifts (< 5 min) are excluded from ALL violation and
    // statistics math and only surfaced in the "suspicious" section. A 0.04 h
    // blip is not a real work period — it must not produce violations, nor feed
    // the daily/weekly totals or the rest-period analysis.
    if (ms < MICRO_MS) {
      suspicious.push({
        date: dateStr,
        worker,
        start: formatTime(e.started_at, "de"),
        end: endStr,
        duration: `${fmtH(hours)} Std.`,
      });
      continue;
    }

    // Single-shift checks (kept as an extra layer on top of the daily total —
    // one shift alone exceeding the limit is still its own violation).
    if (hours > 10) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: fmtH(hours),
        type: t("v.shift10_type"),
        description: t("v.shift10_desc", { hours: fmtH(hours) }),
        legalRef: "§ 9 Abs. 1 AZG — Überschreitung (Geldstrafe 72–1.815 €)",
        severity: "serious_violation",
      });
    } else if (hours > 9) {
      violations.push({
        date: dateStr,
        worker,
        end: endStr,
        workedHours: fmtH(hours),
        type: t("v.shift9_type"),
        description: t("v.shift9_desc", { hours: fmtH(hours) }),
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
        type: t("v.break_type"),
        description: t("v.break_desc", { min: breakMin, hours: fmtH(hours) }),
        legalRef: "§ 11 Abs. 1 AZG (mind. 30 Min nach 6 Std)",
        severity: "violation",
      });
    }

    const wk = `${e.worker_id}:${isoWeekKey(e.started_at)}`;
    const acc = weekly.get(wk) ?? { hours: 0, worker, iso: e.started_at };
    acc.hours += hours;
    weekly.set(wk, acc);

    const dk = `${e.worker_id}:${viennaDateKey(e.started_at)}`;
    const dacc = daily.get(dk) ?? { ms: 0, worker, iso: e.started_at, shifts: 0 };
    dacc.ms += ms;
    dacc.shifts += 1;
    if (new Date(e.started_at) < new Date(dacc.iso)) dacc.iso = e.started_at;
    daily.set(dk, dacc);

    // Meaningful shift (>= 5 min): feeds rest-period analysis and the per-worker
    // stats. (Micro shifts already returned above.)
    const arr = restByWorker.get(e.worker_id) ?? [];
    arr.push({
      startTs: new Date(e.started_at).getTime(),
      endTs: new Date(e.ended_at as string).getTime(),
      iso: e.started_at,
    });
    restByWorker.set(e.worker_id, arr);

    const s = statByWorker.get(worker) ?? { shifts: 0, ms: 0 };
    s.shifts += 1;
    s.ms += ms;
    statByWorker.set(worker, s);
  }

  // Inter-shift rest period — § 12 Abs. 1 AZG: at least 11 uninterrupted hours
  // between the end of one shift and the start of the next.
  const REST_MS = 11 * 3_600_000;
  for (const [workerId, arr] of restByWorker.entries()) {
    const worker = nameById.get(workerId) ?? "—";
    arr.sort((a, b) => a.startTs - b.startTs);
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].startTs - arr[i - 1].endTs;
      // Ignore artifact gaps: two shift records that overlap (negative gap) or
      // start within a few minutes of each other are a mis-entry / back-to-back
      // test pair, not a real "0,01 h rest" violation. Only a meaningful gap
      // that is still under the 11 h legal rest counts.
      if (gap >= MICRO_MS && gap < REST_MS) {
        const gapH = gap / 3_600_000;
        violations.push({
          date: formatDate(arr[i - 1].iso, "de"),
          worker,
          end: "—",
          workedHours: "—",
          type: t("v.rest_type"),
          description: t("v.rest_desc", { hours: fmtH(gapH) }),
          legalRef: "§ 12 Abs. 1 AZG (ununterbrochene Ruhezeit mind. 11 Std.)",
          severity: "violation",
        });
      }
    }
  }

  // Daily total work time — § 9 Abs. 1 AZG. This is the check the old report
  // was missing: individual shifts can each stay under 10 h while the day's
  // total blows past it (e.g. 0,01 + 5,18 + 4,57 + 1,84 = 11,60 h).
  for (const d of daily.values()) {
    // Single-shift days are already fully evaluated by the per-shift checks
    // above (hours > 9 / > 10). The daily-total check exists to catch what
    // those miss: MULTI-shift days whose sum exceeds a limit while each shift
    // stays under it. Running it on one-shift days too would report the same
    // hours twice and inflate totalViolations / the per-worker tally.
    if (d.shifts <= 1) continue;
    const h = d.ms / 3_600_000;
    let severity: AZGSeverity | null = null;
    let typeKey = "";
    let descKey = "";
    let legalRef = "";
    if (h > 12) {
      severity = "serious_violation";
      typeKey = "v.dailyAbs_type";
      descKey = "v.dailyAbs_desc";
      legalRef = "§ 9 Abs. 1 AZG — absolute Höchstgrenze (Geldstrafe 72–1.815 €)";
    } else if (h > 10) {
      severity = "violation";
      typeKey = "v.dailyMax_type";
      descKey = "v.dailyMax_desc";
      legalRef = "§ 9 Abs. 1 AZG (max. 10 Std. täglich)";
    } else if (h > 8) {
      severity = "warning";
      typeKey = "v.dailyNormal_type";
      descKey = "v.dailyNormal_desc";
      legalRef = "§ 9 Abs. 1 AZG (Normalarbeitszeit 8 Std. täglich)";
    }
    if (!severity) continue;
    violations.push({
      date: formatDate(d.iso, "de"),
      worker: d.worker,
      end: "—",
      workedHours: fmtH(h),
      type: t(typeKey),
      description: t(descKey, { hours: fmtH(h) }),
      legalRef,
      severity,
    });
  }

  // Weekly total work time — § 9 Abs. 1 AZG (ISO week, Monday start).
  for (const acc of weekly.values()) {
    if (acc.hours > 48) {
      violations.push({
        date: formatDate(acc.iso, "de"),
        worker: acc.worker,
        end: "—",
        workedHours: fmtH(acc.hours),
        type: t("v.weeklyMax_type"),
        description: t("v.weeklyMax_desc", { hours: fmtH(acc.hours) }),
        legalRef: "§ 9 Abs. 1 AZG (max. 48 Stunden wöchentlich)",
        severity: "violation",
      });
    } else if (acc.hours > 40) {
      violations.push({
        date: formatDate(acc.iso, "de"),
        worker: acc.worker,
        end: "—",
        workedHours: fmtH(acc.hours),
        type: t("v.weeklyNormal_type"),
        description: t("v.weeklyNormal_desc", { hours: fmtH(acc.hours) }),
        legalRef: "§ 9 Abs. 1 AZG (Normalarbeitszeit 40 Stunden wöchentlich)",
        severity: "warning",
      });
    }
  }

  // Drop exact-duplicate violation rows (same severity + type + date + worker +
  // hours + description). Without this, repeated/back-to-back test shifts could
  // list the very same violation more than once and inflate the totals.
  const seenViolation = new Set<string>();
  const dedupedViolations = violations.filter((v) => {
    const key = [v.severity, v.type, v.date, v.worker, v.workedHours, v.end, v.description].join("|");
    if (seenViolation.has(key)) return false;
    seenViolation.add(key);
    return true;
  });
  violations.splice(0, violations.length, ...dedupedViolations);

  violations.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  // Per-worker violation tally (warnings vs. violations+serious) + worst level.
  const vByWorker = new Map<
    string,
    { warnings: number; violations: number; worst: number }
  >();
  for (const v of violations) {
    const cur = vByWorker.get(v.worker) ?? { warnings: 0, violations: 0, worst: 0 };
    if (v.severity === "warning") cur.warnings += 1;
    else cur.violations += 1;
    cur.worst = Math.max(cur.worst, SEVERITY_RANK[v.severity]);
    vByWorker.set(v.worker, cur);
  }

  const names = new Set([...statByWorker.keys(), ...vByWorker.keys()]);
  const perWorker: AZGPerWorker[] = [...names]
    .map((name) => {
      const s = statByWorker.get(name) ?? { shifts: 0, ms: 0 };
      const v = vByWorker.get(name) ?? { warnings: 0, violations: 0, worst: 0 };
      return {
        name,
        shifts: s.shifts,
        totalHours: fmtH(s.ms / 3_600_000),
        warnings: v.warnings,
        violations: v.violations,
        total: v.warnings + v.violations,
        worst:
          v.worst === 0
            ? ("none" as const)
            : ((Object.keys(SEVERITY_RANK).find(
                (k) => SEVERITY_RANK[k as AZGSeverity] === v.worst
              ) as AZGSeverity) ?? "none"),
      };
    })
    .sort((a, b) => b.total - a.total || b.shifts - a.shifts);

  const warningCount = violations.filter((v) => v.severity === "warning").length;
  const violationCount = violations.filter((v) => v.severity === "violation").length;
  const seriousCount = violations.filter(
    (v) => v.severity === "serious_violation"
  ).length;
  const meaningfulShifts = [...statByWorker.values()].reduce(
    (n, s) => n + s.shifts,
    0
  );

  return {
    ok: true,
    data: {
      reportTitle,
      monthLabel: month,
      generatedAt: new Date().toISOString(),
      totalShifts: meaningfulShifts,
      totalWorkers: workerIds.length,
      totalViolations: violations.length,
      warningCount,
      violationCount,
      seriousCount,
      perWorker,
      violations,
      suspicious,
      // ELLE DÜZELTİLEN KAYIT SAYISI (22.07.2026). AZG'yi besleyen üç alan
      // (started_at / ended_at / break_minutes) yönetici tarafından
      // değiştirilebiliyor; rapor bunu dipnotta açıkça beyan etmeli.
      // Tablo yoksa 0 döner ve dipnot hiç basılmaz.
      editedCount: (await listEditedEntryIds(entries.map((e) => e.id))).size,
    },
  };
}
