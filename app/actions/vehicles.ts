"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope } from "@/lib/driver-scope";
import { vehicleSchema } from "@/lib/validation";
import { ACTIVE_FLEETS } from "@/lib/tenant";
import type { Vehicle } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

/** Admin-only: book a new penalty (Strafe) against a vehicle. */
export async function addVehiclePenalty(
  vehicleId: string,
  input: { penalty_date: string; amount: number | null; description: string | null }
): Promise<Result> {
  const session = await requireAdmin();
  if (!vehicleId) return { ok: false, error: "bad_vehicle" };

  const date = (input.penalty_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    return { ok: false, error: "bad_date" };
  }

  let amount: number | null = null;
  if (input.amount !== null && input.amount !== undefined) {
    if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 1_000_000) {
      return { ok: false, error: "bad_amount" };
    }
    amount = Math.round(input.amount * 100) / 100;
  }

  const description = (input.description ?? "").trim().slice(0, 500) || null;

  const { error } = await supabaseAdmin.from("vehicle_penalties").insert({
    vehicle_id: vehicleId,
    penalty_date: date,
    amount,
    description,
    created_by: session.worker_id ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/araclar/${vehicleId}`);
  revalidatePath("/admin");
  return { ok: true };
}

/** Admin-only: mark a penalty paid / unpaid. */
export async function setVehiclePenaltyPaid(
  penaltyId: string,
  paid: boolean
): Promise<Result> {
  await requireAdmin();
  if (!penaltyId) return { ok: false, error: "bad_id" };

  const { error } = await supabaseAdmin
    .from("vehicle_penalties")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq("id", penaltyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/** Admin-only: delete a penalty record. */
export async function deleteVehiclePenalty(penaltyId: string): Promise<Result> {
  await requireAdmin();
  if (!penaltyId) return { ok: false, error: "bad_id" };

  const { error } = await supabaseAdmin
    .from("vehicle_penalties")
    .delete()
    .eq("id", penaltyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Vehicle CRUD (admin fleet management — /admin/araclar)
// ---------------------------------------------------------------------------

/** `error` is a code the client maps to an i18n message; `conflict` is the plate
 *  of the vehicle already using a unique field (plate / imei / device id). */
export type VehicleActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  conflict?: string;
};

const VEHICLE_COLS =
  "id, plate, fleet, make, model, year, status, flespi_device_id, imei, assigned_worker_id, inspection_due, insurance_due, tank_capacity_l, notes, created_at";

/** All vehicles, raw columns (admin management list). */
export async function listVehicles(): Promise<Vehicle[]> {
  await requireAdmin();
  const scope = await getTestScope();
  const { data } = await withoutTestRows(
    supabaseAdmin.from("vehicles").select(VEHICLE_COLS).order("plate"),
    "id",
    scope.vehicleIds
  );
  return (data ?? []) as Vehicle[];
}

function parseVehicle(formData: FormData) {
  return vehicleSchema.safeParse({
    plate: formData.get("plate"),
    make: formData.get("make") || null,
    model: formData.get("model") || null,
    year: formData.get("year") || null,
    status: formData.get("status"),
    // Form filoyu her zaman gönderir; bu yalnız son savunma. HAK61'de "mavi"
    // KALIR (kullanımda), tek filolu müşteride o müşterinin filosuna düşer —
    // yoksa zod enum'u geçen ama arayüzde görünmeyen bir filo yazılabilirdi.
    fleet:
      formData.get("fleet") ||
      (ACTIVE_FLEETS.includes("mavi") ? "mavi" : ACTIVE_FLEETS[0]),
    assigned_worker_id: formData.get("assigned_worker_id") || null,
    flespi_device_id: formData.get("flespi_device_id") || null,
    imei: formData.get("imei") || null,
    inspection_due: formData.get("inspection_due") || null,
    insurance_due: formData.get("insurance_due") || null,
    tank_capacity_l: formData.get("tank_capacity_l") || null,
  });
}

/**
 * Atama yazıldıktan SONRA çalışan tutarlılık adımı.
 *
 *  1) Bir şoför aynı anda tek araca atanabilir: şoför paneli ve Çalışanlar
 *     sayfası ilişkiden TEK araç okur (limit 1), ikinci atama sessizce
 *     görünmez olurdu. Bu yüzden şoförün varsa eski aracı serbest bırakılır.
 *  2) workers.plate AYNASI. Kanonik kaynak vehicles.assigned_worker_id ama
 *     eski okuma noktaları (harita şoför listesi, rota geçmişi, seferler,
 *     session.plate) hâlâ workers.plate'e bakıyor. Ayna burada güncellenmezse
 *     bu ekranlar yeni personelde kalıcı "—" gösterirdi — plaka alanı personel
 *     formundan kaldırıldığı için artık başka yazan yok.
 */
async function applyDriverAssignment(
  vehicleId: string,
  plate: string,
  workerId: string | null,
  previousWorkerId: string | null
): Promise<void> {
  if (workerId) {
    await supabaseAdmin
      .from("vehicles")
      .update({ assigned_worker_id: null })
      .eq("assigned_worker_id", workerId)
      .neq("id", vehicleId);
  }
  // Aracı bırakan şoförün aynası temizlenir (başka araca geçtiyse aşağıda
  // zaten yeni plakasıyla yeniden yazılır).
  if (previousWorkerId && previousWorkerId !== workerId) {
    await supabaseAdmin
      .from("workers")
      .update({ plate: null })
      .eq("id", previousWorkerId);
  }
  if (workerId) {
    await supabaseAdmin.from("workers").update({ plate }).eq("id", workerId);
  }
}

/** Plate of a DIFFERENT vehicle already using `value` in `field`, else null. */
async function conflictPlate(
  field: "plate" | "imei" | "flespi_device_id",
  value: string | number,
  excludeId: string | null
): Promise<string | null> {
  let q = supabaseAdmin.from("vehicles").select("id, plate").eq(field, value);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.limit(1).maybeSingle();
  return data ? (data.plate as string) : null;
}

/** Friendly uniqueness pre-check so we never surface a raw 23505 and can name
 *  the conflicting vehicle. Returns a result to short-circuit on, else null. */
async function checkVehicleConflicts(
  plate: string,
  imei: string | null,
  deviceId: number | null,
  excludeId: string | null
): Promise<VehicleActionResult | null> {
  const p = await conflictPlate("plate", plate, excludeId);
  if (p) return { ok: false, error: "plate_taken", conflict: p };
  if (imei) {
    const c = await conflictPlate("imei", imei, excludeId);
    if (c) return { ok: false, error: "imei_taken", conflict: c };
  }
  if (deviceId != null) {
    const c = await conflictPlate("flespi_device_id", deviceId, excludeId);
    if (c) return { ok: false, error: "device_taken", conflict: c };
  }
  return null;
}

/**
 * Araca ŞOFÖR OLMAYAN biri atanamaz (yönetici / test hesabı).
 *
 * Seçici zaten yalnız şoför gösteriyor (app/admin/araclar/**), ama bu sunucu
 * kapısı istemciye güvenmez — shift.ts'teki "not_a_driver" kapısıyla aynı
 * gerekçe. Kritik olan yanı: vehicles.assigned_worker_id, olayların şoför
 * eksenine çevrildiği TEK bağdır (lib/analytics.ts resolveDriver). Buraya bir
 * yönetici yazılırsa Top-10, Rölanti Panosu ve Aylık Pivot'ta o aracın olayları
 * "Atanmamış" satırına düşer — sızıntı olmaz ama aracın gerçek sahibi kaybolur.
 *
 * null (atamayı temizleme) her zaman serbest. Şefler is_admin=false → geçer.
 */
async function assertDriverAssignable(
  workerId: string | null
): Promise<VehicleActionResult | null> {
  if (!workerId) return null;
  const driverScope = await getDriverScope();
  if (driverScope.isDriver(workerId)) return null;
  return { ok: false, error: "Yönetici hesabı araca şoför olarak atanamaz" };
}

export async function createVehicle(
  formData: FormData
): Promise<VehicleActionResult> {
  await requireAdmin();
  const parsed = parseVehicle(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const d = parsed.data;
  const plate = d.plate.toUpperCase();

  const conflict = await checkVehicleConflicts(
    plate,
    d.imei ?? null,
    d.flespi_device_id ?? null,
    null
  );
  if (conflict) return conflict;

  const notDriver = await assertDriverAssignable(d.assigned_worker_id ?? null);
  if (notDriver) return notDriver;

  const { data, error } = await supabaseAdmin
    .from("vehicles")
    .insert({
      plate,
      make: d.make ?? null,
      model: d.model ?? null,
      year: d.year ?? null,
      status: d.status,
      fleet: d.fleet,
      flespi_device_id: d.flespi_device_id ?? null,
      imei: d.imei ?? null,
      inspection_due: d.inspection_due ?? null,
      insurance_due: d.insurance_due ?? null,
      tank_capacity_l: d.tank_capacity_l ?? null,
      assigned_worker_id: d.assigned_worker_id ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "insert" };
  await applyDriverAssignment(
    data.id as string,
    plate,
    d.assigned_worker_id ?? null,
    null
  );
  revalidatePath("/admin/araclar");
  revalidatePath("/admin/workers");
  revalidatePath("/panel");
  return { ok: true, id: data.id as string };
}

export async function updateVehicle(
  formData: FormData
): Promise<VehicleActionResult> {
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "id" };
  const parsed = parseVehicle(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const d = parsed.data;
  const plate = d.plate.toUpperCase();

  const conflict = await checkVehicleConflicts(
    plate,
    d.imei ?? null,
    d.flespi_device_id ?? null,
    id
  );
  if (conflict) return conflict;

  // Atama alanı yalnız GERÇEKTEN değiştirildiyse yazılır. Form açıldığındaki
  // değeri (assigned_worker_id_prev) geri gönderiyoruz: aksi hâlde muayene
  // tarihini düzeltmek için dakikalar önce açılmış bir dialog kaydedildiğinde,
  // bu arada başka bir yöneticinin yaptığı şoför değişikliği sessizce geri
  // alınırdı (lost update).
  const prevRaw = formData.get("assigned_worker_id_prev");
  const prevFromForm = typeof prevRaw === "string" && prevRaw ? prevRaw : null;
  const nextWorkerId = d.assigned_worker_id ?? null;
  const assignmentTouched = prevFromForm !== nextWorkerId;

  // Yalnız atama GERÇEKTEN değiştiyse denetlenir: dokunulmamış bir formda eski
  // (varsayımsal) yönetici ataması kaydı kilitlemesin — muayene tarihi
  // düzeltmek isteyen yönetici hata duvarına çarpmamalı.
  if (assignmentTouched) {
    const notDriver = await assertDriverAssignable(nextWorkerId);
    if (notDriver) return notDriver;
  }

  const { data: current } = await supabaseAdmin
    .from("vehicles")
    .select("assigned_worker_id")
    .eq("id", id)
    .maybeSingle();
  const currentWorkerId = (current?.assigned_worker_id as string) ?? null;

  const update: Record<string, unknown> = {
    plate,
    make: d.make ?? null,
    model: d.model ?? null,
    year: d.year ?? null,
    status: d.status,
    fleet: d.fleet,
    flespi_device_id: d.flespi_device_id ?? null,
    imei: d.imei ?? null,
    inspection_due: d.inspection_due ?? null,
    insurance_due: d.insurance_due ?? null,
    tank_capacity_l: d.tank_capacity_l ?? null,
  };
  if (assignmentTouched) update.assigned_worker_id = nextWorkerId;

  const { error } = await supabaseAdmin.from("vehicles").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (assignmentTouched) {
    await applyDriverAssignment(id, plate, nextWorkerId, currentWorkerId);
  } else if (currentWorkerId) {
    // Atama değişmedi ama plaka değişmiş olabilir — ayna yine hizalanmalı.
    await supabaseAdmin
      .from("workers")
      .update({ plate })
      .eq("id", currentWorkerId);
  }
  revalidatePath("/admin/araclar");
  revalidatePath("/admin/workers");
  revalidatePath("/panel");
  return { ok: true, id };
}

export async function deleteVehicle(id: string): Promise<VehicleActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "id" };
  const { error } = await supabaseAdmin.from("vehicles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/araclar");
  return { ok: true, id };
}

/**
 * ⌘K komut paleti için hafif araç dizini (id + plaka). 26-28 satır; palet
 * ilk açıldığında lazy çekilir, açılmadan sıfır maliyet (DESIGN-SYSTEM §7).
 */
export async function listVehiclePlates(): Promise<
  { id: string; plate: string }[]
> {
  await requireAdmin();
  const scope = await getTestScope();
  const { data } = await withoutTestRows(
    supabaseAdmin.from("vehicles").select("id, plate").order("plate"),
    "id",
    scope.vehicleIds
  );
  return (data ?? []) as { id: string; plate: string }[];
}
