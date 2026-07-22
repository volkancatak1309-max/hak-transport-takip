import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { redirect } from "next/navigation";
import type { SessionData, VehicleFleet } from "./types";
import { getManagedFleet } from "./fleet-scope";

const password = process.env.SESSION_PASSWORD;
if (!password || password.length < 32) {
  throw new Error("SESSION_PASSWORD .env.local içinde tanımlı ve en az 32 karakter olmalı.");
}

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "hak_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireWorker() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  if (!session.is_admin) redirect("/panel");
  return session;
}

/**
 * FİLO GÖRÜNÜMÜ KAPISI (migration 029) — /admin ve /admin/harita için.
 *
 * requireAdmin()'den farkı: patronun YANINDA filo şefini de içeri alır, ama
 * ona bir KAPSAM döndürür. Dönen `fleet`:
 *   • null  → patron, kısıt yok
 *   • dolu  → yalnız o filonun verisi
 *
 * Bu kapı SADECE iki sayfada kullanılır. Diğer 17 yönetici sayfası ve tüm
 * yazma action'ları requireAdmin() ile korunmaya devam eder, yani filo şefi
 * oralara URL'den de giremez ve hiçbir şey yazamaz — koruma eklemeyle değil,
 * DOKUNMAMAKLA sağlanır (fail-closed). Yarın eklenecek yeni bir yönetici
 * sayfası da varsayılan olarak şefe kapalı olur.
 *
 * Rol ÇEREZDEN OKUNMAZ, her istekte DB'den gelir (bkz. lib/fleet-scope.ts):
 * oturum çerezi 30 gün yaşıyor, yetki kaldırıldığında hemen etkili olmalı.
 */
export async function requireFleetView() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  if (session.is_admin) {
    return { session, fleet: null as VehicleFleet | null, isChief: false };
  }
  const fleet = await getManagedFleet(session.worker_id);
  // Ne patron ne şef → kendi paneline.
  if (!fleet) redirect("/panel");
  return { session, fleet, isChief: true };
}

/**
 * Guard for the forced PIN-change screen (/pin) ONLY. Requires an authenticated
 * session but deliberately does NOT redirect when must_change_pin is set — that
 * would loop, since /pin is where the flag gets cleared. If the flag is already
 * clear the user has no business here, so send them to their home surface.
 */
export async function requirePinChange() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (!session.must_change_pin) redirect(session.is_admin ? "/admin" : "/panel");
  return session;
}
