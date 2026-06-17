import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getLocale } from "@/i18n/request";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AdminClient } from "./AdminClient";
import { workedMs, kmDiff } from "@/lib/format";
import type { TimeEntry, TimeEntryWithWorker, Worker } from "@/lib/types";

export const dynamic = "force-dynamic";

type Range = "today" | "week" | "month" | "custom";

function computeRange(
  range: Range,
  from?: string,
  to?: string
): { start: Date; end: Date } {
  const now = new Date();
  const tzNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  const start = new Date(tzNow);
  const end = new Date(tzNow);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "week") {
    const day = (tzNow.getDay() + 6) % 7;
    start.setDate(tzNow.getDate() - day);
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "custom") {
    if (from) {
      const f = new Date(from);
      f.setHours(0, 0, 0, 0);
      start.setTime(f.getTime());
    } else start.setHours(0, 0, 0, 0);
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      end.setTime(t.getTime());
    } else end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

async function getWeeklyData(
  locale: string
): Promise<{ date: string; label: string; hours: number; workers: number }[]> {
  const weekdayTag = locale === "de" ? "de-AT" : "tr-TR";
  const end = new Date();
  const tzEnd = new Date(end.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  tzEnd.setHours(23, 59, 59, 999);
  const start = new Date(tzEnd);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, ended_at, break_minutes, worker_id")
    .gte("started_at", start.toISOString())
    .lte("started_at", tzEnd.toISOString())
    .not("ended_at", "is", null);

  const bucket: Record<string, { hours: number; workers: Set<string> }> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
    bucket[key] = { hours: 0, workers: new Set() };
  }

  for (const e of data ?? []) {
    const key = new Date(e.started_at).toLocaleDateString("en-CA", {
      timeZone: "Europe/Vienna",
    });
    if (!bucket[key]) continue;
    const ms = workedMs(
      {
        started_at: e.started_at,
        ended_at: e.ended_at,
        break_minutes: e.break_minutes ?? 0,
      },
      Date.now()
    );
    bucket[key].hours += ms / 3600000;
    if (e.worker_id) bucket[key].workers.add(e.worker_id as string);
  }

  return Object.entries(bucket).map(([date, v]) => {
    const d = new Date(date + "T12:00:00");
    // Localized short weekday: tr-TR → Pzt/Sal/Çar… · de-AT → Mo/Di/Mi…
    const label = d.toLocaleDateString(weekdayTag, {
      weekday: "short",
      timeZone: "Europe/Vienna",
    });
    return {
      date,
      label,
      hours: Math.round(v.hours * 100) / 100,
      workers: v.workers.size,
    };
  });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    worker?: string;
    status?: string;
  }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const range = (sp.range ?? "today") as Range;
  const workerFilter = sp.worker ?? "all";
  const statusFilter = sp.status ?? "all";
  const { start, end } = computeRange(range, sp.from, sp.to);
  const locale = await getLocale();

  // NOTE: we deliberately do NOT use a `workers!inner(...)` embed here. That
  // embed was returning no rows (fragile relationship resolution), which zeroed
  // every KPI for every range while the embed-free weekly chart stayed correct.
  // We fetch entries plainly and attach the worker from a separate query.
  let query = supabaseAdmin
    .from("time_entries")
    .select("*")
    .gte("started_at", start.toISOString())
    .lte("started_at", end.toISOString())
    .order("started_at", { ascending: false });

  if (workerFilter !== "all") query = query.eq("worker_id", workerFilter);
  if (statusFilter === "active") query = query.is("ended_at", null);
  else if (statusFilter === "completed") query = query.not("ended_at", "is", null);

  const [entriesResult, workersResult, weekly] = await Promise.all([
    query,
    supabaseAdmin.from("workers").select("*").order("name"),
    getWeeklyData(locale),
  ]);

  const workersData = (workersResult.data ?? []) as Worker[];
  const workerMap = new Map(workersData.map((w) => [w.id, w]));

  let entriesData = ((entriesResult.data ?? []) as TimeEntry[]).map((e) => {
    const w = workerMap.get(e.worker_id);
    return {
      ...e,
      workers: w ? { id: w.id, name: w.name, plate: w.plate } : null,
    } as TimeEntryWithWorker;
  });
  if (statusFilter === "over") {
    entriesData = entriesData.filter((e) => workedMs(e) > 9 * 60 * 60 * 1000);
  }

  // Totals reflect the SELECTED range. Hours/KM come from COMPLETED shifts only
  // (consistent with the weekly chart); active shifts feed the active count.
  let totalMs = 0;
  let totalKm = 0;
  let activeCount = 0;
  let overLimit = 0;
  for (const e of entriesData) {
    if (e.ended_at === null) {
      activeCount++;
    } else {
      totalMs += workedMs(e);
      const km = kmDiff(e);
      if (km !== null) totalKm += km;
    }
    if (workedMs(e) > 9 * 60 * 60 * 1000) overLimit++;
  }

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <AdminClient
          entries={entriesData}
          workers={workersData}
          range={range}
          from={sp.from ?? ""}
          to={sp.to ?? ""}
          workerFilter={workerFilter}
          statusFilter={statusFilter}
          summary={{ totalMs, totalKm, activeCount, overLimit }}
          weekly={weekly}
          rangeStart={start.toISOString()}
          rangeEnd={end.toISOString()}
        />
      </div>
    </DashboardShell>
  );
}
