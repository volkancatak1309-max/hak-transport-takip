import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { LiveTrackingClient } from "./LiveTrackingClient";
import { listLatestVehiclePositions } from "@/lib/telemetry";
import type { ActiveDriver } from "@/lib/types";

export const dynamic = "force-dynamic";

const RECENT_MS = 10 * 60 * 1000; // marker shown only if last ping < 10 min old

type ShiftRow = { id: string; started_at: string; worker_id: string };
type WorkerRow = { id: string; name: string; plate: string | null };
type LocRow = {
  worker_id: string;
  time_entry_id: string | null;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export default async function HaritaPage() {
  const session = await requireAdmin();

  // 1) All active shifts (ended_at IS NULL)
  const { data: shiftsData, error: shiftsErr } = await supabaseAdmin
    .from("time_entries")
    .select("id, started_at, worker_id")
    .is("ended_at", null);
  const shifts = (shiftsData ?? []) as ShiftRow[];

  const workerIds = [...new Set(shifts.map((s) => s.worker_id))];
  const timeEntryIds = shifts.map((s) => s.id);

  // 2) Worker info (separate query — avoids fragile embed joins)
  const { data: workersData, error: workersErr } = workerIds.length
    ? await supabaseAdmin.from("workers").select("id, name, plate").in("id", workerIds)
    : { data: [] as WorkerRow[], error: null };
  const workerMap = new Map((workersData ?? []).map((w) => [w.id, w as WorkerRow]));

  // 3) Recent pings (last 10 min) for the active workers
  const recentSince = new Date(Date.now() - RECENT_MS).toISOString();
  const { data: recentData, error: recentErr } = workerIds.length
    ? await supabaseAdmin
        .from("driver_locations")
        .select("worker_id, time_entry_id, latitude, longitude, recorded_at")
        .in("worker_id", workerIds)
        .gte("recorded_at", recentSince)
        .order("recorded_at", { ascending: false })
    : { data: [] as LocRow[], error: null };
  const recentLocs = (recentData ?? []) as LocRow[];

  const latestByWorker = new Map<string, LocRow>();
  for (const l of recentLocs) {
    if (!latestByWorker.has(l.worker_id)) latestByWorker.set(l.worker_id, l);
  }

  // 4) Full route points for the active shifts (for the polyline)
  const { data: routeData, error: routeErr } = timeEntryIds.length
    ? await supabaseAdmin
        .from("driver_locations")
        .select("worker_id, time_entry_id, latitude, longitude, recorded_at")
        .in("time_entry_id", timeEntryIds)
        .order("recorded_at", { ascending: true })
    : { data: [] as LocRow[], error: null };
  const routeLocs = (routeData ?? []) as LocRow[];

  const routeByEntry = new Map<string, [number, number][]>();
  for (const r of routeLocs) {
    if (!r.time_entry_id) continue;
    const arr = routeByEntry.get(r.time_entry_id) ?? [];
    arr.push([r.latitude, r.longitude]);
    routeByEntry.set(r.time_entry_id, arr);
  }

  const drivers: ActiveDriver[] = [];
  for (const s of shifts) {
    const loc = latestByWorker.get(s.worker_id);
    const w = workerMap.get(s.worker_id);
    if (!loc || !w) continue;
    drivers.push({
      worker_id: s.worker_id,
      name: w.name,
      plate: w.plate,
      shift_started_at: s.started_at,
      time_entry_id: s.id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      recorded_at: loc.recorded_at,
      route: routeByEntry.get(s.id) ?? [],
    });
  }

  // Vehicle layer (hardware GPS / flespi) — independent of the driver layer.
  // No recency window: every device vehicle shows its last known fix; the
  // client derives freshness (normal vs. faded marker) from recorded_at.
  const vehicles = await listLatestVehiclePositions();

  // Debug logging — kept in production to diagnose missing markers via Vercel logs
  console.log(
    `[harita] activeShifts=${shifts.length} workers=${workerMap.size} ` +
      `recentLocs(<10m)=${recentLocs.length} routeLocs=${routeLocs.length} ` +
      `drivers=${drivers.length} vehicles=${vehicles.length}` +
      (shiftsErr ? ` shiftsErr=${shiftsErr.message}` : "") +
      (workersErr ? ` workersErr=${workersErr.message}` : "") +
      (recentErr ? ` recentErr=${recentErr.message}` : "") +
      (routeErr ? ` routeErr=${routeErr.message}` : "")
  );

  // Lightweight KPIs from the same data — no extra logic, demo-ready summary.
  const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
  const nowMs = Date.now();
  let longestMs = 0;
  let overLimit = 0;
  for (const s of shifts) {
    const ms = nowMs - new Date(s.started_at).getTime();
    if (ms > longestMs) longestMs = ms;
    if (ms > NINE_HOURS_MS) overLimit++;
  }

  const t = await getTranslations("map");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("live_title")}
    >
      <LiveTrackingClient
        drivers={drivers}
        vehicles={vehicles}
        summary={{
          activeShifts: shifts.length,
          longestMs,
          overLimit,
        }}
        serverNow={nowMs}
      />
    </DashboardShell>
  );
}
