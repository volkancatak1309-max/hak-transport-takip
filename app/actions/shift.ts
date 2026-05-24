"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { startShiftSchema, endShiftSchema } from "@/lib/validation";

export type ShiftResult = { ok: boolean; error?: string };

export async function startShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  const parsed = startShiftSchema.safeParse({
    start_km: formData.get("start_km"),
    plate: formData.get("plate") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz veri" };
  }

  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();

  if (active) {
    return { ok: false, error: "Zaten aktif bir vardiyanız var" };
  }

  const { error } = await supabaseAdmin.from("time_entries").insert({
    worker_id: session.worker_id!,
    started_at: new Date().toISOString(),
    start_km: parsed.data.start_km,
    plate: parsed.data.plate ?? session.plate ?? null,
  });

  if (error) return { ok: false, error: "Vardiya başlatılamadı: " + error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

export async function endShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  const parsed = endShiftSchema.safeParse({
    end_km: formData.get("end_km"),
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz veri" };
  }

  const { data: active, error: findErr } = await supabaseAdmin
    .from("time_entries")
    .select("id, start_km")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) return { ok: false, error: "Veritabanı hatası" };
  if (!active) return { ok: false, error: "Aktif vardiya bulunamadı" };

  if (parsed.data.end_km < active.start_km) {
    return {
      ok: false,
      error: `Bitiş km (${parsed.data.end_km}) başlangıç km'sinden (${active.start_km}) küçük olamaz`,
    };
  }

  const updateData: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
    end_km: parsed.data.end_km,
    notes: parsed.data.notes,
  };
  if (parsed.data.plate) updateData.plate = parsed.data.plate;

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(updateData)
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);

  if (error) return { ok: false, error: "Vardiya kapatılamadı: " + error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}
