import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { getFuelEntries } from "@/app/actions/fuel";
import { FuelAdminClient } from "./FuelAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminFuelPage() {
  const session = await requireAdmin();
  const entries = await getFuelEntries();

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
      </div>
    </AppShell>
  );
}
