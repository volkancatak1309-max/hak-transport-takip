import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { viennaDayKey } from "@/lib/format";

export type RoutePoint = { lat: number; lng: number; t: string };

export type RouteDay = {
  date: string; // YYYY-MM-DD (Vienna)
  points: RoutePoint[];
  plate: string | null;
  driverName: string | null;
  driverId: string | null;
  totalRaw: number; // point count before sampling (for the UI hint)
};

const MAX_POINTS = 900; // keep replay smooth even on long days

/** Evenly downsample, always preserving the first & last point. */
function sample(points: RoutePoint[], max = MAX_POINTS): RoutePoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  // guarantee the true last point
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** UTC window that safely brackets a Vienna calendar day (±1 day for DST/offset). */
function dayWindow(date: string): { gte: string; lt: string } {
  const base = new Date(`${date}T00:00:00Z`);
  const gte = new Date(base);
  gte.setUTCDate(gte.getUTCDate() - 1);
  const lt = new Date(base);
  lt.setUTCDate(lt.getUTCDate() + 2);
  return { gte: gte.toISOString(), lt: lt.toISOString() };
}

type LocRow = {
  worker_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

function toPoints(rows: LocRow[], date: string): RoutePoint[] {
  return rows
    .filter((r) => viennaDayKey(r.recorded_at) === date)
    .map((r) => ({ lat: r.latitude, lng: r.longitude, t: r.recorded_at }));
}

/** All GPS points recorded for a worker on a given Vienna day. */
export async function getWorkerRoute(workerId: string, date: string): Promise<RouteDay> {
  const { gte, lt } = dayWindow(date);
  const [{ data: locs }, { data: w }] = await Promise.all([
    supabaseAdmin
      .from("driver_locations")
      .select("worker_id, latitude, longitude, recorded_at")
      .eq("worker_id", workerId)
      .gte("recorded_at", gte)
      .lt("recorded_at", lt)
      .order("recorded_at", { ascending: true }),
    supabaseAdmin.from("workers").select("name, plate").eq("id", workerId).maybeSingle(),
  ]);

  const points = toPoints((locs ?? []) as LocRow[], date);
  return {
    date,
    points: sample(points),
    totalRaw: points.length,
    plate: (w?.plate as string) ?? null,
    driverName: (w?.name as string) ?? null,
    driverId: workerId,
  };
}

/**
 * Route of a vehicle on a given day — the GPS points of the shifts driven on
 * that vehicle that day (joined via time_entries.vehicle_id → driver_locations).
 */
export async function getVehicleRoute(vehicleId: string, date: string): Promise<RouteDay> {
  const { gte, lt } = dayWindow(date);

  const [{ data: vehicle }, { data: shifts }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("plate").eq("id", vehicleId).maybeSingle(),
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, started_at, ended_at")
      .eq("vehicle_id", vehicleId)
      .lt("started_at", lt)
      .or(`ended_at.is.null,ended_at.gte.${gte}`),
  ]);

  const plate = (vehicle?.plate as string) ?? null;
  const shiftRows = (shifts ?? []) as {
    id: string;
    worker_id: string;
    started_at: string;
    ended_at: string | null;
  }[];

  if (shiftRows.length === 0) {
    return { date, points: [], totalRaw: 0, plate, driverName: null, driverId: null };
  }

  const ids = shiftRows.map((s) => s.id);
  const { data: locs } = await supabaseAdmin
    .from("driver_locations")
    .select("worker_id, latitude, longitude, recorded_at")
    .in("time_entry_id", ids)
    .gte("recorded_at", gte)
    .lt("recorded_at", lt)
    .order("recorded_at", { ascending: true });

  const points = toPoints((locs ?? []) as LocRow[], date);

  // Driver = the worker who actually logged points that day (fallback: first shift).
  const driverId = points.length
    ? ((locs ?? []) as LocRow[]).find((r) => viennaDayKey(r.recorded_at) === date)?.worker_id ??
      shiftRows[0].worker_id
    : shiftRows[0].worker_id;
  let driverName: string | null = null;
  if (driverId) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("name")
      .eq("id", driverId)
      .maybeSingle();
    driverName = (w?.name as string) ?? null;
  }

  return {
    date,
    points: sample(points),
    totalRaw: points.length,
    plate,
    driverName,
    driverId,
  };
}
