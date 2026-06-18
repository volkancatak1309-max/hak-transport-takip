"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { MAX_ODOMETER, MAX_PER_SHIFT_KM, MAX_COUNT } from "@/lib/validation";

export type QueueProcessResult = { ok: boolean; error?: string };

type Item = {
  type: "start" | "end" | "break";
  payload: Record<string, unknown>;
  clientTime: string;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Offline events carry the client's own timestamp so a shift synced later still
// reflects when it actually happened. But an *unvalidated* client time lets a
// driver back/forward-date shifts and skew the AZG report and DATEV/BMD payroll
// exports. We trust the client time only inside a sane window; anything outside
// it (future, or older than 48 h) falls back to the server clock instead of
// being silently accepted.
const MAX_FUTURE_SKEW_MS = 5 * 60_000; // tolerate up to 5 min of clock skew
const MAX_BACKDATE_MS = 48 * 60 * 60_000; // offline events older than 48 h

function resolveEventTime(clientTime: string): string {
  const now = Date.now();
  const t = new Date(clientTime).getTime();
  if (Number.isNaN(t)) return new Date(now).toISOString();
  if (t > now + MAX_FUTURE_SKEW_MS) return new Date(now).toISOString(); // future
  if (t < now - MAX_BACKDATE_MS) return new Date(now).toISOString(); // too old
  return new Date(t).toISOString();
}

/**
 * Replays a shift event that was queued offline, preserving the original
 * client timestamp so the recorded times reflect when it actually happened.
 */
export async function processQueuedShift(item: Item): Promise<QueueProcessResult> {
  const session = await requireWorker();
  const workerId = session.worker_id!;
  const whenIso = resolveEventTime(item.clientTime);

  if (item.type === "start") {
    const startKm = num(item.payload.start_km);
    if (startKm === null || startKm < 0 || startKm > MAX_ODOMETER)
      return { ok: false, error: "invalid" };

    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .maybeSingle();
    if (active) return { ok: true }; // already started; treat as done

    const vehicleId = (item.payload.vehicle_id as string) || null;
    let vehiclePlate: string | null = null;
    if (vehicleId) {
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("plate")
        .eq("id", vehicleId)
        .maybeSingle();
      vehiclePlate = (v?.plate as string) ?? null;
    }

    const insert: Record<string, unknown> = {
      worker_id: workerId,
      started_at: whenIso,
      start_km: startKm,
      plate: vehiclePlate || (item.payload.plate as string) || session.plate || null,
      vehicle_id: vehicleId,
      break_minutes: 0,
    };
    const cargo = num(item.payload.expected_cargo);
    if (cargo !== null && cargo >= 0 && cargo <= MAX_COUNT) {
      insert.cargo_count = cargo;
      insert.start_package_count = cargo;
    }

    const { error } = await supabaseAdmin.from("time_entries").insert(insert);
    if (error) return { ok: false, error: error.message };
  } else if (item.type === "end") {
    const endKm = num(item.payload.end_km);
    if (endKm === null || endKm < 0 || endKm > MAX_ODOMETER)
      return { ok: false, error: "invalid" };

    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id, start_km")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!active) return { ok: true }; // nothing to close
    if (endKm < active.start_km) return { ok: false, error: "km_low" };
    if (endKm - active.start_km > MAX_PER_SHIFT_KM)
      return { ok: false, error: "invalid" };

    const update: Record<string, unknown> = {
      ended_at: whenIso,
      end_km: endKm,
      notes: (item.payload.notes as string) || null,
    };
    const br = num(item.payload.break_minutes);
    if (br !== null && br >= 0 && br <= 1440) update.break_minutes = br;
    const cargo = num(item.payload.cargo_count);
    if (cargo !== null && cargo >= 0 && cargo <= MAX_COUNT) update.cargo_count = cargo;
    const undel = num(item.payload.undelivered_count);
    if (undel !== null && undel >= 0 && undel <= MAX_COUNT) update.undelivered_count = undel;
    if (item.payload.plate) update.plate = item.payload.plate;

    let { error } = await supabaseAdmin
      .from("time_entries")
      .update(update)
      .eq("id", active.id)
      .eq("worker_id", workerId);
    if (error && /undelivered_count|column/i.test(error.message)) {
      const legacy = { ...update };
      delete legacy.undelivered_count;
      ({ error } = await supabaseAdmin
        .from("time_entries")
        .update(legacy)
        .eq("id", active.id)
        .eq("worker_id", workerId));
    }
    if (error) return { ok: false, error: error.message };
  } else if (item.type === "break") {
    const add = num(item.payload.minutes) ?? 0;
    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id, break_minutes")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .maybeSingle();
    if (!active) return { ok: true };
    const { error } = await supabaseAdmin
      .from("time_entries")
      .update({ break_minutes: (active.break_minutes ?? 0) + Math.max(0, add) })
      .eq("id", active.id)
      .eq("worker_id", workerId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}
