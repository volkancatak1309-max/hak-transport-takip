"use server";
import { auditChange } from "@/lib/audit-change";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { requireWorker, requireAdmin } from "@/lib/session";
import { createAssignmentSchema } from "@/lib/validation";

import type {
  Assignment,
  AssignmentWithWorker,
  AssignmentCategory,
  AssignmentStop,
} from "@/lib/types";

export type AssignmentInput = {
  worker_id: string;
  scheduled_at: string; // ISO
  category: AssignmentCategory;
  stops: AssignmentStop[];
  package_count?: number | null;
  notes?: string | null;
};

export type AssignmentActionResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

function revalidateAll() {
  revalidatePath("/admin/seferler");
  revalidatePath("/panel");
  revalidatePath("/panel/seferler");
}

/** Admin: create an assignment. */
export async function createAssignment(
  data: AssignmentInput
): Promise<AssignmentActionResult> {
  const session = await requireAdmin();

  const parsed = createAssignmentSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  // No assignments in the past (1-min grace for clock skew).
  if (new Date(parsed.data.scheduled_at).getTime() < Date.now() - 60_000) {
    return { ok: false, error: "past_date" };
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("assignments")
    .insert({
      worker_id: parsed.data.worker_id,
      scheduled_at: parsed.data.scheduled_at,
      category: parsed.data.category,
      stops: parsed.data.stops,
      package_count: parsed.data.package_count ?? 0,
      notes: parsed.data.notes ?? null,
      created_by: session.worker_id,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) return { ok: false, error: error?.message ?? "insert" };

  await auditChange(session.worker_id ?? null, "create", "assignments",
    inserted.id as string, null, parsed.data as Record<string, unknown>);

  revalidateAll();
  return { ok: true, id: inserted.id as string };
}

/** Admin: edit an existing assignment's details. */
export async function updateAssignment(
  id: string,
  data: AssignmentInput
): Promise<AssignmentActionResult> {
  const session = await requireAdmin();

  const parsed = createAssignmentSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  const { data: once } = await supabaseAdmin
    .from("assignments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      worker_id: parsed.data.worker_id,
      scheduled_at: parsed.data.scheduled_at,
      category: parsed.data.category,
      stops: parsed.data.stops,
      package_count: parsed.data.package_count ?? 0,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "update", "assignments", id,
    once as Record<string, unknown> | null, parsed.data as Record<string, unknown>);
  revalidateAll();
  return { ok: true, id };
}

/** Admin: cancel an assignment. */
export async function cancelAssignment(
  id: string,
  reason: string
): Promise<AssignmentActionResult> {
  const session = await requireAdmin();

  const { data: existing } = await supabaseAdmin
    .from("assignments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // İptal bir SİLME değil durum değişimi; yine de eski satırın tamamı elde
  // (yukarıdaki okuma bildirim için zaten yapılıyordu), sebebiyle birlikte.
  await auditChange(session.worker_id ?? null, "update", "assignments", id,
    existing as Record<string, unknown> | null,
    { status: "cancelled", cancel_reason: reason.trim() || null });

  // DIS BILDIRIM KATMANI SOKULDU (20.08.2026): iptal bilgisi sofore ayrica
  // bildiriliyordu. Iptalin KAYDI degismedi (status + cancel_reason + iz).

  revalidateAll();
  return { ok: true, id };
}

/**
 * Driver: mark own assignment started.
 *
 * Sayaç SORULMAZ (21.07.2026): şoför hiçbir yerde odometre girmez. Kilometre
 * araç telemetrisinden gelir; `assignments.start_km/end_km` kolonları geçmiş
 * veri için duruyor ama ARTIK YAZILMIYOR (kolonu silmek eski seferlerin
 * kaydını yok ederdi).
 */
export async function startAssignment(
  id: string
): Promise<AssignmentActionResult> {
  const session = await requireWorker();

  const { data: updated, error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "started",
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("worker_id", session.worker_id!)
    .eq("status", "assigned")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "not_allowed" };

  revalidateAll();
  return { ok: true, id };
}

/** Driver: mark own assignment completed. Sayaç sorulmaz — bkz. startAssignment. */
export async function completeAssignment(
  id: string
): Promise<AssignmentActionResult> {
  const session = await requireWorker();

  // .select() + satır sayısı kontrolü: km ön-sorgusu kalkınca "bu sefer bu
  // şoförün mü ve başlamış mı" kontrolü de onunla gitmişti. Eşleşen satır yoksa
  // sessiz başarı değil, not_allowed döner.
  const { data: updated, error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("worker_id", session.worker_id!)
    .eq("status", "started")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: "not_allowed" };

  revalidateAll();
  return { ok: true, id };
}

/**
 * Admins see every assignment; drivers (and admins with mine:true) see only
 * their own. Worker name/plate are joined in. Sorted by schedule ascending.
 */
export async function getAssignments(opts?: {
  mine?: boolean;
}): Promise<AssignmentWithWorker[]> {
  const session = await requireWorker();
  const seeAll = !!session.is_admin && !opts?.mine;

  // Sefer arşivi büyüdükçe 1000 satır tavanı eski kayıtları sessizce düşürür.
  const { data } = await fetchAllRows<Assignment>((from, to) => {
    let query = supabaseAdmin
      .from("assignments")
      .select("*")
      .order("scheduled_at", { ascending: true })
      .order("id");
    if (!seeAll) query = query.eq("worker_id", session.worker_id!);
    return query.range(from, to);
  });
  const rows = data;
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.worker_id))];
  const { data: ws } = await supabaseAdmin
    .from("workers")
    .select("id, name, plate")
    .in("id", ids);
  const wmap = new Map(
    (ws ?? []).map((w) => [
      w.id as string,
      { name: w.name as string, plate: (w.plate as string) ?? null },
    ])
  );

  return rows.map((r) => ({
    ...r,
    worker_name: wmap.get(r.worker_id)?.name ?? "—",
    worker_plate: wmap.get(r.worker_id)?.plate ?? null,
  }));
}
