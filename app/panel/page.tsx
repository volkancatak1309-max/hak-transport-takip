import { requireWorker } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PanelClient } from "./PanelClient";
import {
  startOfTodayVienna,
  startOfWeekVienna,
  viennaDayKey,
} from "@/lib/format";
import { getAssignments } from "@/app/actions/assignments";
import type { TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * İmzasız özet bu kadar geriye kadar tekrar gösterilir; daha eskisi şoförü
 * rahatsız etmez (admin tarafında "onaysız" görünür kalır).
 */
const SUMMARY_WINDOW_MS = 72 * 60 * 60 * 1000;

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

  // İş 3 — imzasız vardiya özeti: son 72 saatte bitmiş, summary_confirmed_at
  // boş olan en yeni vardiya. Şoför onaylamadan kapattıysa her girişte çıkar.
  const nowMs = Date.now();
  const pendingSummary =
    past.find(
      (e) =>
        !e.summary_confirmed_at &&
        e.ended_at !== null &&
        nowMs - new Date(e.ended_at).getTime() <= SUMMARY_WINDOW_MS
    ) ?? null;

  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_username")
    .eq("id", session.worker_id!)
    .maybeSingle();
  const telegram = {
    linked: !!me?.telegram_chat_id,
    username: (me?.telegram_username as string) ?? null,
  };

  // İş 1 — bekleme ekranı: şoförün atandığı araç (kontak bu aracı izler).
  const { data: veh } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, make, model")
    .eq("assigned_worker_id", session.worker_id!)
    .neq("status", "inactive")
    .order("plate")
    .limit(1)
    .maybeSingle();
  const assignedVehicle =
    (veh as { id: string; plate: string; make: string | null; model: string | null } | null) ??
    null;

  const myAssignments = await getAssignments({ mine: true });
  const todayKey = viennaDayKey(new Date());
  const todayAssignmentCount = myAssignments.filter(
    (a) => viennaDayKey(a.scheduled_at) === todayKey && a.status !== "cancelled"
  ).length;

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

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: false,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <PanelClient
          active={active}
          pendingSummary={pendingSummary}
          telegram={telegram}
          todayAssignmentCount={todayAssignmentCount}
          totals={{
            todayClosedPackages: sumCargo(todayEntries),
            weekMs: sumWorkedMs(weekEntries),
            weekKm: sumKm(weekEntries),
            weekShifts: weekEntries.length,
          }}
          assignedVehicle={assignedVehicle}
        />
      </div>
    </DashboardShell>
  );
}
