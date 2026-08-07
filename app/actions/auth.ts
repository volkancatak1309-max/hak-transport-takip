"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { changePinSchema } from "@/lib/validation";
import { DRIVER_PANEL_ENABLED } from "@/lib/tenant";
import { verifyCredentials, clientIpFromHeaders } from "@/lib/auth-core";
import { bumpTokenVersion } from "@/lib/mobile-auth";

export type LoginState = {
  error?: "invalid" | "inactive" | "db" | "validation" | "locked";
  /** Seconds until the next attempt is allowed (only when error === "locked"). */
  retryAfter?: number;
  /**
   * Kilidin bitiş anı (ISO) — yalnız error === "locked" iken. İstemci geri
   * sayan sayacı bununla KİMLİKLENDİRİR: iki ayrı kilit olayının `retryAfter`
   * değeri tesadüfen aynı olabilir, `lockedUntil` olamaz. Sayacın süresi yine
   * retryAfter'dan (göreli saniye) kurulur — sunucu/istemci saat farkı geri
   * sayımı bozmasın diye mutlak zaman DEĞİL, kalan süre esas alınır.
   */
  lockedUntil?: string;
};

// Brute-force throttle, telefon normalizasyonu, zamanlama koruması ve kiracı
// kapısı artık lib/auth-core.ts'te — MOBİL GİRİŞ UCU (app/api/mobile/auth/login)
// aynı kuralı işletmek zorunda olduğu için tek kaynağa taşındı. Davranış
// değişmedi; buradaki akış aynı adımları aynı sırayla yaşıyor, yalnız gövdesi
// çekirdeğe devredildi. Eşikler ve kimlik biçimi lib/login-lock.ts'te.

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const res = await verifyCredentials({
    phone: formData.get("phone"),
    pin: formData.get("pin"),
    ip: clientIpFromHeaders(await headers()),
  });

  if (!res.ok) {
    if (res.reason === "locked") {
      return {
        error: "locked",
        retryAfter: res.retryAfter,
        lockedUntil: res.lockedUntil,
      };
    }
    return { error: res.reason };
  }
  const worker = res.worker;

  const session = await getSession();
  session.worker_id = worker.id;
  session.name = worker.name;
  session.phone = worker.phone;
  session.is_admin = worker.is_admin;
  session.plate = worker.plate;
  session.must_change_pin = !!worker.must_change_pin;
  await session.save();

  // A temp PIN (admin create / reset) must be changed before anything else —
  // requireWorker/requireAdmin enforce the same gate for every other route.
  if (worker.must_change_pin) redirect("/pin");
  redirect(worker.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/");
}

export type ChangePinState = {
  error?: "validation" | "weak" | "mismatch" | "same" | "db";
};

// Forced PIN change for a driver still on a temp PIN. Deliberately does NOT go
// through requireWorker() (that redirects to /pin on must_change_pin → loop);
// it validates the session itself. Clears the flag in the DB and the session
// on success, then sends the driver to their home surface.
export async function changePinAction(
  _prev: ChangePinState,
  formData: FormData
): Promise<ChangePinState> {
  const session = await getSession();
  if (!session.worker_id) redirect("/");

  const parsed = changePinSchema.safeParse({
    pin: formData.get("pin"),
    pin_confirm: formData.get("pin_confirm"),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    if (msg === "errPinWeak") return { error: "weak" };
    if (msg === "errPinMismatch") return { error: "mismatch" };
    return { error: "validation" };
  }

  const { data: worker, error: readErr } = await supabaseAdmin
    .from("workers")
    .select("pin_hash, is_admin")
    .eq("id", session.worker_id)
    .maybeSingle();
  if (readErr || !worker) return { error: "db" };

  // "Changing" to the same temp PIN would defeat the whole point — reject it.
  const sameAsOld = await bcrypt.compare(parsed.data.pin, worker.pin_hash);
  if (sameAsOld) return { error: "same" };

  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);
  const { error: updErr } = await supabaseAdmin
    .from("workers")
    .update({ pin_hash, must_change_pin: false })
    .eq("id", session.worker_id);
  if (updErr) return { error: "db" };

  // PIN değişti → eski PIN'le alınmış mobil token'lar ölmeli. Bu oturumun
  // KENDİ çerezi etkilenmez (aşağıda yenileniyor); yalnız mobil anahtarlar
  // düşer. Migration 044 çalışmamışsa sessizce no-op — tarayıcı akışı bundan
  // etkilenmez, kolon geldiğinde kendiliğinden devreye girer.
  await bumpTokenVersion(session.worker_id);

  session.must_change_pin = false;
  await session.save();

  redirect(worker.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel");
}
