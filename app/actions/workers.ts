"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { createWorkerSchema, isWeakPin, DEFAULT_TEMP_PIN } from "@/lib/validation";

export type WorkerResult = { ok: boolean; error?: string; newPin?: string };

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

/**
 * Cryptographically secure 6-digit reset PIN (leading zeros allowed). Re-rolls
 * on the rare weak draw (000000, 123456, …) so a generated temp PIN is never
 * one the strong pinSchema would itself reject.
 */
function randomPin(): string {
  let pin: string;
  do {
    pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  } while (isWeakPin(pin));
  return pin;
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

  // Saha standardı: PIN alanı boş bırakıldıysa geçici varsayılan (DEFAULT_TEMP_PIN
  // = 123456). Sunucu tek doğruluk kaynağı — istemci boşluğu doldurmasa da garanti
  // burada; must_change_pin=true zaten ilk girişte değişimi zorunlu kılıyor.
  const rawPin = (formData.get("pin") as string | null)?.trim();
  const pin = rawPin && rawPin.length > 0 ? rawPin : DEFAULT_TEMP_PIN;

  const parsed = createWorkerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    pin,
    plate: formData.get("plate") || null,
    employee_number: formData.get("employee_number") || null,
    is_admin: formData.get("is_admin") === "on",
    // Personel dosyası (migration 025) — boş string null'a düşer (opsiyonel).
    birth_date: formData.get("birth_date") || null,
    email: formData.get("email") || null,
    address: formData.get("address") || null,
    social_security_no: formData.get("social_security_no") || null,
    employment_start: formData.get("employment_start") || null,
    employment_type: formData.get("employment_type") || null,
    license_no: formData.get("license_no") || null,
    license_expiry: formData.get("license_expiry") || null,
    emergency_contact_name: formData.get("emergency_contact_name") || null,
    emergency_contact_relation: formData.get("emergency_contact_relation") || null,
    emergency_contact_phone: formData.get("emergency_contact_phone") || null,
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

  const d = parsed.data;
  const { error } = await supabaseAdmin.from("workers").insert({
    name: d.name,
    phone,
    pin_hash,
    plate: d.plate ?? null,
    employee_number,
    is_admin: d.is_admin ?? false,
    is_active: true,
    // Admin-set PIN is temporary — force the driver to set their own at /pin.
    must_change_pin: true,
    // Personel dosyası (migration 025).
    birth_date: d.birth_date ?? null,
    email: d.email ?? null,
    address: d.address ?? null,
    social_security_no: d.social_security_no ?? null,
    employment_start: d.employment_start ?? null,
    employment_type: d.employment_type ?? null,
    license_no: d.license_no ?? null,
    license_expiry: d.license_expiry ?? null,
    emergency_contact_name: d.emergency_contact_name ?? null,
    emergency_contact_relation: d.emergency_contact_relation ?? null,
    emergency_contact_phone: d.emergency_contact_phone ?? null,
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
    // Reset PIN is temporary — force the driver to set their own at next login.
    .update({ pin_hash, must_change_pin: true })
    .eq("id", workerId);

  if (error) return { ok: false, error: "PIN güncellenemedi" };

  revalidatePath("/admin/workers");
  return { ok: true, newPin };
}
