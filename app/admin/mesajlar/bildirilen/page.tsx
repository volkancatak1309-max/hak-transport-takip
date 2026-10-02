import { getTranslations } from "next-intl/server";
import { requireAdmin, effectiveViewerId } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { bildirimlerAction } from "@/app/actions/messages";
import { audit } from "@/lib/security-log";
import { BildirilenClient } from "./BildirilenClient";

export const dynamic = "force-dynamic";

/**
 * /admin/mesajlar/bildirilen — BİLDİRİLEN MESAJLAR (migration 111).
 *
 * KAPI: `requireAdmin()` — YALNIZ yönetici. Şef ve şoför bu listeyi görmez
 * (kapı onları /panel'e atar); mobil karşılığı `GET /api/mobile/messages/
 * bildirimler` da `requireMobileAdmin`. Çekirdek tek: lib/mesaj-moderasyon.ts.
 *
 * Açık bildirimler sunucuda yükleniyor (ilk boya dolu); "Çözülen" sekmesi
 * istemciden aynı eylemle çekiliyor.
 */
export default async function BildirilenPage() {
  const session = await requireAdmin();
  const viewerId = effectiveViewerId(session) ?? session.worker_id!;

  await audit(viewerId, "page_view", "/admin/mesajlar/bildirilen");

  const ilk = await bildirimlerAction("open");
  const t = await getTranslations("messages");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        managedFleet: null,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("reportedTitle")}
    >
      <BildirilenClient
        ilk={ilk.ok ? ilk.data : { kayitlar: [], acikSayisi: null, kirpildi: false }}
        ilkHata={ilk.ok ? null : ilk.error}
      />
    </DashboardShell>
  );
}
