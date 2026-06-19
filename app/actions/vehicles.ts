"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";

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
