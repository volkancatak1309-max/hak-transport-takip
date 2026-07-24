"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { geofenceSchema } from "@/lib/validation";
import type { Geofence } from "@/lib/types";

export type GeofenceResultAction = { ok: boolean; error?: string; id?: string };

const COLS_BASE =
  "id, name, type, center_lat, center_lng, radius_m, rule_kind, active, created_at";
const COLS = COLS_BASE + ", purpose";

/**
 * Bölgeleri okur. `purpose` kolonu yoksa (migration 034 öncesi) base kolonlarla
 * DÜŞER ve purpose='rule' varsayar — Bölgeler sayfası ve metrics-geofence
 * kolon gelene kadar boşalmaz (migration-öncesi dayanıklılık deseni).
 */
async function selectZones(activeOnly: boolean): Promise<Geofence[]> {
  const q1 = supabaseAdmin.from("geofences").select(COLS);
  const { data, error } = await (activeOnly ? q1.eq("active", true) : q1).order(
    "created_at",
    { ascending: false }
  );
  if (!error && data) return data as unknown as Geofence[];
  const q2 = supabaseAdmin.from("geofences").select(COLS_BASE);
  const { data: d2 } = await (activeOnly ? q2.eq("active", true) : q2).order(
    "created_at",
    { ascending: false }
  );
  return ((d2 ?? []) as unknown as Omit<Geofence, "purpose">[]).map((z) => ({
    ...z,
    purpose: "rule" as const,
  }));
}

/** All zones (admin management list). */
export async function getGeofences(): Promise<Geofence[]> {
  await requireAdmin();
  return selectZones(false);
}

/** Active zones only — the set fed to computeGeofenceEvents. Degrades to an empty
 *  list if the table doesn't exist yet (migration 015 not run). */
export async function getActiveGeofences(): Promise<Geofence[]> {
  await requireAdmin();
  return selectZones(true);
}

function parse(formData: FormData) {
  return geofenceSchema.safeParse({
    name: formData.get("name"),
    center_lat: formData.get("center_lat"),
    center_lng: formData.get("center_lng"),
    radius_m: formData.get("radius_m"),
    rule_kind: formData.get("rule_kind"),
    purpose: formData.get("purpose") ?? undefined,
  });
}

export async function createGeofence(
  formData: FormData
): Promise<GeofenceResultAction> {
  await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .insert({
      name: parsed.data.name,
      type: "circle",
      center_lat: parsed.data.center_lat,
      center_lng: parsed.data.center_lng,
      radius_m: parsed.data.radius_m,
      rule_kind: parsed.data.rule_kind,
      purpose: parsed.data.purpose,
      active: true,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "insert" };
  revalidatePath("/admin/bolgeler");
  return { ok: true, id: data.id as string };
}

export async function updateGeofence(
  formData: FormData
): Promise<GeofenceResultAction> {
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "id" };
  const parsed = parse(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const { error } = await supabaseAdmin
    .from("geofences")
    .update({
      name: parsed.data.name,
      center_lat: parsed.data.center_lat,
      center_lng: parsed.data.center_lng,
      radius_m: parsed.data.radius_m,
      rule_kind: parsed.data.rule_kind,
      purpose: parsed.data.purpose,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}

export async function toggleGeofence(
  id: string,
  active: boolean
): Promise<GeofenceResultAction> {
  await requireAdmin();
  const { error } = await supabaseAdmin
    .from("geofences")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}

export async function deleteGeofence(id: string): Promise<GeofenceResultAction> {
  await requireAdmin();
  const { error } = await supabaseAdmin.from("geofences").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}
