import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
import { WorkersClient } from "./WorkersClient";
import { startOfMonthVienna, workedMs } from "@/lib/format";
import type { Worker, TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export type WorkerWithStats = Worker & {
  lastShiftAt: string | null;
  monthHoursMs: number;
};

export default async function WorkersPage() {
  const session = await requireAdmin();

  const monthStart = startOfMonthVienna();

  const [workersResult, entriesResult] = await Promise.all([
    supabaseAdmin.from("workers").select("*").order("name"),
    supabaseAdmin
      .from("time_entries")
      .select("worker_id, started_at, ended_at, break_minutes")
      .gte("started_at", monthStart.toISOString()),
  ]);

  const workers = (workersResult.data ?? []) as Worker[];
  const entries = (entriesResult.data ?? []) as Pick<
    TimeEntry,
    "worker_id" | "started_at" | "ended_at" | "break_minutes"
  >[];

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
    <AppShell user={{ name: session.name!, isAdmin: true }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <WorkersClient workers={enriched} />
      </div>
    </AppShell>
  );
}
