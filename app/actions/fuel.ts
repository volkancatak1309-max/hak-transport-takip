"use server";

import { revalidatePath } from "next/cache";
import { kume, topla, oranOlcekli } from "@/lib/oran-kume";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { requireWorker, requireAdmin } from "@/lib/session";
import { createFuelSchema } from "@/lib/validation";
import { uploadReceipt, signedReceiptUrl, signedReceiptUrls } from "@/lib/storage";
import { CO2_FACTORS, type CO2ReportData, type CO2Vehicle } from "@/lib/co2";
import type { FuelEntry, FuelEntryWithWorker, FuelType } from "@/lib/types";

const BUCKET = "fuel-receipts";

export type FuelResult = { ok: boolean; error?: string; id?: string };

function revalidateFuel() {
  revalidatePath("/panel/yakit");
  revalidatePath("/admin/yakit");
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
  /** Attach a short-lived signed receipt URL to each row (for thumbnails). */
  withUrls?: boolean;
}): Promise<FuelEntryWithWorker[]> {
  const session = await requireWorker();
  const seeAll = !!session.is_admin && !opts?.mine;

  // Yakıt arşivi 1000 satırı aşınca aylık istatistikler, L/100km zinciri ve
  // CO₂ raporu sessizce eksik hesaplanır; sonuna kadar sayfalanır.
  const { data } = await fetchAllRows<FuelEntry>((from, to) => {
    let query = supabaseAdmin
      .from("fuel_entries")
      .select("*")
      .order("fueled_at", { ascending: true })
      .order("id");
    if (!seeAll) query = query.eq("worker_id", session.worker_id!);
    return query.range(from, to);
  });
  const rows = data;
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.worker_id).filter(Boolean))] as string[];
  const { data: ws } = ids.length
    ? await supabaseAdmin.from("workers").select("id, name").in("id", ids)
    : { data: [] };
  const wmap = new Map((ws ?? []).map((w) => [w.id as string, w.name as string]));

  // Batch-sign receipt URLs once so the list can render thumbnails directly.
  const urlMap = opts?.withUrls
    ? await signedReceiptUrls(
        BUCKET,
        rows.map((r) => r.receipt_path).filter(Boolean) as string[]
      )
    : null;

  const withWorker: FuelEntryWithWorker[] = rows.map((r) => ({
    ...r,
    worker_name: r.worker_id ? wmap.get(r.worker_id) ?? "—" : "—",
    receipt_url: urlMap ? urlMap.get(r.receipt_path) ?? null : r.receipt_url,
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

export type CO2Result = { ok: true; data: CO2ReportData } | { ok: false };

/** Build a monthly CO₂ report from approved fuel entries (admin only). */
export async function generateCO2Report(month: string): Promise<CO2Result> {
  await requireAdmin();
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return { ok: false };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));

  type Row = { vehicle_plate: string; liters: number; odometer_km: number; fuel_type: FuelType };
  // CO₂ raporu müşteriye çıkar: 1000 satır tavanında sessiz kesinti olmaması
  // için sonuna kadar sayfalanır.
  const { data } = await fetchAllRows<Row>((from, to) =>
    supabaseAdmin
      .from("fuel_entries")
      .select("vehicle_plate, liters, odometer_km, fuel_type")
      .eq("status", "approved")
      .gte("fueled_at", start.toISOString())
      .lt("fueled_at", end.toISOString())
      .order("id")
      .range(from, to)
  );
  // fuel_entries araca vehicle_id ile DEĞİL, vehicle_plate TEXT'i ile bağlı
  // (FK yok) → eleme plaka üzerinden yapılmak zorunda.
  const scope = await getTestScope();
  const rows = dropTestRows(data, (r) => ({ plate: r.vehicle_plate }), scope);

  const byPlate = new Map<
    string,
    { liters: number; co2: number; minKm: number; maxKm: number }
  >();
  for (const r of rows) {
    const v = byPlate.get(r.vehicle_plate) ?? {
      liters: 0,
      co2: 0,
      minKm: r.odometer_km,
      maxKm: r.odometer_km,
    };
    v.liters += Number(r.liters);
    v.co2 += Number(r.liters) * (CO2_FACTORS[r.fuel_type] ?? CO2_FACTORS.diesel);
    v.minKm = Math.min(v.minKm, r.odometer_km);
    v.maxKm = Math.max(v.maxKm, r.odometer_km);
    byPlate.set(r.vehicle_plate, v);
  }

  const vehicles: CO2Vehicle[] = [...byPlate.entries()]
    .map(([plate, v]) => {
      const km = Math.max(0, v.maxKm - v.minKm);
      return {
        plate,
        liters: v.liters,
        km,
        lPer100: km > 0 ? (v.liters / km) * 100 : null,
        co2Kg: v.co2,
        gPerKm: km > 0 ? (v.co2 * 1000) / km : null,
      };
    })
    .sort((a, b) => b.co2Kg - a.co2Kg);

  const totalLiters = vehicles.reduce((s, v) => s + v.liters, 0);
  const totalCo2 = vehicles.reduce((s, v) => s + v.co2Kg, 0);
  const totalKm = vehicles.reduce((s, v) => s + v.km, 0);
  /**
   * 🔴 ORAN KÜMESİ: `avgGPerKm`in payı ve paydası AYNI araçlardan gelmeli.
   * `km = max(0, maxKm - minKm)` tek fişli araçta **0** olur; o araç CO₂'sini
   * paya ekleyip paydaya 0 eklerse oran şişer — `lib/co2-db.ts`teki kusurun
   * birebir aynısı. Ayrıntı: `docs/ORAN-KUME-KURALI.md`.
   */
  const oranK = kume("co2+km", vehicles.filter((v) => v.km > 0));

  return {
    ok: true,
    data: {
      monthLabel: month,
      generatedAt: new Date().toISOString(),
      totalLiters,
      totalCo2,
      totalKm,
      avgGPerKm: oranOlcekli(
        topla(oranK, (v) => v.co2Kg),
        topla(oranK, (v) => v.km),
        1000
      ),
      /** Oranın kaç araçtan geldiği — toplamlarınkiyle aynı olmak zorunda değil. */
      oranAracSayisi: oranK.ogeler.length,
      aracSayisi: vehicles.length,
      vehicles,
    },
  };
}
