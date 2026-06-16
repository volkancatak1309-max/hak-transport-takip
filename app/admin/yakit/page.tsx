import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getFuelEntries } from "@/app/actions/fuel";
import { getMaintenance, getDueMaintenance } from "@/app/actions/maintenance";
import { FuelAdminClient } from "./FuelAdminClient";
import { MaintenanceAdminClient } from "./MaintenanceAdminClient";
import { FUEL_ENABLED, MAINTENANCE_ENABLED } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function AdminFuelPage() {
  if (!FUEL_ENABLED && !MAINTENANCE_ENABLED) redirect("/admin");
  const session = await requireAdmin();
  const [entries, maint, due] = await Promise.all([
    FUEL_ENABLED ? getFuelEntries({ withUrls: true }) : Promise.resolve([]),
    MAINTENANCE_ENABLED ? getMaintenance() : Promise.resolve([]),
    MAINTENANCE_ENABLED ? getDueMaintenance() : Promise.resolve([]),
  ]);
  const dueIds = due.map((d) => d.id);
  const plates = [
    ...new Set([
      ...entries.map((e) => e.vehicle_plate),
      ...maint.map((m) => m.vehicle_plate),
    ]),
  ];

  return (
    <AppShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
        {FUEL_ENABLED && <FuelAdminClient entries={entries} />}
        {MAINTENANCE_ENABLED && (
          <MaintenanceAdminClient items={maint} dueIds={dueIds} plates={plates} />
        )}
      </div>
    </AppShell>
  );
}
