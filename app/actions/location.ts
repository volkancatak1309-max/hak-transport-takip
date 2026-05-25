"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { workedMs } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import { nineHourMessage } from "@/lib/telegram-messages";

export type LocationResult = { ok: boolean; error?: string; skipped?: boolean };

const MIN_INTERVAL_MS = 30_000;
const NINE_HOURS_MS = 9 * 60 * 60 * 1000;

type ActiveShift = {
  id: string;
  started_at: string;
  break_minutes: number | null;
  plate: string | null;
  nine_hour_notified_at: string | null;
};

/**
 * If the active shift has crossed 9 worked hours, alert all admins on Telegram
 * exactly once (guarded by nine_hour_notified_at). Piggybacks on location pings
 * since there is no background cron.
 */
async function maybeNotifyNineHours(
  shift: ActiveShift,
  workerName: string,
  sessionPlate: string | null
): Promise<void> {
  if (shift.nine_hour_notified_at) return;
  const ms = workedMs({
    started_at: shift.started_at,
    ended_at: null,
    break_minutes: shift.break_minutes ?? 0,
  });
  if (ms <= NINE_HOURS_MS) return;

  // Atomic claim: only the call that flips NULL -> now proceeds to notify.
  const { data: claimed } = await supabaseAdmin
    .from("time_entries")
    .update({ nine_hour_notified_at: new Date().toISOString() })
    .eq("id", shift.id)
    .is("nine_hour_notified_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return;

  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);

  const hours = (ms / 3_600_000).toFixed(1).replace(".", ",");
  const plate = shift.plate ?? sessionPlate ?? "—";
  for (const a of admins ?? []) {
    await sendTelegramMessage(
      a.telegram_chat_id as string,
      nineHourMessage((a.telegram_locale as string) ?? null, {
        name: workerName,
        plate,
        hours,
      })
    );
  }
}

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
    .select("id, started_at, break_minutes, plate, nine_hour_notified_at")
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeShift) {
    await maybeNotifyNineHours(
      activeShift as ActiveShift,
      session.name ?? "—",
      session.plate ?? null
    );
  }

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
