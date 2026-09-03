import "server-only";
import { getManagedFleet, getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import type { FleetScope } from "@/lib/fleet-scope";

/**
 * MANUEL VARDİYA BAŞLATMA YETKİSİ — KURALIN TEK KAYNAĞI (037).
 *
 * ═══ NEDEN AYRI DOSYA ═════════════════════════════════════════════════════
 *
 * Kural `lib/session.ts:requireManualStartAuth` içinde yaşıyordu ve orada
 * OTURUM ÇEREZİNE bağlıydı. Mobil uç (`POST /api/mobile/shifts/start-for`)
 * aynı kapıyı işletmek zorunda ama kimliği `Authorization: Bearer` ile alıyor;
 * çerez yok. Kapıyı orada yeniden yazmak, "şef yalnız kendi filosu" kuralının
 * iki kopyasını üretirdi — ve fail-closed bir kuralın ikinci kopyası, ilk
 * değişiklikte sessizce fail-OPEN olabilecek bir kopyadır.
 *
 * Bu yüzden kural buraya indi ve KİMLİK ARTIK PARAMETRE: çağıran onu ister
 * çerezden (panel) ister token'dan (mobil) çözer. `lib/auth-core.ts`in
 * giriş için yaptığının aynısı.
 *
 * ── DEĞİŞMEYEN GÜVENCELER (taşınırken hiçbiri gevşetilmedi) ───────────────
 *  1) Rol + filo HER ÇAĞRIDA DB'den okunur (getManagedFleet), çerezden/token'dan
 *     DEĞİL: oturum 30 gün yaşıyor, yetki kaldırılınca hemen etkisiz olmalı.
 *  2) Şef YALNIZ kendi filosundaki hedef şoför için yetkili; kapsam dışıysa red.
 *  3) Kapsam çözülemezse getFleetScope BOŞ küme döner → isFleetWorker=false →
 *     red. Yani hata = KAPALI.
 *  4) Patron (is_admin) kısıtsız — kapsamı UNRESTRICTED.
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

/**
 * `actor` çağıranın ZATEN doğruladığı kimliktir; bu fonksiyon kimlik
 * doğrulamaz. `is_admin` bayrağı da çağırandan gelir — panelde oturumdan,
 * mobilde `verifyMobileRequest`in her istekte DB'den tazelediği kayıttan
 * (token'a gömülü `adm` iddiasından DEĞİL).
 */
export async function resolveManualStartAuth(
  actor: { id: string | null | undefined; name?: string | null; isAdmin: boolean },
  targetWorkerId: string
): Promise<ManualStartAuth> {
  if (!actor.id) return { ok: false, error: "unauthorized" };

  if (actor.isAdmin) {
    return {
      ok: true,
      actorId: actor.id,
      actorName: actor.name ?? "—",
      role: "admin",
      scope: UNRESTRICTED,
    };
  }

  const fleet = await getManagedFleet(actor.id);
  if (!fleet) return { ok: false, error: "unauthorized" };

  const scope = await getFleetScope(fleet);
  // Hedef şoför şefin kapsamında değilse (ya da kapsam boş kaldıysa) → red.
  if (!scope.isFleetWorker(targetWorkerId)) {
    return { ok: false, error: "out_of_scope" };
  }
  return {
    ok: true,
    actorId: actor.id,
    actorName: actor.name ?? "—",
    role: "chief",
    scope,
  };
}
