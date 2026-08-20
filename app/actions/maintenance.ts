"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { createMaintenanceSchema } from "@/lib/validation";
import { uploadReceipt, signedReceiptUrl, signedReceiptUrls } from "@/lib/storage";
import type { VehicleMaintenance, MaintenanceType } from "@/lib/types";

const BUCKET = "maintenance-receipts";


export type MaintenanceInput = {
  vehicle_plate: string;
  serviced_at: string;
  service_type: MaintenanceType;
  odometer_km: number;
  cost?: number | null;
  description?: string | null;
  next_service_km?: number | null;
  next_service_date?: string | null;
};

export type MaintenanceResult = { ok: boolean; error?: string; id?: string };

export async function createMaintenance(
  formData: FormData
): Promise<MaintenanceResult> {
  const session = await requireAdmin();
  const parsed = createMaintenanceSchema.safeParse({
    vehicle_plate: formData.get("vehicle_plate"),
    serviced_at: formData.get("serviced_at"),
    service_type: formData.get("service_type"),
    odometer_km: formData.get("odometer_km"),
    cost: formData.get("cost") || null,
    description: formData.get("description") || null,
    next_service_km: formData.get("next_service_km") || null,
    next_service_date: formData.get("next_service_date") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  // Receipt is optional for maintenance.
  let receipt_path: string | null = null;
  const file = formData.get("receipt") as File | null;
  if (file && file.size > 0) {
    const up = await uploadReceipt(BUCKET, session.worker_id!, file);
    if (!up.ok) return { ok: false, error: up.error };
    receipt_path = up.path;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("vehicle_maintenance")
    .insert({
      vehicle_plate: parsed.data.vehicle_plate.toUpperCase(),
      serviced_at: new Date(parsed.data.serviced_at).toISOString(),
      service_type: parsed.data.service_type,
      odometer_km: parsed.data.odometer_km,
      cost: parsed.data.cost ?? null,
      description: parsed.data.description ?? null,
      next_service_km: parsed.data.next_service_km ?? null,
      next_service_date: parsed.data.next_service_date
        ? new Date(parsed.data.next_service_date).toISOString()
        : null,
      receipt_path,
      created_by: session.worker_id,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) return { ok: false, error: error?.message ?? "insert" };
  revalidatePath("/admin/yakit");
  return { ok: true, id: inserted.id as string };
}

/** Signed URL for a maintenance receipt (admin only). */
export async function getMaintenanceReceiptUrl(id: string): Promise<string | null> {
  await requireAdmin();
  const { data } = await supabaseAdmin
    .from("vehicle_maintenance")
    .select("receipt_path")
    .eq("id", id)
    .maybeSingle();
  if (!data?.receipt_path) return null;
  return signedReceiptUrl(BUCKET, data.receipt_path as string);
}

export async function getMaintenance(): Promise<VehicleMaintenance[]> {
  await requireAdmin();
  const { data } = await supabaseAdmin
    .from("vehicle_maintenance")
    .select("*")
    .order("serviced_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as VehicleMaintenance[];
  if (rows.length === 0) return [];

  // Batch-sign receipt URLs once so the list can render thumbnails directly.
  const urlMap = await signedReceiptUrls(
    BUCKET,
    rows.map((r) => r.receipt_path).filter(Boolean) as string[]
  );

  return rows.map((r) => ({
    ...r,
    receipt_url: r.receipt_path ? urlMap.get(r.receipt_path) ?? null : null,
  }));
}

/** Services whose planned date is within 14 days or already past. */
export async function getDueMaintenance(): Promise<VehicleMaintenance[]> {
  await requireAdmin();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const { data } = await supabaseAdmin
    .from("vehicle_maintenance")
    .select("*")
    .not("next_service_date", "is", null)
    .lte("next_service_date", horizon.toISOString())
    .order("next_service_date", { ascending: true });
  return (data ?? []) as VehicleMaintenance[];
}

/**
 * Called after a fuel entry. If this entry crosses the (next_service_km - 1000)
 * threshold for its vehicle, nudge admins once. No cron, no extra flag —
 * "crossing" is detected by comparing against the previous fuel odometer.
 *
 * KAPI: requireWorker() — requireAdmin() DEĞİL, bilerek.
 *
 * Bu dosya "use server" ile işaretli, dolayısıyla buradaki HER export ağdan
 * çağrılabilir bir uçtur: Next build'i bu fonksiyona da kendi action ID'sini
 * verip hem /admin/yakit hem /panel/yakit route'una kaydediyor. Server action'lar
 * sayfa ve layout guard'larından ÖNCE koştuğu için /panel/yakit'in requireWorker()
 * kapısı bu ucu KORUMAZ — kapı fonksiyonun kendi başında olmak zorunda.
 * Kapısızken oturumsuz bir çağrı tüm yöneticilere bildirim düşürebiliyordu.
 *
 * Neden requireWorker: tek meşru çağıran createFuelEntry (app/actions/fuel.ts:133)
 * ve o da requireWorker() ile korunuyor — yani bu yol bir ŞOFÖR akışıdır.
 * requireAdmin() konsaydı şoför redirect("/panel") ile NEXT_REDIRECT'e çarpar,
 * yakıt fişi satırı yazılmış olduğu hâlde createFuelEntry başarı dönmeden kopardı.
 * requireWorker çağıranın gerçek yetki seviyesiyle birebir aynı; davranış korunur,
 * yalnız kimliksiz çağrı kapanır.
 */
