import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getFuelEntries } from "@/app/actions/fuel";
import { getMaintenance, getDueMaintenance } from "@/app/actions/maintenance";
import { FuelAdminClient } from "./FuelAdminClient";
import { MaintenanceAdminClient } from "./MaintenanceAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminFuelPage() {
  const session = await requireAdmin();
  const [entries, maint, due] = await Promise.all([
    getFuelEntries({ withUrls: true }),
    getMaintenance(),
    getDueMaintenance(),
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
        <FuelAdminClient entries={entries} />
        <MaintenanceAdminClient items={maint} dueIds={dueIds} plates={plates} />
      </div>
    </AppShell>
  );
}
