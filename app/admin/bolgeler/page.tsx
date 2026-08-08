import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getGeofences } from "@/app/actions/geofences";
import { BolgelerClient } from "./BolgelerClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function BolgelerPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/bolgeler");
  const zones = await getGeofences();
  const t = await getTranslations("zones");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <BolgelerClient zones={zones} />
    </DashboardShell>
  );
}
