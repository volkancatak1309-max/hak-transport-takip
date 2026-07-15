import { requireAdmin } from "@/lib/session";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { WorkersClient } from "./WorkersClient";
import { startOfMonthVienna, workedMs } from "@/lib/format";
import type { WorkerPublic, TimeEntry } from "@/lib/types";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";

export const dynamic = "force-dynamic";

export type WorkerWithStats = WorkerPublic & {
  lastShiftAt: string | null;
  monthHoursMs: number;
};

export default async function WorkersPage() {
  const session = await requireAdmin();

  const monthStart = startOfMonthVienna();

  type MonthEntry = Pick<
    TimeEntry,
    "worker_id" | "started_at" | "ended_at" | "break_minutes"
  >;
  // Aylık vardiyalar 26-28 araçta 1000 satır tavanına dayanır; "Bu Ay" saat
  // toplamları ve "Son Vardiya" eksik hesaplanmasın diye sonuna kadar okunur.
  const [workersResult, entriesResult] = await Promise.all([
    supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
    fetchAllRows<MonthEntry>((from, to) =>
      supabaseAdmin
        .from("time_entries")
        .select("worker_id, started_at, ended_at, break_minutes")
        .gte("started_at", monthStart.toISOString())
        .order("id")
        .range(from, to)
    ),
  ]);

  const workers = (workersResult.data ?? []) as WorkerPublic[];
  const entries = entriesResult.data;

  const stats: Record<string, { lastShiftAt: string | null; ms: number }> = {};
  for (const w of workers) stats[w.id] = { lastShiftAt: null, ms: 0 };

  for (const e of entries) {
    const s = stats[e.worker_id];
    if (!s) continue;
    s.ms += workedMs({
      started_at: e.started_at,
      ended_at: e.ended_at,
      break_minutes: e.break_minutes ?? 0,
    });
    if (!s.lastShiftAt || new Date(e.started_at) > new Date(s.lastShiftAt)) {
      s.lastShiftAt = e.started_at;
    }
  }

  const enriched: WorkerWithStats[] = workers.map((w) => ({
    ...w,
    lastShiftAt: stats[w.id].lastShiftAt,
    monthHoursMs: stats[w.id].ms,
  }));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <WorkersClient workers={enriched} />
      </div>
    </DashboardShell>
  );
}
