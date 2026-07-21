"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { MAX_ODOMETER, MAX_PER_SHIFT_KM, MAX_COUNT } from "@/lib/validation";
import { recountShiftPackages } from "@/lib/shift-packages";
import { hasShiftToday } from "@/lib/shift-day";
import { reportProblemAction } from "@/app/actions/driver-panel";
import type { DriverReportType } from "@/lib/types";

export type QueueProcessResult = { ok: boolean; error?: string };

type Item = {
  type: "start" | "end" | "break" | "package" | "report";
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

    // Günde tek vardiya (lib/shift-day.ts): şoför çevrimdışıyken kuyruğa
    // giren başlatma, o gün zaten bir vardiya varsa ikinci satırı AÇMAZ.
    // Hata değil "yapılacak bir şey kalmadı" durumudur — ok döner ki kuyruk
    // öğeyi sonsuza dek yeniden denemesin.
    if (await hasShiftToday(workerId)) return { ok: true };

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
      .select("id, start_km, start_package_count")
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
    const undel = num(item.payload.undelivered_count);
    if (undel !== null && undel >= 0 && undel <= MAX_COUNT) update.undelivered_count = undel;
    // Teslim edilen = alınan − teslim edilemeyen (online endShiftAction ile aynı
    // türetme). Alınan bilinmiyorsa istemcinin gönderdiği cargo_count'a düşülür.
    const total = active.start_package_count as number | null;
    if (total !== null && total !== undefined && undel !== null) {
      update.cargo_count = Math.max(0, total - undel);
    } else {
      const cargo = num(item.payload.cargo_count);
      if (cargo !== null && cargo >= 0 && cargo <= MAX_COUNT) update.cargo_count = cargo;
    }
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
  } else if (item.type === "package") {
    // Çevrimdışı basılan "+1 PAKET": açık vardiya, yoksa olay anını kapsayan
    // vardiya (otomatik kapanış flush'tan önce gelmiş olabilir). Hiçbiri yoksa
    // sessizce düş — paket bir vardiyaya bağlanmak zorunda.
    let entryId: string | null = null;
    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .maybeSingle();
    if (active) {
      entryId = active.id as string;
    } else {
      const { data: covering } = await supabaseAdmin
        .from("time_entries")
        .select("id")
        .eq("worker_id", workerId)
        .lte("started_at", whenIso)
        .gte("ended_at", whenIso)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      entryId = (covering?.id as string) ?? null;
    }
    if (!entryId) return { ok: true };

    const lat = num(item.payload.lat);
    const lng = num(item.payload.lng);
    const validCoords =
      lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const acc = num(item.payload.accuracy);
    const { error } = await supabaseAdmin.from("shift_packages").insert({
      time_entry_id: entryId,
      worker_id: workerId,
      latitude: validCoords ? lat : null,
      longitude: validCoords ? lng : null,
      accuracy: acc !== null && acc >= 0 ? acc : null,
      recorded_at: whenIso,
    });
    if (error) return { ok: false, error: error.message };
    try {
      await recountShiftPackages(entryId);
    } catch {
      // sayaç senkronu sonraki olayda düzelir
    }
  } else if (item.type === "report") {
    // Çevrimdışı "SORUN BİLDİR": aynı action'ı sunucu tarafında yeniden çağır
    // (vardiya bağlama + Telegram bildirimi orada). Vardiyasız da kaydedilir.
    const type = String(item.payload.report_type ?? "") as DriverReportType;
    const r = await reportProblemAction({
      type,
      lat: num(item.payload.lat),
      lng: num(item.payload.lng),
      clientTime: item.clientTime,
    });
    if (!r.ok) return r;
  }

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}
