"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { createWorkerSchema } from "@/lib/validation";

export type WorkerResult = { ok: boolean; error?: string; newPin?: string };

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Next free 4-digit Personalnummer (0001, 0002, …) based on the current max. */
async function nextEmployeeNumber(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("workers")
    .select("employee_number")
    .not("employee_number", "is", null);
  const max = (data ?? []).reduce((m, w) => {
    const n = parseInt((w.employee_number as string) ?? "", 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1).padStart(4, "0");
}

export async function createWorkerAction(formData: FormData): Promise<WorkerResult> {
  await requireAdmin();

  const parsed = createWorkerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    pin: formData.get("pin"),
    plate: formData.get("plate") || null,
    employee_number: formData.get("employee_number") || null,
    is_admin: formData.get("is_admin") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz veri" };
  }

  const phone = normalizePhone(parsed.data.phone);

  const { data: existing } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return { ok: false, error: "Bu telefon zaten kayıtlı" };

  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);

  const employee_number =
    parsed.data.employee_number && parsed.data.employee_number.length > 0
      ? parsed.data.employee_number
      : await nextEmployeeNumber();

  const { error } = await supabaseAdmin.from("workers").insert({
    name: parsed.data.name,
    phone,
    pin_hash,
    plate: parsed.data.plate ?? null,
    employee_number,
    is_admin: parsed.data.is_admin ?? false,
    is_active: true,
  });

  if (error) return { ok: false, error: "Kayıt başarısız: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  return { ok: true };
}

export async function toggleActiveAction(workerId: string): Promise<WorkerResult> {
  await requireAdmin();

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("is_active")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, error: "Çalışan bulunamadı" };

  const { error } = await supabaseAdmin
    .from("workers")
    .update({ is_active: !worker.is_active })
    .eq("id", workerId);

  if (error) return { ok: false, error: "Güncelleme başarısız" };

  revalidatePath("/admin/workers");
  return { ok: true };
}

export async function resetPinAction(workerId: string): Promise<WorkerResult> {
  await requireAdmin();

  const newPin = randomPin();
  const pin_hash = await bcrypt.hash(newPin, 10);

  const { error } = await supabaseAdmin
    .from("workers")
    .update({ pin_hash })
    .eq("id", workerId);

  if (error) return { ok: false, error: "PIN güncellenemedi" };

  revalidatePath("/admin/workers");
  return { ok: true, newPin };
}
