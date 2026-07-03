import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listRecentEvents } from "@/lib/telemetry";
import { AlarmsClient } from "./AlarmsClient";

export const dynamic = "force-dynamic";

export default async function AlarmsPage() {
  const session = await requireAdmin();
  const events = await listRecentEvents(100);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
        <AlarmsClient events={events} />
      </div>
    </DashboardShell>
  );
}
