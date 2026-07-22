"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope } from "@/lib/test-data";
import { requireAdmin } from "@/lib/session";
import { createMaintenanceSchema } from "@/lib/validation";
import { uploadReceipt, signedReceiptUrl, signedReceiptUrls } from "@/lib/storage";
import { sendTelegramMessage, type InlineButton } from "@/lib/telegram";
import type { VehicleMaintenance, MaintenanceType } from "@/lib/types";

const BUCKET = "maintenance-receipts";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://hak-transport-takip.vercel.app";

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
 */
export async function triggerMaintenanceReminder(
  plate: string,
  currentKm: number
): Promise<void> {
  const { data: m } = await supabaseAdmin
    .from("vehicle_maintenance")
    .select("next_service_km")
    .eq("vehicle_plate", plate)
    .not("next_service_km", "is", null)
    .order("serviced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextKm = (m?.next_service_km as number | null) ?? null;
  if (!nextKm) return;

  const threshold = nextKm - 1000;
  const { data: prev } = await supabaseAdmin
    .from("fuel_entries")
    .select("odometer_km")
    .eq("vehicle_plate", plate)
    .lt("odometer_km", currentKm)
    .order("odometer_km", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevKm = (prev?.odometer_km as number | null) ?? 0;

  // Only fire on the entry that crosses the threshold.
  if (!(prevKm < threshold && currentKm >= threshold)) return;

  const scope = await getTestScope();
  if (scope.isTestPlate(plate)) return;
  // test-visible: alıcı listesi (is_admin) — özne yukarıda elendi.
  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);
  for (const a of admins ?? []) {
    const locale = (a.telegram_locale as string) === "de" ? "de" : "tr";
    const t = await getTranslations({ locale, namespace: "maintenance" });
    const text = `🔧 ${t("tg_reminder", { plate, current: currentKm, next: nextKm })}`;
    const kb: InlineButton[][] = [[{ text: t("tg_btn_panel"), url: `${APP_URL}/admin/yakit` }]];
    await sendTelegramMessage(a.telegram_chat_id as string, text, null, kb);
  }
}
