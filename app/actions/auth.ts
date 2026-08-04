"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { loginSchema, changePinSchema } from "@/lib/validation";
import { phoneVariants } from "@/lib/phone";
import { DRIVER_PANEL_ENABLED } from "@/lib/tenant";
import {
  MAX_FAILURES,
  ATTEMPT_WINDOW_MS,
  lockMs,
  lockIdentifier,
} from "@/lib/login-lock";

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

// Brute-force throttle. After MAX_FAILURES failed logins for the same
// `${ip}|${phone}`, each further attempt is rejected for an escalating window,
// tracked in the login_attempts table (migration 012) — no external service.
// Combined with the 6-digit PIN keyspace this makes online guessing infeasible.
// Keying on ip|phone (not phone alone) avoids an attacker locking a real driver
// out from a different network.
//
// Eşikler ve kimlik biçimi lib/login-lock.ts'te — yönetici panelindeki "Giriş
// kilidini kaldır" düğmesi aynı sabitleri okuyor, ikinci bir kopya olmasın.

// A fixed valid bcrypt hash compared against when the phone is unknown or the
// account is inactive, so a failed login takes ~the same time regardless of
// which case it is. Closes timing-based account enumeration. Its plaintext is
// irrelevant — the compare is only there to burn equivalent CPU.
const DUMMY_PIN_HASH =
  "$2b$10$Qvy2kwozHmqx5Uv2kbISjuV0Dy00KwKR0mbfKIM7G/qiOqdcOFMgC";

// Telefon normalizasyonu lib/phone.ts'te — tek kaynak. Buradaki eski sürüm
// yalnız boşluk/tire/parantez siliyordu; kişi listesinden yapıştırılan Unicode
// yön işaretlerini (U+202A/U+202C) bırakıyordu ve iki şoför giriş yapamıyordu.

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Records a failed attempt and (re)arms the lock if the threshold is crossed.
 *
 * Kilidi KURAN denemenin sonucunu da döner (`lockedUntil`): eskiden bu deneme
 * düz "hatalı PIN" cevabı alıyordu, kilit ancak BİR SONRAKİ denemede fark
 * ediliyordu. Kullanıcı için bu "PIN'i yanlış yazdım" ile "artık kilitliyim"
 * arasındaki farkı görünmez kılıyordu; sayaç da bir deneme geç başlıyordu.
 * Bilgi sızıntısı yok: kilit ip|phone üzerinde tutulur ve numara kayıtlı olsa
 * da olmasa da aynı şekilde kurulur.
 */
async function registerFailure(
  identifier: string
): Promise<{ attempts: number; lockedUntil: string | null }> {
  const { data: row } = await supabaseAdmin
    .from("login_attempts")
    .select("attempts, last_attempt_at")
    .eq("identifier", identifier)
    .maybeSingle();

  const now = Date.now();
  const stale =
    !!row?.last_attempt_at &&
    now - new Date(row.last_attempt_at).getTime() > ATTEMPT_WINDOW_MS;
  const attempts = (stale ? 0 : row?.attempts ?? 0) + 1;
  const nowIso = new Date(now).toISOString();
  const lockedUntil =
    attempts >= MAX_FAILURES
      ? new Date(now + lockMs(attempts)).toISOString()
      : null;

  await supabaseAdmin.from("login_attempts").upsert(
    {
      identifier,
      attempts,
      last_attempt_at: nowIso,
      locked_until: lockedUntil,
    },
    { onConflict: "identifier" }
  );
  return { attempts, lockedUntil };
}

/** Başarısız denemenin istemciye dönen hâli: kilit kurulduysa geri sayımla. */
function failureState(res: {
  lockedUntil: string | null;
}): LoginState {
  if (!res.lockedUntil) return { error: "invalid" };
  const remainingMs = new Date(res.lockedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return { error: "invalid" };
  return {
    error: "locked",
    retryAfter: Math.ceil(remainingMs / 1000),
    lockedUntil: res.lockedUntil,
  };
}

async function clearFailures(identifier: string): Promise<void> {
  await supabaseAdmin.from("login_attempts").delete().eq("identifier", identifier);
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
  // Kilit sayacı kanonik numaraya bağlanır: aynı şoförün "+43660…" ve
  // "+430660…" yazımları tek bir sayaçta toplanır, ayrı ayrı hak kazanmaz.
  // Kimliğin biçimi lib/login-lock.ts'te — kilidi kaldıran yönetici eylemi
  // satırı aynı şekle göre buluyor.
  const identifier = lockIdentifier(await clientIp(), parsed.data.phone);

  // Locked out? Reject before any DB lookup or bcrypt work.
  const { data: gate } = await supabaseAdmin
    .from("login_attempts")
    .select("locked_until")
    .eq("identifier", identifier)
    .maybeSingle();
  if (gate?.locked_until) {
    const remainingMs = new Date(gate.locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return {
        error: "locked",
        retryAfter: Math.ceil(remainingMs / 1000),
        lockedUntil: gate.locked_until as string,
      };
    }
  }

  // Tek bir `eq` yerine varyant listesi: workers.phone alanında Avusturya
  // ulusal trunk sıfırı bazı kayıtlarda var ("+430660…"), bazılarında yok
  // ("+43660…"). Şoför hangisini yazarsa yazsın kaydı bulmalı. Varyantlar
  // birbirini dışlar (aynı numaranın iki yazımı), bu yüzden en fazla bir
  // kayıt döner; yine de savunmacı biçimde ilki alınır.
  const { data: matches, error } = await supabaseAdmin
    .from("workers")
    .select("id, name, phone, pin_hash, plate, is_admin, is_active, must_change_pin")
    .in("phone", phoneVariants(parsed.data.phone))
    .limit(2);

  if (error) return { error: "db" };
  const worker = matches?.[0] ?? null;

  // Always run exactly one bcrypt compare — against the real hash, or a dummy
  // when the phone is unknown — so timing doesn't reveal whether the phone
  // exists. Unknown phone, inactive account and wrong PIN ALL return the same
  // generic "invalid": no account enumeration.
  const pinOk = await bcrypt.compare(
    parsed.data.pin,
    worker?.pin_hash ?? DUMMY_PIN_HASH
  );
  const authed = !!worker && worker.is_active && pinOk;

  if (!authed || !worker) {
    return failureState(await registerFailure(identifier));
  }

  // ŞOFÖR PANELİ KAPALI MÜŞTERİ (Sendigo): şoförün gideceği bir yer yok.
  // Kayıtları AZG/vardiya raporu için sistemde DURUR — takip araç ekseninde
  // yürür — ama panele giremezler. Hata mesajı bilerek diğerleriyle AYNI
  // ("invalid"): "bu telefon kayıtlı ama yetkisiz" demek hesap sayımına
  // (account enumeration) kapı açardı, yukarıdaki tüm tasarım bunu önlüyor.
  if (!DRIVER_PANEL_ENABLED && !worker.is_admin) {
    return failureState(await registerFailure(identifier));
  }

  await clearFailures(identifier);

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

  session.must_change_pin = false;
  await session.save();

  redirect(worker.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel");
}
