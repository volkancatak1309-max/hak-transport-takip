import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getVehicleDetail } from "@/lib/vehicles";
import { VehicleDetailClient } from "./VehicleDetailClient";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const detail = await getVehicleDetail(id);
  if (!detail) notFound();

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={detail.vehicle.plate}
    >
      <VehicleDetailClient detail={detail} />
    </DashboardShell>
  );
}
