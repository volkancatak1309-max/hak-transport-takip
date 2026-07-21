"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import {
  startShiftSchema,
  endShiftSchema,
  editEntrySchema,
  MAX_ODOMETER,
  MAX_PER_SHIFT_KM,
  MAX_COUNT,
} from "@/lib/validation";
import { workedMs, formatDurationShort, formatTime } from "@/lib/format";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveStartKm } from "@/lib/auto-shift";
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

  // Required: a vehicle (or plate fallback) AND a start odometer. Empty strings
  // coerce to 0, so guard the raw values before validation. Enforced here on the
  // server too — hiding the fields in the UI is not enough.
  const rawVehicle = String(formData.get("vehicle_id") ?? "").trim();
  const rawPlate = String(formData.get("plate") ?? "").trim();
  const rawStartKm = String(formData.get("start_km") ?? "").trim();
  if (!rawVehicle && !rawPlate) return { ok: false, error: "vehicle_required" };
  if (rawStartKm === "") return { ok: false, error: "start_km_required" };

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

/**
 * Manuel vardiya başlatma (şoför paneli bekleme ekranı).
 *
 * Kontak sinyali gecikirse ya da hiç gelmezse şoför vardiyayı kendi başlatır.
 * Araç ilişkisinin TEK kaynağı vehicles.assigned_worker_id'dir — şoför araç
 * seçmez, atanmış aracıyla açar. Yazılan satır lib/auto-shift.ts'in yazdığıyla
 * aynı kolon setine sahiptir; farklar bilinçli:
 *   • auto_started=false  → auto-shift bu vardiyayı ASLA otomatik kapatmaz
 *     (auto-shift.ts: `if (!vehicleShift || !vehicleShift.auto_started) continue`);
 *     başlatan bitirir.
 *   • confirmation_status="confirmed" → başlatma zaten şoförün kendi eylemi,
 *     bir saniye sonra "VARDİYAYI ONAYLA" kartını göstermek anlamsız olurdu.
 * vehicle_id HER ZAMAN doldurulur: auto-shift açık vardiyaları hem worker'a hem
 * araca göre indeksler; boş bırakmak kontak açılınca ikinci satır riskidir.
 */
export async function startShiftManualAction(): Promise<ShiftResult> {
  const session = await requireWorker();

  // 0) Çalışan hâlâ aktif mi? requireWorker BUNU KAPSAMAZ: is_active yalnız
  //    girişte bir kez bakılıyor (app/actions/auth.ts) ve oturum çerezi 30 gün
  //    yaşıyor. İşten ayrılan şoförün telefonu aksi hâlde ay sonuna kadar
  //    vardiya açabilirdi. auto-shift aynı kontrolü yapıyor (w.is_active).
  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("is_active")
    .eq("id", session.worker_id!)
    .maybeSingle();
  if (!me || me.is_active !== true) return { ok: false, error: "inactive_worker" };

  // 1) Atanmış araç — panel/page.tsx ile aynı sorgu. "active" katılığı
  //    auto-shift ile aynı: bakımdaki araçla vardiya elle de açılmaz.
  const { data: veh } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, status")
    .eq("assigned_worker_id", session.worker_id!)
    .neq("status", "inactive")
    .order("plate")
    .limit(1)
    .maybeSingle();
  if (!veh) return { ok: false, error: "no_vehicle" };
  if ((veh.status as string) !== "active") {
    return { ok: false, error: "vehicle_unavailable" };
  }

  // 2) Çift açık vardiya guard'ı (startShiftAction ile aynı). DB tarafında
  //    uq_time_entries_one_open partial unique index son sözü söyler.
  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();
  if (active) return { ok: false, error: "active" };

  // 2b) ARAÇ guard'ı. uq_time_entries_one_open yalnız worker_id'ye bakar, yani
  //     DB "aynı araçta iki açık vardiya"yı engellemez. auto-shift bu yarısını
  //     kodla koruyor (`!vehicleShift`); manuel yol da korumazsa şu senaryo
  //     bozuk veri üretir: önceki şoför vardiyasını kapatmayı unutmuş, yönetici
  //     aracı yedek şoföre devretmiş → araca ait iki açık satır oluşur ve
  //     openByVehicle/activeByVehicle haritaları hangisini tutacağını
  //     bilemez. Şoföre net mesaj verip yöneticiye yönlendiriyoruz.
  const { data: vehicleBusy } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("vehicle_id", veh.id as string)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (vehicleBusy) return { ok: false, error: "vehicle_busy" };

  // 3) Başlangıç km: odometre → aracın son biten vardiyası → 0. Şoför
  //    "Ayarlar → Başlangıç KM"den düzeltebilir.
  const latest = await latestVehicleTelemetry(veh.id as string);
  const startKm = await resolveStartKm(veh.id as string, latest?.odometer_km);

  const startedIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("time_entries").insert({
    worker_id: session.worker_id!,
    vehicle_id: veh.id,
    plate: veh.plate,
    started_at: startedIso,
    start_km: startKm,
    break_minutes: 0,
    auto_started: false,
    confirmation_status: "confirmed",
    confirmed_at: startedIso,
  });
  if (error) {
    // 23505 = uq_time_entries_one_open. Şoför butona bastığı saniyede cron
    // kontaktan açtıysa bu bir hata değil, "zaten aktif" durumudur.
    if (/duplicate key|23505/i.test(error.message)) {
      return { ok: false, error: "active" };
    }
    return { ok: false, error: error.message };
  }

  await notifyAdminsShiftStarted(
    session.name ?? "—",
    (veh.plate as string) ?? "—",
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
    undelivered_count: formData.get("undelivered_count") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  // Yeni paket akışı: "teslim edilemeyen" kapanışta ZORUNLU (0 girilebilir, boş
  // bırakılamaz). İstemci de required yapıyor; sunucu son söz.
  if (
    parsed.data.undelivered_count === null ||
    parsed.data.undelivered_count === undefined
  ) {
    return { ok: false, error: "undelivered_required" };
  }

  const { data: active, error: findErr } = await supabaseAdmin
    .from("time_entries")
    .select("id, start_km, started_at, break_minutes, start_package_count")
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
  const kmDiffShift = parsed.data.end_km - active.start_km;
  if (kmDiffShift > MAX_PER_SHIFT_KM) {
    return { ok: false, error: `km_high:${kmDiffShift}:${MAX_PER_SHIFT_KM}` };
  }

  const endedIso = new Date().toISOString();
  const finalBreak =
    parsed.data.break_minutes ?? active.break_minutes ?? 0;

  // Paket muhasebesi (yeni akış, +1 sayaç yok):
  //  • alınan  = start_package_count (şoför gün içinde manuel girdi)
  //  • teslim edilemeyen = undelivered_count (kapanışta girilir, zorunlu)
  //  • teslim edilen (cargo_count) = alınan − teslim edilemeyen  → TÜRETİLİR
  // Alınan hiç girilmemişse (null) teslim edilen bilinmiyor kalır (null yazmayız,
  // mevcut değeri ezmeyiz).
  const undelivered = parsed.data.undelivered_count;
  const totalTaken = active.start_package_count;
  const delivered =
    totalTaken !== null && totalTaken !== undefined
      ? Math.max(0, totalTaken - undelivered)
      : null;

  const updateData: Record<string, unknown> = {
    ended_at: endedIso,
    end_km: parsed.data.end_km,
    notes: parsed.data.notes,
    summary_notified_at: endedIso,
    end_reason: "manual",
    undelivered_count: undelivered,
  };
  if (parsed.data.plate) updateData.plate = parsed.data.plate;
  if (parsed.data.break_minutes !== null && parsed.data.break_minutes !== undefined) {
    updateData.break_minutes = parsed.data.break_minutes;
  }
  if (delivered !== null) updateData.cargo_count = delivered;

  let { error } = await supabaseAdmin
    .from("time_entries")
    .update(updateData)
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);
  if (error && /undelivered_count|end_reason|column/i.test(error.message)) {
    // Pre-migration fallback: column not applied yet → end the shift anyway.
    const legacy = { ...updateData };
    delete legacy.undelivered_count;
    delete legacy.end_reason;
    ({ error } = await supabaseAdmin
      .from("time_entries")
      .update(legacy)
      .eq("id", active.id)
      .eq("worker_id", session.worker_id!));
  }

  if (error) return { ok: false, error: error.message };

  // Başlangıç onayı hiç verilmeden kapanan vardiya "onaysız" işaretlenir →
  // yönetici panelinde uyarı rozeti (İş 1). Best-effort: migration 020
  // uygulanmadıysa sessiz no-op (kapanışı asla geri döndürmez).
  await supabaseAdmin
    .from("time_entries")
    .update({ confirmation_status: "unconfirmed" })
    .eq("id", active.id)
    .eq("confirmation_status", "pending")
    .then(
      () => {},
      () => {}
    );

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
        cargo: String(delivered ?? 0),
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

/**
 * Driver edits the start odometer of their OWN, still-OPEN shift. The server
 * enforces both (worker_id match + ended_at IS NULL): a closed shift or someone
 * else's shift is refused regardless of the UI.
 */
export async function updateStartKmAction(km: number): Promise<ShiftResult> {
  const session = await requireWorker();
  const v = Math.floor(Number(km));
  if (!Number.isFinite(v) || v < 0) return { ok: false, error: "errKmNeg" };
  if (v > MAX_ODOMETER) return { ok: false, error: "errKmRange" };

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .update({
      start_km: v,
      updated_at: new Date().toISOString(),
      updated_by: session.worker_id,
    })
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "no_active" };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Driver sets/updates the start-of-day package count on their OWN, OPEN shift
 * (often known only hours after loading). Empty clears it. Open-shift only.
 */
export async function updatePackageCountAction(
  count: number | null
): Promise<ShiftResult> {
  const session = await requireWorker();
  let v: number | null = null;
  if (count !== null && count !== undefined && String(count) !== "") {
    v = Math.floor(Number(count));
    if (!Number.isFinite(v) || v < 0 || v > MAX_COUNT) return { ok: false, error: "invalid" };
  }

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .update({
      start_package_count: v,
      updated_at: new Date().toISOString(),
      updated_by: session.worker_id,
    })
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "no_active" };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Admin corrects the start/end odometer of ANY shift (open or closed). Validates
 * non-negative and end ≥ start; stamps the audit columns (updated_at/updated_by).
 */
export async function adminUpdateKmAction(
  entryId: string,
  startKm: number,
  endKm: number | null
): Promise<ShiftResult> {
  const session = await requireAdmin();
  const s = Math.floor(Number(startKm));
  if (!Number.isFinite(s) || s < 0) return { ok: false, error: "errKmNeg" };
  if (s > MAX_ODOMETER) return { ok: false, error: "errKmRange" };

  let e: number | null = null;
  if (endKm !== null && endKm !== undefined && String(endKm) !== "") {
    e = Math.floor(Number(endKm));
    if (!Number.isFinite(e) || e < 0) return { ok: false, error: "errKmNeg" };
    if (e > MAX_ODOMETER) return { ok: false, error: "errKmRange" };
    if (e < s) return { ok: false, error: `km_low:${e}:${s}` };
    if (e - s > MAX_PER_SHIFT_KM) return { ok: false, error: `km_high:${e - s}:${MAX_PER_SHIFT_KM}` };
  }

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({
      start_km: s,
      end_km: e,
      updated_at: new Date().toISOString(),
      updated_by: session.worker_id,
    })
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
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
