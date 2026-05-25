import { requireWorker } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getExpenseEntries } from "@/app/actions/expenses";
import { ExpenseDriverClient } from "./ExpenseDriverClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const session = await requireWorker();
  const entries = await getExpenseEntries({ mine: true });

  return (
    <AppShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !!session.is_admin,
      }}
    >
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6">
        <ExpenseDriverClient entries={entries} />
      </div>
    </AppShell>
  );
}
