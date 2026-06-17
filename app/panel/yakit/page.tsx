import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getFuelEntries } from "@/app/actions/fuel";
import { FuelDriverClient } from "./FuelDriverClient";
import { FUEL_ENABLED } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function FuelPage() {
  if (!FUEL_ENABLED) redirect("/panel");
  const session = await requireWorker();
  const entries = await getFuelEntries({ mine: true });

  const { data: te } = await supabaseAdmin
    .from("time_entries")
    .select("plate")
    .eq("worker_id", session.worker_id!)
    .not("plate", "is", null);
  const plates = [
    ...new Set([
      ...(session.plate ? [session.plate] : []),
      ...((te ?? []).map((r) => r.plate as string).filter(Boolean)),
    ]),
  ];

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !!session.is_admin,
      }}
    >
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6">
        <FuelDriverClient plates={plates} entries={entries} />
      </div>
    </DashboardShell>
  );
}
