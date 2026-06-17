"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import {
  startShiftSchema,
  endShiftSchema,
  editEntrySchema,
} from "@/lib/validation";
import { workedMs, formatDurationShort, formatTime } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  shiftSummaryMessage,
  shiftStartedMessage,
} from "@/lib/telegram-messages";

export type ShiftResult = { ok: boolean; error?: string };

/**
 * Notify every linked admin that a driver just started a shift. Best-effort:
 * runs after the shift row is committed and never blocks or fails the action.
 */
async function notifyAdminsShiftStarted(
  workerName: string,
  plate: string,
  startedIso: string
): Promise<void> {
  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);

  for (const a of admins ?? []) {
    const loc = (a.telegram_locale as string) ?? "tr";
    await sendTelegramMessage(
      a.telegram_chat_id as string,
      shiftStartedMessage(loc, {
        name: workerName,
        plate,
        time: formatTime(startedIso, loc),
      })
    );
  }
}

export async function startShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  const parsed = startShiftSchema.safeParse({
    start_km: formData.get("start_km"),
    plate: formData.get("plate") || null,
    expected_cargo: formData.get("expected_cargo") || null,
    vehicle_id: formData.get("vehicle_id") || null,
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

  // If a vehicle was picked, that's the canonical link. Denormalize its plate
  // into time_entries.plate so existing reports/exports keep working unchanged.
  let vehiclePlate: string | null = null;
  if (parsed.data.vehicle_id) {
    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("plate")
      .eq("id", parsed.data.vehicle_id)
      .maybeSingle();
    vehiclePlate = (v?.plate as string) ?? null;
  }

  const startedIso = new Date().toISOString();
  const shiftPlate = vehiclePlate ?? parsed.data.plate ?? session.plate ?? null;
  const insert: Record<string, unknown> = {
    worker_id: session.worker_id!,
    started_at: startedIso,
    start_km: parsed.data.start_km,
    plate: shiftPlate,
    vehicle_id: parsed.data.vehicle_id ?? null,
    break_minutes: 0,
  };
  if (parsed.data.expected_cargo !== null && parsed.data.expected_cargo !== undefined) {
    insert.cargo_count = parsed.data.expected_cargo;
    insert.start_package_count = parsed.data.expected_cargo;
  }

  let { error } = await supabaseAdmin.from("time_entries").insert(insert);
  if (error && /vehicle_id|start_package_count|column/i.test(error.message)) {
    // Pre-migration fallback: vehicle columns not applied yet → insert legacy shape
    // so shift-start never breaks before migration 009 is run.
    const legacy = { ...insert };
    delete legacy.vehicle_id;
    delete legacy.start_package_count;
    ({ error } = await supabaseAdmin.from("time_entries").insert(legacy));
  }
  if (error) return { ok: false, error: error.message };

  // Telegram: alert linked admins that this driver started a shift
  // (best-effort, never blocks the action).
  await notifyAdminsShiftStarted(
    session.name ?? "—",
    shiftPlate ?? "—",
    startedIso
  );

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
    .select("id, start_km, started_at, break_minutes")
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

  const endedIso = new Date().toISOString();
  const finalBreak =
    parsed.data.break_minutes ?? active.break_minutes ?? 0;
  const updateData: Record<string, unknown> = {
    ended_at: endedIso,
    end_km: parsed.data.end_km,
    notes: parsed.data.notes,
    summary_notified_at: endedIso,
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

  // Telegram end-of-shift summary to the driver (best-effort, never blocks).
  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("id", session.worker_id!)
    .maybeSingle();
  if (me?.telegram_chat_id) {
    const loc = (me.telegram_locale as string) ?? "tr";
    const ms = workedMs({
      started_at: active.started_at,
      ended_at: endedIso,
      break_minutes: finalBreak,
    });
    await sendTelegramMessage(
      me.telegram_chat_id as string,
      shiftSummaryMessage(loc, {
        hours: formatDurationShort(ms, loc),
        km: String(parsed.data.end_km - active.start_km),
        cargo: String(parsed.data.cargo_count ?? 0),
        breakMin: String(finalBreak),
      })
    );
  }

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Marks the active shift as "on break" server-side (so the vehicle/admin views
 * can show the molada status live). Best-effort; the panel keeps its own local
 * break timer for the worked-time math.
 */
export async function startBreakAction(): Promise<ShiftResult> {
  const session = await requireWorker();
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: new Date().toISOString() })
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .is("break_started_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * Logs accumulated break minutes to the active shift.
 * Called from the panel when user toggles break OFF — we add elapsed minutes to break_minutes.
 * Also clears the server-side break flag (break_started_at).
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
  // Keep break-minute logging independent of the new column so this never
  // regresses if migration 009 hasn't been applied yet.
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_minutes: newBreak })
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);

  if (error) return { ok: false, error: error.message };

  // Best-effort: clear the server-side break flag (no-op pre-migration).
  await supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: null })
    .eq("id", active.id)
    .then(
      () => {},
      () => {}
    );

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
