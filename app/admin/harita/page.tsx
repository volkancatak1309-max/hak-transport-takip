import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
import { HaritaClient } from "./HaritaClient";
import type { ActiveDriver } from "@/lib/types";

export const dynamic = "force-dynamic";

type ShiftRow = {
  id: string;
  started_at: string;
  worker_id: string;
  workers: { id: string; name: string; plate: string | null } | null;
};

type LocRow = {
  worker_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

export default async function HaritaPage() {
  const session = await requireAdmin();

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [shiftsRes, locsRes] = await Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select("id, started_at, worker_id, workers!inner(id, name, plate)")
      .is("ended_at", null),
    supabaseAdmin
      .from("driver_locations")
      .select("worker_id, latitude, longitude, recorded_at")
      .gte("recorded_at", hourAgo)
      .order("recorded_at", { ascending: false }),
  ]);

  const shifts = (shiftsRes.data ?? []) as unknown as ShiftRow[];
  const locs = (locsRes.data ?? []) as LocRow[];

  // latest location per worker (locs already sorted desc by recorded_at)
  const latestByWorker = new Map<string, LocRow>();
  for (const l of locs) {
    if (!latestByWorker.has(l.worker_id)) latestByWorker.set(l.worker_id, l);
  }

  const drivers: ActiveDriver[] = [];
  for (const s of shifts) {
    const loc = latestByWorker.get(s.worker_id);
    if (!loc || !s.workers) continue;
    drivers.push({
      worker_id: s.worker_id,
      name: s.workers.name,
      plate: s.workers.plate,
      shift_started_at: s.started_at,
      time_entry_id: s.id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      recorded_at: loc.recorded_at,
    });
  }

  return (
    <AppShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <HaritaClient drivers={drivers} />
      </div>
    </AppShell>
  );
}
