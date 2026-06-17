import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getExpenseEntries } from "@/app/actions/expenses";
import { ExpenseAdminClient } from "./ExpenseAdminClient";
import { EXPENSE_ENABLED } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function AdminExpensesPage() {
  if (!EXPENSE_ENABLED) redirect("/admin");
  const session = await requireAdmin();
  const entries = await getExpenseEntries({ withUrls: true });

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
        <ExpenseAdminClient entries={entries} />
      </div>
    </DashboardShell>
  );
}
