import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { audit } from "@/lib/security-log";
import { getBakimPanosu } from "@/app/actions/bakim";
import { BakimClient } from "./BakimClient";

export const dynamic = "force-dynamic";

/**
 * /admin/bakim — PERİYODİK BAKIM (migration 081).
 *
 * Kapı `requireFleetView`: aracı servise gönderen şef de kendi filosunun bakım
 * durumunu görmeli. Filo geneli plan AÇMAK ise yalnız patronun işi (bkz.
 * app/actions/bakim.ts) — şefin açtığı "tüm filo" kuralı kendi kapsamının
 * dışına da uygulanırdı.
 */
export default async function BakimPage() {
  const { session } = await requireFleetView();
  await audit(session.worker_id ?? null, "page_view", "/admin/bakim");

  const [pano, t] = await Promise.all([getBakimPanosu(), getTranslations("maintenance")]);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: Boolean(session.is_admin),
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <BakimClient
          planlar={pano.planlar}
          durumlar={pano.durumlar}
          araclar={pano.araclar}
          tabloYok={pano.tabloYok}
        />
      </div>
    </DashboardShell>
  );
}
