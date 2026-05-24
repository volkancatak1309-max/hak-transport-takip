"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";

export type LocationResult = { ok: boolean; error?: string; skipped?: boolean };

const MIN_INTERVAL_MS = 30_000;

export async function recordLocation(input: {
  lat: number;
  lng: number;
  accuracy?: number | null;
}): Promise<LocationResult> {
  const session = await requireWorker();
  const workerId = session.worker_id!;

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { ok: false, error: "invalid_coords" };
  }

  // DB spam guard: skip if a row was written < 30s ago for this worker
  const { data: last } = await supabaseAdmin
    .from("driver_locations")
    .select("recorded_at")
    .eq("worker_id", workerId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.recorded_at) {
    const age = Date.now() - new Date(last.recorded_at).getTime();
    if (age < MIN_INTERVAL_MS) {
      return { ok: true, skipped: true };
    }
  }

  // Link to the active shift if there is one
  const { data: activeShift } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const accuracy =
    input.accuracy != null && Number.isFinite(Number(input.accuracy))
      ? Number(input.accuracy)
      : null;

  const { error } = await supabaseAdmin.from("driver_locations").insert({
    worker_id: workerId,
    time_entry_id: activeShift?.id ?? null,
    latitude: lat,
    longitude: lng,
    accuracy,
    recorded_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
