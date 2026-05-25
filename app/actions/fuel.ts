"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import { createFuelSchema } from "@/lib/validation";
import { uploadReceipt, signedReceiptUrl } from "@/lib/storage";
import { sendTelegramMessage, type InlineButton } from "@/lib/telegram";
import { formatDate } from "@/lib/format";
import type { FuelEntry, FuelEntryWithWorker } from "@/lib/types";

const BUCKET = "fuel-receipts";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://hak-transport-takip.vercel.app";
const eur = (n: number) => n.toFixed(2).replace(".", ",");

export type FuelResult = { ok: boolean; error?: string; id?: string };

function revalidateFuel() {
  revalidatePath("/panel/yakit");
  revalidatePath("/admin/yakit");
}

/** Notify all linked admins that a new fuel entry is awaiting approval. */
async function notifyAdminsFuelSubmitted(p: {
  name: string;
  plate: string;
  liters: number;
  cost: number;
}): Promise<void> {
  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);
  for (const a of admins ?? []) {
    const locale = (a.telegram_locale as string) === "de" ? "de" : "tr";
    const t = await getTranslations({ locale, namespace: "fuel" });
    const text = [
      `🧾 ${t("tg_new")}`,
      `👤 ${p.name}`,
      `🚛 ${p.plate}`,
      `⛽ ${eur(p.liters)} L · ${eur(p.cost)} €`,
    ].join("\n");
    const kb: InlineButton[][] = [[{ text: t("tg_btn_approvals"), url: `${APP_URL}/admin/yakit` }]];
    await sendTelegramMessage(a.telegram_chat_id as string, text, null, kb);
  }
}

/** Notify the driver that their fuel entry was approved or rejected. */
async function notifyDriverFuelDecision(entryId: string, approved: boolean): Promise<void> {
  const { data: e } = await supabaseAdmin
    .from("fuel_entries")
    .select("worker_id, liters, total_cost, fueled_at, rejection_reason")
    .eq("id", entryId)
    .maybeSingle();
  if (!e?.worker_id) return;
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("id", e.worker_id)
    .maybeSingle();
  if (!w?.telegram_chat_id) return;

  const locale = (w.telegram_locale as string) === "de" ? "de" : "tr";
  const t = await getTranslations({ locale, namespace: "fuel" });
  const lines = [
    approved ? `✅ ${t("tg_approved")}` : `❌ ${t("tg_rejected")}`,
    `⛽ ${eur(Number(e.liters))} L · ${eur(Number(e.total_cost))} €`,
    `📅 ${formatDate(e.fueled_at as string, locale)}`,
  ];
  if (!approved && e.rejection_reason) lines.push(`${t("tg_reason")}: ${e.rejection_reason}`);
  const kb: InlineButton[][] = [[{ text: t("tg_btn_panel"), url: `${APP_URL}/panel/yakit` }]];
  await sendTelegramMessage(w.telegram_chat_id as string, lines.join("\n"), null, kb);
}

/** Driver or admin submits a fuel entry (pending approval) with a receipt photo. */
export async function createFuelEntry(formData: FormData): Promise<FuelResult> {
  const session = await requireWorker();

  const parsed = createFuelSchema.safeParse({
    vehicle_plate: formData.get("vehicle_plate"),
    fueled_at: formData.get("fueled_at"),
    liters: formData.get("liters"),
    total_cost: formData.get("total_cost"),
    odometer_km: formData.get("odometer_km"),
    fuel_type: formData.get("fuel_type"),
    station_name: formData.get("station_name") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const file = formData.get("receipt") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "receipt_required" };
  const up = await uploadReceipt(BUCKET, session.worker_id!, file);
  if (!up.ok) return { ok: false, error: up.error };

  const { data: inserted, error } = await supabaseAdmin
    .from("fuel_entries")
    .insert({
      worker_id: session.worker_id,
      vehicle_plate: parsed.data.vehicle_plate.toUpperCase(),
      fueled_at: new Date(parsed.data.fueled_at).toISOString(),
      liters: parsed.data.liters,
      total_cost: parsed.data.total_cost,
      odometer_km: parsed.data.odometer_km,
      fuel_type: parsed.data.fuel_type,
      station_name: parsed.data.station_name ?? null,
      notes: parsed.data.notes ?? null,
      receipt_path: up.path,
      created_by: session.worker_id,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) return { ok: false, error: error?.message ?? "insert" };

  await notifyAdminsFuelSubmitted({
    name: session.name ?? "—",
    plate: parsed.data.vehicle_plate.toUpperCase(),
    liters: parsed.data.liters,
    cost: parsed.data.total_cost,
  });

  revalidateFuel();
  return { ok: true, id: inserted.id as string };
}

export async function approveFuelEntry(id: string): Promise<FuelResult> {
  const session = await requireAdmin();
  const { data: rows, error } = await supabaseAdmin
    .from("fuel_entries")
    .update({
      status: "approved",
      approved_by: session.worker_id,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows || rows.length === 0) return { ok: false, error: "not_pending" };
  await notifyDriverFuelDecision(id, true);
  revalidateFuel();
  return { ok: true, id };
}

export async function rejectFuelEntry(id: string, reason: string): Promise<FuelResult> {
  const session = await requireAdmin();
  const { data: rows, error } = await supabaseAdmin
    .from("fuel_entries")
    .update({
      status: "rejected",
      approved_by: session.worker_id,
      approved_at: new Date().toISOString(),
      rejection_reason: reason.trim() || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows || rows.length === 0) return { ok: false, error: "not_pending" };
  await notifyDriverFuelDecision(id, false);
  revalidateFuel();
  return { ok: true, id };
}

/** Signed URL for a receipt; drivers may only open their own. */
export async function getFuelReceiptUrl(id: string): Promise<string | null> {
  const session = await requireWorker();
  const { data } = await supabaseAdmin
    .from("fuel_entries")
    .select("worker_id, receipt_path")
    .eq("id", id)
    .maybeSingle();
  if (!data?.receipt_path) return null;
  if (!session.is_admin && data.worker_id !== session.worker_id) return null;
  return signedReceiptUrl(BUCKET, data.receipt_path as string);
}

/**
 * Admins see all entries, drivers only their own. Adds the worker name and a
 * per-vehicle L/100km consumption (distance since the previous fill / litres).
 */
export async function getFuelEntries(opts?: {
  mine?: boolean;
}): Promise<FuelEntryWithWorker[]> {
  const session = await requireWorker();
  const seeAll = !!session.is_admin && !opts?.mine;

  let query = supabaseAdmin
    .from("fuel_entries")
    .select("*")
    .order("fueled_at", { ascending: true });
  if (!seeAll) query = query.eq("worker_id", session.worker_id!);

  const { data } = await query;
  const rows = (data ?? []) as FuelEntry[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.worker_id).filter(Boolean))] as string[];
  const { data: ws } = ids.length
    ? await supabaseAdmin.from("workers").select("id, name").in("id", ids)
    : { data: [] };
  const wmap = new Map((ws ?? []).map((w) => [w.id as string, w.name as string]));

  const withWorker: FuelEntryWithWorker[] = rows.map((r) => ({
    ...r,
    worker_name: r.worker_id ? wmap.get(r.worker_id) ?? "—" : "—",
    consumption: null,
  }));

  // L/100km per vehicle using consecutive fills (full-tank method).
  const byPlate = new Map<string, FuelEntryWithWorker[]>();
  for (const e of withWorker) {
    const arr = byPlate.get(e.vehicle_plate) ?? [];
    arr.push(e);
    byPlate.set(e.vehicle_plate, arr);
  }
  for (const arr of byPlate.values()) {
    for (let i = 1; i < arr.length; i++) {
      const dist = arr[i].odometer_km - arr[i - 1].odometer_km;
      if (dist > 0) arr[i].consumption = (arr[i].liters / dist) * 100;
    }
  }

  return withWorker.sort(
    (a, b) => new Date(b.fueled_at).getTime() - new Date(a.fueled_at).getTime()
  );
}
