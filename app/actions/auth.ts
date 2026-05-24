"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";

export type LoginState = { error?: "invalid" | "inactive" | "db" | "validation" };

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get("phone"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return { error: "validation" };
  const phone = normalizePhone(parsed.data.phone);

  const { data: worker, error } = await supabaseAdmin
    .from("workers")
    .select("id, name, phone, pin_hash, plate, is_admin, is_active")
    .eq("phone", phone)
    .maybeSingle();

  if (error) return { error: "db" };
  if (!worker) return { error: "invalid" };
  if (!worker.is_active) return { error: "inactive" };

  const ok = await bcrypt.compare(parsed.data.pin, worker.pin_hash);
  if (!ok) return { error: "invalid" };

  const session = await getSession();
  session.worker_id = worker.id;
  session.name = worker.name;
  session.is_admin = worker.is_admin;
  session.plate = worker.plate;
  await session.save();

  redirect(worker.is_admin ? "/admin" : "/panel");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/");
}
