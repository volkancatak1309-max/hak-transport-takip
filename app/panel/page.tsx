import { requireWorker } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
import { PanelClient } from "./PanelClient";
import {
  startOfTodayVienna,
  startOfWeekVienna,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const session = await requireWorker();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: entries } = await supabaseAdmin
    .from("time_entries")
    .select("*")
    .eq("worker_id", session.worker_id!)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });

  const all = (entries ?? []) as TimeEntry[];
  const active = all.find((e) => e.ended_at === null) ?? null;
  const past = all.filter((e) => e.ended_at !== null);

  const todayStart = startOfTodayVienna();
  const weekStart = startOfWeekVienna();

  const todayEntries = past.filter(
    (e) => new Date(e.started_at).getTime() >= todayStart.getTime()
  );
  const weekEntries = past.filter(
    (e) => new Date(e.started_at).getTime() >= weekStart.getTime()
  );

  function sumWorkedMs(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr) {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      const br = (e.break_minutes ?? 0) * 60_000;
      total += Math.max(0, en - s - br);
    }
    return total;
  }
  function sumKm(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr)
      if (e.end_km !== null && e.start_km !== null) total += e.end_km - e.start_km;
    return total;
  }
  function sumCargo(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr) total += e.cargo_count ?? 0;
    return total;
  }

  const todayMs = sumWorkedMs(todayEntries);
  const todayKm = sumKm(todayEntries);
  const todayCargo = sumCargo(todayEntries);

  const weekMs = sumWorkedMs(weekEntries);
  const weekKm = sumKm(weekEntries);
  const weekDays = new Set(
    weekEntries.map((e) =>
      new Date(e.started_at).toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" })
    )
  ).size;
  const avgDailyMs = weekDays > 0 ? weekMs / weekDays : 0;

  return (
    <AppShell user={{ name: session.name!, isAdmin: false }}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <PanelClient
          active={active}
          past={past.slice(0, 5)}
          defaultPlate={session.plate ?? ""}
          totals={{
            todayMs,
            todayKm,
            todayCargo,
            weekMs,
            weekKm,
            weekDays,
            avgDailyMs,
            shiftCount: past.length,
          }}
        />
      </div>
    </AppShell>
  );
}
