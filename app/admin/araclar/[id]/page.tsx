import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getVehicleDetail } from "@/lib/vehicles";
import { latestVehicleTelemetry, listVehicleTrack } from "@/lib/telemetry";
import { computeEngineHours } from "@/lib/metrics-engine-hours";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { computeIdleTime } from "@/lib/metrics-idle";
import { computeTripsAndStops } from "@/lib/metrics-trips";
import { computeGeofenceEvents } from "@/lib/metrics-geofence";
import { getActiveGeofences } from "@/app/actions/geofences";
import { startOfTodayVienna } from "@/lib/format";
import { VehicleDetailClient } from "./VehicleDetailClient";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  // Engine-hours window: Vienna local midnight → now (today's runtime).
  const dayStart = startOfTodayVienna();
  const now = new Date();
  const [detail, telemetry, track, zones] = await Promise.all([
    getVehicleDetail(id),
    latestVehicleTelemetry(id),
    listVehicleTrack(id, dayStart, now),
    getActiveGeofences(),
  ]);
  if (!detail) notFound();
  // Same track feeds all device-GPS metrics (one query, pure computations).
  const engineHours = computeEngineHours(track);
  const distance = computeDistanceKm(track);
  const idle = computeIdleTime(track);
  const tripStops = computeTripsAndStops(track);
  const geofence = computeGeofenceEvents(track, zones);

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
      <VehicleDetailClient
        detail={detail}
        telemetry={telemetry}
        engineHours={engineHours}
        distance={distance}
        idle={idle}
        tripStops={tripStops}
        geofence={geofence}
      />
    </DashboardShell>
  );
}
