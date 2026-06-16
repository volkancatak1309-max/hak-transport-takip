import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getExpenseEntries } from "@/app/actions/expenses";
import { ExpenseAdminClient } from "./ExpenseAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminExpensesPage() {
  const session = await requireAdmin();
  const entries = await getExpenseEntries({ withUrls: true });

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
        <ExpenseAdminClient entries={entries} />
      </div>
    </AppShell>
  );
}
