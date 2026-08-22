import "server-only";
import { verifyMobileRequest, mobileError, type MobileWorker } from "@/lib/mobile-auth";
import { getManagedFleet, getFleetScope, UNRESTRICTED, type FleetScope } from "@/lib/fleet-scope";
import type { VehicleFleet } from "@/lib/types";

/**
 * MOBİL YETKİ KAPILARI — lib/session.ts'teki kapıların JSON dönen ikizleri.
 *
 * TEK FARK yönlendirme yerine veri döndürmeleridir. Kural kümesi BİREBİR aynı:
 *   requireMobileWorker    ↔ requireWorker()     — oturum var mı
 *   requireMobileAdmin     ↔ requireAdmin()      — is_admin
 *   requireMobileFleetView ↔ requireFleetView()  — patron VEYA filo şefi (+kapsam)
 *
 * Rol ÇEREZDEN/TOKEN'DAN OKUNMAZ. Katman 1'in ortak kapısı (verifyMobileRequest)
 * hesabı her istekte DB'den tazeliyor; şeflik de burada getManagedFleet ile
 * DB'den geliyor — token'a gömülü bir yetki iddiasına güvenilmiyor.
 *
 * PANEL PARİTESİ (bilerek): panelde filo şefinin GİREMEDİĞİ bir yüzey mobilde de
 * kapalıdır. /admin/araclar, /admin/alarmlar, /admin/workers requireAdmin() ile
 * korunuyor → mobil karşılıkları da 403 döner. Koruma eklemekle değil
 * DOKUNMAMAKLA sağlanan fail-closed düzeni burada da korunuyor.
 */

export type MobileActor = {
  worker: MobileWorker;
  /** Şefin filosu; patronda null (kısıt yok). */
  fleet: VehicleFleet | null;
  isChief: boolean;
  /** Sorgulara uygulanacak kapsam — patronda UNRESTRICTED. */
  fleetScope: FleetScope;
};

export type MobileGuard =
  | { ok: true; actor: MobileActor }
  | { ok: false; response: Response };

function deny(status: number, code: string): MobileGuard {
  return { ok: false, response: mobileError(status, code) };
}

/** Oturum yeter — kapsam hesaplanmaz (şoför kendi verisi için). */
export async function requireMobileWorker(req: Request): Promise<MobileGuard> {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return deny(auth.status, auth.code);
  return {
    ok: true,
    actor: { worker: auth.worker, fleet: null, isChief: false, fleetScope: UNRESTRICTED },
  };
}

/**
 * Oturum yeter AMA kapsam da çözülür — şef ise filosuyla, değilse kısıtsız
 * görünümle (şoför kendi verisine bakacağı için kapsam onu ilgilendirmez).
 *
 * `requireMobileWorker`'dan farkı: şeflik ve filo kapsamı hesaplanır.
 * `requireMobileFleetView`'dan farkı: şoförü REDDETMEZ.
 *
 * Neden ayrı bir kapı gerekti: mesajlaşma uçları ÜÇ rolü birden karşılıyor —
 * şoför kendi konuşmasına, şef kapsamındakilere, patron herkese. Mevcut iki
 * kapıdan biri şoförü kapıda çeviriyor, diğeri kapsamı hiç hesaplamıyordu.
 * Kapsamı ucun içinde çözmek, o mantığı her uca kopyalamak olurdu.
 *
 * ⚠️ Şoför için `fleetScope` UNRESTRICTED döner ve bu bir yetki DEĞİLDİR:
 * şoför yolunda kapsam hiç kullanılmaz, erişim kendi kimliğine anahtarlıdır
 * (lib/messaging.ts erisimCoz). Kapsamı şoför için "her şey" sanıp bir sorguya
 * vermek sızıntı olurdu — bu yüzden `isChief` bayrağı da dönüyor.
 */
export async function requireMobileWorkerScoped(req: Request): Promise<MobileGuard> {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return deny(auth.status, auth.code);

  if (auth.worker.is_admin) {
    return {
      ok: true,
      actor: { worker: auth.worker, fleet: null, isChief: false, fleetScope: UNRESTRICTED },
    };
  }
  const fleet = await getManagedFleet(auth.worker.id);
  if (!fleet) {
    // Şoför — kapsam yok, olmamalı da.
    return {
      ok: true,
      actor: { worker: auth.worker, fleet: null, isChief: false, fleetScope: UNRESTRICTED },
    };
  }
  const fleetScope = await getFleetScope(fleet);
  return { ok: true, actor: { worker: auth.worker, fleet, isChief: true, fleetScope } };
}

/** Yalnız patron. Şef ve şoför 403 alır (panelde /panel'e atılmalarının karşılığı). */
export async function requireMobileAdmin(req: Request): Promise<MobileGuard> {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return deny(auth.status, auth.code);
  if (!auth.worker.is_admin) return deny(403, "admin_required");
  return {
    ok: true,
    actor: { worker: auth.worker, fleet: null, isChief: false, fleetScope: UNRESTRICTED },
  };
}

/**
 * Patron VEYA filo şefi. Şefe kendi filosunun kapsamı döner.
 * Kapsam çözülemezse getFleetScope FAIL-CLOSED boş küme döndürür (lib/fleet-scope.ts) —
 * yani hata durumunda kısıtsıza DÜŞMEZ.
 */
export async function requireMobileFleetView(req: Request): Promise<MobileGuard> {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return deny(auth.status, auth.code);

  if (auth.worker.is_admin) {
    return {
      ok: true,
      actor: { worker: auth.worker, fleet: null, isChief: false, fleetScope: UNRESTRICTED },
    };
  }
  const fleet = await getManagedFleet(auth.worker.id);
  if (!fleet) return deny(403, "fleet_view_required");
  const fleetScope = await getFleetScope(fleet);
  return { ok: true, actor: { worker: auth.worker, fleet, isChief: true, fleetScope } };
}
