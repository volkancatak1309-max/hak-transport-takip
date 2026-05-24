import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { logoutAction } from "../actions/auth";
import { AdminClient } from "./AdminClient";
import type { TimeEntryWithWorker, Worker } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Range = "today" | "week" | "month" | "custom";

function computeRange(
  range: Range,
  from?: string,
  to?: string
): { start: Date; end: Date } {
  const now = new Date();
  const tzNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Vienna" })
  );
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
    } else {
      start.setHours(0, 0, 0, 0);
    }
    if (to) {
      const t = new Date(to);
      t.setHours(23, 59, 59, 999);
      end.setTime(t.getTime());
    } else {
      end.setHours(23, 59, 59, 999);
    }
  }
  return { start, end };
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    worker?: string;
  }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;

  const range = (sp.range ?? "today") as Range;
  const workerFilter = sp.worker ?? "all";
  const { start, end } = computeRange(range, sp.from, sp.to);

  let query = supabaseAdmin
    .from("time_entries")
    .select("*, workers!inner(id, name, plate)")
    .gte("started_at", start.toISOString())
    .lte("started_at", end.toISOString())
    .order("started_at", { ascending: false });

  if (workerFilter !== "all") {
    query = query.eq("worker_id", workerFilter);
  }

  const [{ data: entries }, { data: workers }] = await Promise.all([
    query,
    supabaseAdmin.from("workers").select("*").order("name"),
  ]);

  const entriesData = (entries ?? []) as TimeEntryWithWorker[];
  const workersData = (workers ?? []) as Worker[];

  let todayMs = 0;
  let todayKm = 0;
  let activeCount = 0;
  let overLimit = 0;
  for (const e of entriesData) {
    const startTs = new Date(e.started_at).getTime();
    const endTs = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
    const dur = endTs - startTs;
    todayMs += dur;
    if (e.end_km !== null && e.start_km !== null) todayKm += e.end_km - e.start_km;
    if (e.ended_at === null) activeCount++;
    if (dur > 9 * 60 * 60 * 1000) overLimit++;
  }

  return (
    <main className="min-h-screen p-4 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6 pt-2 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Yönetici Paneli</h1>
          <p className="text-sm text-slate-600">Hoş geldin, {session.name}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Link href="/admin/workers" className="btn-secondary btn-sm">
            Çalışanlar
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary btn-sm">
              Çıkış
            </button>
          </form>
        </div>
      </header>

      <AdminClient
        entries={entriesData}
        workers={workersData}
        range={range}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        workerFilter={workerFilter}
        summary={{
          totalMs: todayMs,
          totalKm: todayKm,
          activeCount,
          overLimit,
        }}
      />
    </main>
  );
}
