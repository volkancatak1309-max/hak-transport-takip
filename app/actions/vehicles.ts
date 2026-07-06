"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { vehicleSchema } from "@/lib/validation";
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
  "id, plate, make, model, year, status, flespi_device_id, imei, assigned_worker_id, inspection_due, insurance_due, notes, created_at";

/** All vehicles, raw columns (admin management list). */
export async function listVehicles(): Promise<Vehicle[]> {
  await requireAdmin();
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select(VEHICLE_COLS)
    .order("plate");
  return (data ?? []) as Vehicle[];
}

function parseVehicle(formData: FormData) {
  return vehicleSchema.safeParse({
    plate: formData.get("plate"),
    make: formData.get("make") || null,
    model: formData.get("model") || null,
    year: formData.get("year") || null,
    status: formData.get("status"),
    flespi_device_id: formData.get("flespi_device_id") || null,
    imei: formData.get("imei") || null,
    inspection_due: formData.get("inspection_due") || null,
    insurance_due: formData.get("insurance_due") || null,
  });
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

  const { data, error } = await supabaseAdmin
    .from("vehicles")
    .insert({
      plate,
      make: d.make ?? null,
      model: d.model ?? null,
      year: d.year ?? null,
      status: d.status,
      flespi_device_id: d.flespi_device_id ?? null,
      imei: d.imei ?? null,
      inspection_due: d.inspection_due ?? null,
      insurance_due: d.insurance_due ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "insert" };
  revalidatePath("/admin/araclar");
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

  const { error } = await supabaseAdmin
    .from("vehicles")
    .update({
      plate,
      make: d.make ?? null,
      model: d.model ?? null,
      year: d.year ?? null,
      status: d.status,
      flespi_device_id: d.flespi_device_id ?? null,
      imei: d.imei ?? null,
      inspection_due: d.inspection_due ?? null,
      insurance_due: d.insurance_due ?? null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/araclar");
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
