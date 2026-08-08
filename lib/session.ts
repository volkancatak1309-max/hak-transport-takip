import "server-only";
import { cookies, headers } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { redirect } from "next/navigation";
import type { SessionData, VehicleFleet } from "./types";
import {
  getManagedFleet,
  getFleetScope,
  UNRESTRICTED,
  type FleetScope,
} from "./fleet-scope";
import { supabaseAdmin } from "./supabase";
import { SECURITY_LAYER_ENABLED, ACCESS_GATES_ENABLED } from "./tenant";
import { cache } from "react";

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

/**
 * OTURUM DENETİMİ + CANLILIK (migration 045) — her korumalı kapının ilk işi.
 *
 * İki şey yapar:
 *   1. İPTAL: çerezdeki `session_version` DB'dekiyle uyuşmuyorsa oturum ölmüş
 *      (tek oturum kilidi ya da patronun "sonlandır" düğmesi). Çerez temizlenir
 *      ve giriş ekranına gidilir.
 *   2. CANLILIK: `login_sessions.last_seen_at` ileri taşınır. Bu olmadan
 *      "açık oturum" ile "canlı oturum" ayrımı yapılamaz ve çoklu-oturum
 *      işareti ilk girişten sonraki her girişte yanan bir gürültüye dönüşür
 *      (bkz. lib/security-log.ts → CANLI_PENCERE_MS).
 *
 * `SECURITY_LAYER_ENABLED` kapalıyken İLK SATIRDA çıkar: ek sorgu yok, ek
 * gecikme yok, davranış değişmez. HAK61 ve Sendigo bu dalın içine hiç girmez.
 *
 * Dinamik import bilinçli: security-log → mobile-auth → lib/session statik bir
 * döngü kurardı.
 */
async function enforceSessionVersion(session: Awaited<ReturnType<typeof getSession>>) {
  if (!SECURITY_LAYER_ENABLED || !session.worker_id) return;
  const { isSessionRevoked, touchLoginSession } = await import("@/lib/security-log");
  if (await isSessionRevoked(session.worker_id, session.session_version)) {
    session.destroy();
    redirect("/");
  }
  // İptal denetiminden SONRA: ölmüş bir oturumu canlı damgalamak yanlış olurdu.
  await touchLoginSession(session.login_session_id);
}

/**
 * ERİŞİM KAPILARI (migration 046) — her korumalı istekte yeniden değerlendirilir.
 *
 * Girişte bir kez bakmak YETMEZ: ölü adam anahtarı ve saat kilidi AÇIK
 * OTURUMU da düşürmek zorunda. Çerez 30 gün yaşıyor; kapıyı yalnız giriş
 * anında uygulasaydık, sabah giren biri gece yarısından sonra da içeride
 * kalırdı ve anahtar çekildiğinde hiçbir şey olmazdı.
 *
 * RED (anahtar/saat) → çerez yok edilir, giriş ekranına.
 * BEKLET (cihaz/ülke) → çerez korunur, /erisim ekranına.
 *
 * `ACCESS_GATES_ENABLED` kapalıyken İLK SATIRDA çıkar: HAK61 ve Sendigo bu
 * dalın içine hiç girmez, tek sorgu bile atılmaz.
 *
 * Dinamik import bilinçli: access-gates → kill-switch/owner-scope zinciri
 * lib/session'a geri döndüğü için statik bir döngü kurardı.
 */
async function enforceAccessGates(
  session: Awaited<ReturnType<typeof getSession>>
) {
  if (!ACCESS_GATES_ENABLED || !session.worker_id) return;
  const { evaluateAccess } = await import("@/lib/access-gates");
  const karar = await evaluateAccess(session.worker_id, await headers());

  if (karar.ok) {
    // Kapı açıldı (patron onayladı) → işaret temizlenir, kullanıcı normale döner.
    if (session.access_gate) {
      session.access_gate = undefined;
      await session.save();
    }
    return;
  }

  if (karar.mode === "reject") {
    session.destroy();
    redirect("/");
  }

  // Tip artık burada 'kill'/'hours' olamayacağını garanti ediyor (ayrık birleşim).
  if (session.access_gate !== karar.gate) {
    session.access_gate = karar.gate;
    await session.save();
  }
  redirect("/erisim");
}

export async function requireWorker() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  await enforceSessionVersion(session);
  await enforceAccessGates(session);
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  if (!session.is_admin) redirect("/panel");
  await enforceSessionVersion(session);
  await enforceAccessGates(session);
  return session;
}

/**
 * PATRON KAPISI (migration 045) — YALNIZ /admin/guvenlik için.
 *
 * requireAdmin()'den farkı: `workers.is_owner` şartı. Mevcut 19 yönetici
 * sayfası requireAdmin()'de KALDI ve bu fonksiyon oralara hiç girmiyor —
 * yani bu kapı kimsenin yetkisini daraltmaz, yalnız yeni ekranı kısıtlar.
 *
 * Yetki ÇEREZDEN OKUNMAZ, her çağrıda DB'den gelir (getManagedFleet deseninin
 * aynısı): oturum çerezi 30 gün yaşıyor, is_owner alındığında hemen etkili
 * olmalı. DB hatası / migration öncesi (kolon yok) → FAIL-CLOSED, /admin'e.
 */
export async function requireOwner() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (session.must_change_pin) redirect("/pin");
  if (!session.is_admin) redirect("/panel");
  await enforceSessionVersion(session);
  await enforceAccessGates(session);

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("is_owner")
    .eq("id", session.worker_id)
    .maybeSingle();
  // Kolon yok (045 çalışmamış) ya da hata → patron DEĞİL. Hata = KAPALI.
  if (error || data?.is_owner !== true) redirect("/admin");
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
  // İptal denetimi BURAYA DA gerekir: /admin ve /admin/harita bu kapıdan
  // geçiyor, yani bu satır olmadan patronun "oturumları sonlandır" düğmesi
  // panelin iki ana ekranında etkisiz kalırdı.
  await enforceSessionVersion(session);
  await enforceAccessGates(session);
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
  // Düşürülmüş bir oturum PIN ekranında da içeride sayılmamalı (045).
  await enforceSessionVersion(session);
  await enforceAccessGates(session);
  return session;
}

/**
 * Bu kişi patron mu? (migration 045) — istek başına TEK sorgu (React cache).
 *
 * Menüde /admin/guvenlik ögesini göstermek için kullanılır. Menü kozmetiktir:
 * sayfanın kendisi requireOwner() ile korunur, yani bu değer yanlış olsa bile
 * yetki aşılamaz. Kolon yoksa (045 öncesi) ya da hata varsa `false`.
 *
 * ⚠️ Katman kapalıyken SORGU ATMAZ. Bu şart olmadan /admin her açılışta
 * HAK61 ve Sendigo'da da `is_owner` okumaya çalışırdı — o kurulumlarda kolon
 * yok, yani sorgu HER SEFERİNDE hata dönerdi (yakalanıp yutulsa bile boşa
 * giden bir gidiş-dönüş). Katman kapalıysa gösterilecek ekran da yok.
 */
export const isOwnerCached = cache(async (workerId: string): Promise<boolean> => {
  if (!SECURITY_LAYER_ENABLED) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("is_owner")
      .eq("id", workerId)
      .maybeSingle();
    if (error || !data) return false;
    return data.is_owner === true;
  } catch {
    return false;
  }
});
