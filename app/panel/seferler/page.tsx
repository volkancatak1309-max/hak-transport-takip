import { requireWorker } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getAssignments } from "@/app/actions/assignments";
import { CalendarClient } from "./CalendarClient";

export const dynamic = "force-dynamic";

export default async function MyAssignmentsCalendarPage() {
  const session = await requireWorker();
  const assignments = await getAssignments({ mine: true });

  return (
    <AppShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !!session.is_admin,
      }}
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
        <CalendarClient assignments={assignments} />
      </div>
    </AppShell>
  );
}
