"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { vehicleSchema } from "@/lib/validation";
import { ACTIVE_FLEETS } from "@/lib/tenant";
import type { Vehicle } from "@/lib/types";
import { auditChange } from "@/lib/audit-change";
import { aracGuncelle, aracOlustur, type AracYama } from "@/lib/vehicle-update";

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

/*
 * ── `applyDriverAssignment` · `conflictPlate` · `checkVehicleConflicts` ·
 *    `assertDriverAssignable` ARTIK `lib/vehicle-update.ts`TE (19.09.2026) ──
 *
 * Dördü de mobil `PATCH /api/mobile/vehicles/[id]` ucunun da uymak zorunda
 * olduğu kurallardı ve action gövdesinde oturdukları sürece oradan
 * ÇAĞRILAMIYORLARDI (`"use server"` + `requireAdmin()` çerez ister). Kopyalamak
 * ikinci bir tekillik kuralı, ikinci bir şoför-ataması aynası demekti: aynı
 * plaka panelde reddedilirken telefonda kabul edilirdi.
 *
 * Aşağıdaki iki action artık yalnız KAPI + FORM ÇÖZÜMÜ: yetkiyi denetler,
 * FormData'yı alan kümesine çevirir, çekirdeği çağırır, yolları tazeler.
 */

export async function createVehicle(
  formData: FormData
): Promise<VehicleActionResult> {
  const session = await requireAdmin();
  const parsed = parseVehicle(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const d = parsed.data;

  /**
   * FORM BÜTÜN ALANLARI GÖNDERİR — bu yüzden hepsi AÇIKÇA geçiliyor.
   *
   * Çekirdek kısmi çalışıyor (`undefined` = dokunma) ama panelin davranışı
   * DEĞİŞMEDİ: boş bırakılan bir alan burada `null` olarak geçer, yani eskisi
   * gibi gerçekten boşaltılır. Kısmi olan MOBİL uçtur, panel formu değil.
   */
  const r = await aracOlustur({
    actorId: session.worker_id ?? null,
    alanlar: {
      plate: d.plate,
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
    },
  });
  if (!r.ok) return r;

  revalidatePath("/admin/araclar");
  revalidatePath("/admin/workers");
  revalidatePath("/panel");
  return { ok: true, id: r.id };
}

export async function updateVehicle(
  formData: FormData
): Promise<VehicleActionResult> {
  const session = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "id" };
  const parsed = parseVehicle(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const d = parsed.data;

  /**
   * ⚠️ ATAMA ALANI YALNIZ GERÇEKTEN DEĞİŞTİYSE GÖNDERİLİR.
   *
   * Form açıldığındaki değeri (`assigned_worker_id_prev`) geri gönderiyoruz:
   * aksi hâlde muayene tarihini düzeltmek için dakikalar önce açılmış bir
   * dialog kaydedildiğinde, bu arada başka bir yöneticinin yaptığı şoför
   * değişikliği sessizce geri alınırdı (lost update).
   *
   * Çekirdekte "atama dokunuldu mu" sorusunun karşılığı ALANIN VARLIĞI; burada
   * alan bilerek DIŞARIDA bırakılıyor. Eski kodda aynı kararı `assignmentTouched`
   * bayrağı veriyordu — davranış birebir aynı.
   */
  const prevRaw = formData.get("assigned_worker_id_prev");
  const prevFromForm = typeof prevRaw === "string" && prevRaw ? prevRaw : null;
  const nextWorkerId = d.assigned_worker_id ?? null;

  const yama: AracYama = {
    plate: d.plate,
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
  if (prevFromForm !== nextWorkerId) yama.assigned_worker_id = nextWorkerId;

  const r = await aracGuncelle({ actorId: session.worker_id ?? null, id, yama });
  if (!r.ok) return r;

  revalidatePath("/admin/araclar");
  revalidatePath("/admin/workers");
  revalidatePath("/panel");
  return { ok: true, id: r.id };
}

export async function deleteVehicle(id: string): Promise<VehicleActionResult> {
  const session = await requireAdmin();
  if (!id) return { ok: false, error: "id" };
  const { data: once } = await supabaseAdmin
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabaseAdmin.from("vehicles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "delete", "vehicles", id,
    once as Record<string, unknown> | null, null);
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
