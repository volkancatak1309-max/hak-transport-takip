import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { AraclarClient } from "./AraclarClient";

export const dynamic = "force-dynamic";

export default async function AraclarPage() {
  const session = await requireAdmin();
  const t = await getTranslations("vehicles");
  const vehicles = await listVehiclesWithStatus();

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
      <AraclarClient vehicles={vehicles} />
    </DashboardShell>
  );
}
