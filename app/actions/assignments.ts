"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
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

/** Admin: create an assignment and (in the telegram layer) notify the driver. */
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

  revalidateAll();
  return { ok: true, id: inserted.id as string };
}

/** Admin: edit an existing assignment's details. */
export async function updateAssignment(
  id: string,
  data: AssignmentInput
): Promise<AssignmentActionResult> {
  await requireAdmin();

  const parsed = createAssignmentSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

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
  revalidateAll();
  return { ok: true, id };
}

/** Admin: cancel an assignment (telegram layer notifies the driver). */
export async function cancelAssignment(
  id: string,
  reason: string
): Promise<AssignmentActionResult> {
  await requireAdmin();

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true, id };
}

/** Driver: mark own assignment started with the start odometer reading. */
export async function startAssignment(
  id: string,
  startKm: number
): Promise<AssignmentActionResult> {
  const session = await requireWorker();
  const km = Math.floor(Number(startKm));
  if (!Number.isFinite(km) || km < 0) return { ok: false, error: "km" };

  const { data: updated, error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "started",
      start_km: km,
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

/** Driver: mark own assignment completed with the end odometer reading. */
export async function completeAssignment(
  id: string,
  endKm: number
): Promise<AssignmentActionResult> {
  const session = await requireWorker();
  const km = Math.floor(Number(endKm));
  if (!Number.isFinite(km) || km < 0) return { ok: false, error: "km" };

  const { data: existing } = await supabaseAdmin
    .from("assignments")
    .select("id, start_km")
    .eq("id", id)
    .eq("worker_id", session.worker_id!)
    .eq("status", "started")
    .maybeSingle();

  if (!existing) return { ok: false, error: "not_allowed" };
  if (existing.start_km != null && km < existing.start_km) {
    return { ok: false, error: `km_low:${km}:${existing.start_km}` };
  }

  const { error } = await supabaseAdmin
    .from("assignments")
    .update({
      status: "completed",
      end_km: km,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("worker_id", session.worker_id!)
    .eq("status", "started");

  if (error) return { ok: false, error: error.message };
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

  let query = supabaseAdmin
    .from("assignments")
    .select("*")
    .order("scheduled_at", { ascending: true });
  if (!seeAll) query = query.eq("worker_id", session.worker_id!);

  const { data } = await query;
  const rows = (data ?? []) as Assignment[];
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
