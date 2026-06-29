import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getGeofences } from "@/app/actions/geofences";
import { BolgelerClient } from "./BolgelerClient";

export const dynamic = "force-dynamic";

export default async function BolgelerPage() {
  const session = await requireAdmin();
  const zones = await getGeofences();
  const t = await getTranslations("zones");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("title")}
    >
      <BolgelerClient zones={zones} />
    </DashboardShell>
  );
}
