import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getAssignments } from "@/app/actions/assignments";
import { AdminAssignmentsClient } from "./AdminAssignmentsClient";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const session = await requireAdmin();

  const assignments = await getAssignments();

  const { data: workers } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const workerOpts = (workers ?? []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
  }));

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
        <AdminAssignmentsClient assignments={assignments} workers={workerOpts} />
      </div>
    </DashboardShell>
  );
}
