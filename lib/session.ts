import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { redirect } from "next/navigation";
import type { SessionData, VehicleFleet } from "./types";
import {
  getManagedFleet,
  getFleetScope,
  UNRESTRICTED,
  type FleetScope,
} from "./fleet-scope";

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
 * MANUEL VARDİYA BAŞLATMA YETKİSİ (037) — YÖNETİCİ + FİLO ŞEFİ.
 *
 * Şef bir personelin mesaisini elle başlatabilsin diye açtığımız TEK yazma
 * yeteneği. Fail-closed'u DELMEDEN güvenli kılan kurallar:
 *
 *  1) Rol + filo HER ÇAĞRIDA DB'den okunur (getManagedFleet), çerezden DEĞİL:
 *     oturum çerezi 30 gün yaşıyor, yetki kaldırılınca hemen etkisiz olmalı.
 *  2) Şef YALNIZ kendi filosundaki hedef şoför için yetkili: kapsam dışıysa red.
 *  3) Kapsam çözülemezse (DB hatası / migration öncesi) getFleetScope BOŞ küme
 *     döner → isFleetWorker=false → red. Yani hata = KAPALI.
 *  4) Patron (is_admin) kısıtsız (herkes) — kapsamı UNRESTRICTED.
 *
 * Bu guard yalnız startShiftForWorkerAction'da kullanılır; başka hiçbir sayfa
 * ya da action'ı açmaz. UI'da butonu göstermek/gizlemek yalnız kozmetik; son
 * sözü BU kapı söyler (buton doğrudan çağrılıp yetki aşılamasın).
 */
export type ManualStartAuth =
  | {
      ok: true;
      actorId: string;
      actorName: string;
      role: "admin" | "chief";
      scope: FleetScope;
    }
  | { ok: false; error: "unauthorized" | "out_of_scope" };

export async function requireManualStartAuth(
  targetWorkerId: string
): Promise<ManualStartAuth> {
  const session = await getSession();
  if (!session.worker_id) return { ok: false, error: "unauthorized" };

  if (session.is_admin) {
    return {
      ok: true,
      actorId: session.worker_id,
      actorName: session.name ?? "—",
      role: "admin",
      scope: UNRESTRICTED,
    };
  }

  const fleet = await getManagedFleet(session.worker_id);
  if (!fleet) return { ok: false, error: "unauthorized" };

  const scope = await getFleetScope(fleet);
  // Hedef şoför şefin kapsamında değilse (ya da kapsam boş kaldıysa) → red.
  if (!scope.isFleetWorker(targetWorkerId)) {
    return { ok: false, error: "out_of_scope" };
  }
  return {
    ok: true,
    actorId: session.worker_id,
    actorName: session.name ?? "—",
    role: "chief",
    scope,
  };
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
