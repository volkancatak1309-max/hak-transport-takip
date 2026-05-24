"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";

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

/**
 * Replays a shift event that was queued offline, preserving the original
 * client timestamp so the recorded times reflect when it actually happened.
 */
export async function processQueuedShift(item: Item): Promise<QueueProcessResult> {
  const session = await requireWorker();
  const workerId = session.worker_id!;
  const when = new Date(item.clientTime);
  const whenIso = Number.isNaN(when.getTime())
    ? new Date().toISOString()
    : when.toISOString();

  if (item.type === "start") {
    const startKm = num(item.payload.start_km);
    if (startKm === null || startKm < 0) return { ok: false, error: "invalid" };

    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .maybeSingle();
    if (active) return { ok: true }; // already started; treat as done

    const insert: Record<string, unknown> = {
      worker_id: workerId,
      started_at: whenIso,
      start_km: startKm,
      plate: (item.payload.plate as string) || session.plate || null,
      break_minutes: 0,
    };
    const cargo = num(item.payload.expected_cargo);
    if (cargo !== null) insert.cargo_count = cargo;

    const { error } = await supabaseAdmin.from("time_entries").insert(insert);
    if (error) return { ok: false, error: error.message };
  } else if (item.type === "end") {
    const endKm = num(item.payload.end_km);
    if (endKm === null || endKm < 0) return { ok: false, error: "invalid" };

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

    const update: Record<string, unknown> = {
      ended_at: whenIso,
      end_km: endKm,
      notes: (item.payload.notes as string) || null,
    };
    const br = num(item.payload.break_minutes);
    if (br !== null) update.break_minutes = br;
    const cargo = num(item.payload.cargo_count);
    if (cargo !== null) update.cargo_count = cargo;
    if (item.payload.plate) update.plate = item.payload.plate;

    const { error } = await supabaseAdmin
      .from("time_entries")
      .update(update)
      .eq("id", active.id)
      .eq("worker_id", workerId);
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
