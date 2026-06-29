import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { FlespiPoint } from "@/lib/flespi";
import type { ActiveVehicle } from "@/lib/types";

/**
 * Persistence helpers for vehicle-centric GPS telemetry (device_telemetry).
 * Completely separate from the phone-GPS path (driver_locations / recordLocation),
 * which this module NEVER touches.
 */

/** Newest telemetry instant for a vehicle — the polling cursor for that device. */
export async function lastRecordedAt(vehicleId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select("recorded_at")
    .eq("vehicle_id", vehicleId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.recorded_at ?? null;
}

/**
 * Idempotently write flespi points for one vehicle. The conflict target
 * (vehicle_id, recorded_at) makes re-polling an overlapping window a no-op, so
 * the table never accumulates duplicates. Returns the number of rows written.
 */
export async function saveTelemetry(
  vehicleId: string,
  points: FlespiPoint[]
): Promise<number> {
  if (points.length === 0) return 0;

  // Drop in-batch duplicate timestamps up front (ON CONFLICT DO NOTHING also
  // tolerates them, but this keeps the request smaller).
  const seen = new Set<string>();
  const rows = [];
  for (const p of points) {
    if (seen.has(p.recorded_at)) continue;
    seen.add(p.recorded_at);
    rows.push({
      vehicle_id: vehicleId,
      flespi_device_id: p.flespi_device_id,
      latitude: p.latitude,
      longitude: p.longitude,
      speed_kmh: p.speed_kmh,
      heading: p.heading,
      ignition_on: p.ignition_on,
      recorded_at: p.recorded_at,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("device_telemetry")
    .upsert(rows, {
      onConflict: "vehicle_id,recorded_at",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export type TelemetryRow = {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition_on: boolean | null;
  recorded_at: string;
};

/**
 * The single most-recent telemetry point for ONE vehicle, or null if the device
 * has never reported (no row in device_telemetry). Unlike
 * listLatestVehiclePositions, there is NO recency window: the vehicle-detail
 * "live position" card shows the last known fix however old, and surfaces its
 * age via recorded_at — so a parked/offline tracker still renders its last
 * position instead of vanishing. Served cheaply by the
 * (vehicle_id, recorded_at) index.
 */
export async function latestVehicleTelemetry(
  vehicleId: string
): Promise<TelemetryRow | null> {
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select(
      "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
    )
    .eq("vehicle_id", vehicleId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TelemetryRow | null) ?? null;
}

/**
 * Latest position per vehicle within a recency window, joined with the plate —
 * the live-map vehicle layer. Stale/offline vehicles (no ping in the window)
 * drop off, mirroring how the driver layer hides old pings. Degrades to an empty
 * list if the telemetry table doesn't exist yet (migrations not run).
 */
export async function listLatestVehiclePositions(
  windowMs: number
): Promise<ActiveVehicle[]> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select(
      "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
    )
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  const rows = (data ?? []) as TelemetryRow[];
  if (rows.length === 0) return [];

  // Rows are newest-first, so the first seen per vehicle is its latest.
  const latest = new Map<string, TelemetryRow>();
  for (const r of rows) {
    if (!latest.has(r.vehicle_id)) latest.set(r.vehicle_id, r);
  }

  const ids = [...latest.keys()];
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .in("id", ids);
  const plates = new Map(
    ((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate])
  );

  const out: ActiveVehicle[] = [];
  for (const [id, r] of latest) {
    const plate = plates.get(id);
    if (!plate) continue; // vehicle row vanished — skip orphan telemetry
    out.push({
      vehicle_id: id,
      plate,
      latitude: r.latitude,
      longitude: r.longitude,
      speed_kmh: r.speed_kmh,
      heading: r.heading,
      ignition_on: r.ignition_on,
      recorded_at: r.recorded_at,
    });
  }
  return out;
}

const TRACK_PAGE = 1000; // PostgREST page size; we paginate to defeat any max-rows cap
const TRACK_MAX_PAGES = 100; // hard backstop: ≤100k points per vehicle+range

/**
 * Every telemetry point for ONE vehicle within [from, to], oldest-first.
 *
 * The shared base for ALL device-GPS-derived features — route replay today, and
 * engine-hours / distance / idle / trip-stop metrics later — so it returns the
 * COMPLETE series, never a sampled or silently-capped subset. Results are
 * paginated to defeat PostgREST's per-request row cap (a busy day easily exceeds
 * 1000 fixes); the (vehicle_id, recorded_at) index serves the range scan
 * cheaply. Callers that only need a drawable line should sample afterward.
 */
export async function listVehicleTrack(
  vehicleId: string,
  from: Date | string,
  to: Date | string
): Promise<TelemetryRow[]> {
  const fromIso = typeof from === "string" ? from : from.toISOString();
  const toIso = typeof to === "string" ? to : to.toISOString();

  const rows: TelemetryRow[] = [];
  for (let page = 0; page < TRACK_MAX_PAGES; page++) {
    const offset = page * TRACK_PAGE;
    const { data, error } = await supabaseAdmin
      .from("device_telemetry")
      .select(
        "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
      )
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", fromIso)
      .lte("recorded_at", toIso)
      .order("recorded_at", { ascending: true })
      .range(offset, offset + TRACK_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as TelemetryRow[];
    rows.push(...batch);
    if (batch.length < TRACK_PAGE) break;
  }
  return rows;
}
