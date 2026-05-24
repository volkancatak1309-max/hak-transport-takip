"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import {
  startShiftSchema,
  endShiftSchema,
  editEntrySchema,
} from "@/lib/validation";

export type ShiftResult = { ok: boolean; error?: string };

export async function startShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  const parsed = startShiftSchema.safeParse({
    start_km: formData.get("start_km"),
    plate: formData.get("plate") || null,
    expected_cargo: formData.get("expected_cargo") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();

  if (active) return { ok: false, error: "active" };

  const insert: Record<string, unknown> = {
    worker_id: session.worker_id!,
    started_at: new Date().toISOString(),
    start_km: parsed.data.start_km,
    plate: parsed.data.plate ?? session.plate ?? null,
    break_minutes: 0,
  };
  if (parsed.data.expected_cargo !== null && parsed.data.expected_cargo !== undefined) {
    insert.cargo_count = parsed.data.expected_cargo;
  }

  const { error } = await supabaseAdmin.from("time_entries").insert(insert);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

export async function endShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  const parsed = endShiftSchema.safeParse({
    end_km: formData.get("end_km"),
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
    break_minutes: formData.get("break_minutes") || null,
    cargo_count: formData.get("cargo_count") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const { data: active, error: findErr } = await supabaseAdmin
    .from("time_entries")
    .select("id, start_km")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) return { ok: false, error: "db" };
  if (!active) return { ok: false, error: "no_active" };

  if (parsed.data.end_km < active.start_km) {
    return {
      ok: false,
      error: `km_low:${parsed.data.end_km}:${active.start_km}`,
    };
  }

  const updateData: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
    end_km: parsed.data.end_km,
    notes: parsed.data.notes,
  };
  if (parsed.data.plate) updateData.plate = parsed.data.plate;
  if (parsed.data.break_minutes !== null && parsed.data.break_minutes !== undefined) {
    updateData.break_minutes = parsed.data.break_minutes;
  }
  if (parsed.data.cargo_count !== null && parsed.data.cargo_count !== undefined) {
    updateData.cargo_count = parsed.data.cargo_count;
  }

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(updateData)
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Logs accumulated break minutes to the active shift.
 * Called from the panel when user toggles break OFF — we add elapsed minutes to break_minutes.
 */
export async function addBreakMinutesAction(minutes: number): Promise<ShiftResult> {
  const session = await requireWorker();
  const add = Math.max(0, Math.floor(minutes));

  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id, break_minutes")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();

  if (!active) return { ok: false, error: "no_active" };

  const newBreak = (active.break_minutes ?? 0) + add;
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_minutes: newBreak })
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  return { ok: true };
}

export async function editEntryAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireAdmin();

  const parsed = editEntrySchema.safeParse({
    id: formData.get("id"),
    started_at: formData.get("started_at"),
    ended_at: formData.get("ended_at") || null,
    start_km: formData.get("start_km"),
    end_km: formData.get("end_km") || null,
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
    break_minutes: formData.get("break_minutes") || null,
    cargo_count: formData.get("cargo_count") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const startedAtIso = new Date(parsed.data.started_at).toISOString();
  const endedAtIso = parsed.data.ended_at ? new Date(parsed.data.ended_at).toISOString() : null;

  if (
    endedAtIso &&
    parsed.data.end_km !== null &&
    parsed.data.end_km !== undefined &&
    parsed.data.end_km < parsed.data.start_km
  ) {
    return { ok: false, error: `km_low:${parsed.data.end_km}:${parsed.data.start_km}` };
  }

  const update: Record<string, unknown> = {
    started_at: startedAtIso,
    ended_at: endedAtIso,
    start_km: parsed.data.start_km,
    end_km: parsed.data.end_km,
    plate: parsed.data.plate,
    notes: parsed.data.notes,
    break_minutes: parsed.data.break_minutes ?? 0,
    cargo_count: parsed.data.cargo_count,
    updated_at: new Date().toISOString(),
    updated_by: session.worker_id,
  };

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(update)
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

export async function deleteEntryAction(id: string): Promise<ShiftResult> {
  await requireAdmin();
  const { error } = await supabaseAdmin.from("time_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
