"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { MAX_COUNT } from "@/lib/validation";
import { checkUndelivered } from "@/lib/package-limits";
import { recountShiftPackages } from "@/lib/shift-packages";
import { seferePaketBaglaVardiyadan } from "@/lib/sefer-bridge";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveEndKm } from "@/lib/auto-shift";
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
    // Çevrimdışı vardiya BAŞLATMA kaldırıldı (21.07.2026). Tek başlatma yolu
    // (panelin "VARDİYAYI BAŞLAT" butonu) zaten çevrimiçi gerektiriyordu:
    // başlangıç km'sini sunucu telemetriden çözer, istemci onu bilemez. Bu dal
    // yalnız client'ın istemci-tarafı km'siyle vardiya açabildiği eski yoldan
    // kalmıştı; kalsaydı, uygulamadan silinen sayaç girişi kuyruk üzerinden
    // geri sızabilirdi. Eski cihazda kalmış bir kuyruk öğesi sessizce düşer.
    return { ok: true };
  } else if (item.type === "end") {
    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id, vehicle_id, start_km, started_at, start_package_count")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!active) return { ok: true }; // nothing to close

    // Bitiş km'si CİHAZDAN — istemci km göndermiyor (21.07.2026). Online
    // kapanışla (endShiftAction) birebir aynı kaynak: odometre → GPS → null.
    // Kuyruk telefon çevrimiçi olunca işlendiği için telemetri o an okunabilir.
    let endKm: number | null = null;
    if (active.vehicle_id) {
      const latest = await latestVehicleTelemetry(active.vehicle_id as string);
      endKm = await resolveEndKm(
        active.vehicle_id as string,
        { started_at: active.started_at, start_km: active.start_km },
        whenIso,
        latest?.odometer_km,
        latest?.recorded_at
      );
    }

    const update: Record<string, unknown> = {
      ended_at: whenIso,
      end_km: endKm,
      notes: (item.payload.notes as string) || null,
    };
    const br = num(item.payload.break_minutes);
    if (br !== null && br >= 0 && br <= 1440) update.break_minutes = br;
    // Üst sınır online kapanışla AYNI kural (lib/package-limits.ts): kuyruk,
    // arayüzün reddettiği bir değerin arka kapıdan girmesine izin vermemeli.
    // Sınır dışıysa alan yazılmaz (kapanış yine de tamamlanır — çevrimdışı
    // kuyruk hiçbir koşulda vardiyayı açıkta bırakmamalı).
    const undel = num(item.payload.undelivered_count);
    if (undel !== null && checkUndelivered(undel, active.start_package_count as number | null).ok) {
      update.undelivered_count = undel;
    }
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

    // SEFER PAKET KÖPRÜSÜ (Tur 3) — çevrimdışı kuyruktan gelen kapanış da
    // günün seferine bağlansın; online kapanışla aynı kural, aynı yer.
    await seferePaketBaglaVardiyadan(active.id as string);
  } else if (item.type === "break") {
    const add = num(item.payload.minutes) ?? 0;
    const { data: active } = await supabaseAdmin
      .from("time_entries")
      .select("id, break_minutes")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .maybeSingle();
    if (!active) return { ok: true };
    // break_started_at DA TEMİZLENİR (22.07.2026). Bu yol yalnız break_minutes'ı
    // güncelliyordu; addBreakMinutesAction'ın ikinci adımı (bayrağı sıfırla)
    // burada yoktu. Yani çevrimdışı bitirilen bir mola — süresi ne olursa olsun —
    // şoförü yönetici tarafında "Molada" bırakıyordu. İki yol artık aynı işi
    // yapıyor; mola bitişinin tek anlamı var.
    const { error } = await supabaseAdmin
      .from("time_entries")
      .update({
        break_minutes: (active.break_minutes ?? 0) + Math.max(0, add),
        break_started_at: null,
      })
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
    // (vardiya bağlama orada). Vardiyasız da kaydedilir.
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
