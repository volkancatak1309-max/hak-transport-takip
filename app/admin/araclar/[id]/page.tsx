import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireAdmin, effectiveViewerId } from "@/lib/session";
import { lookupDtc } from "@/lib/dtc-codes";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getVehicleDetail } from "@/lib/vehicles";
import {
  latestVehicleTelemetry,
  listActiveDtc,
  listVehicleEvents,
  listVehicleTrack,
} from "@/lib/telemetry";
import { computeEngineHours } from "@/lib/metrics-engine-hours";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { computeIdleTime } from "@/lib/metrics-idle";
import { computeGeofenceEvents } from "@/lib/metrics-geofence";
import { getActiveGeofences } from "@/app/actions/geofences";
import { startOfTodayVienna } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";
import { VehicleDetailClient } from "./VehicleDetailClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/araclar/[id]");
  const { id } = await params;
  // Engine-hours window: Vienna local midnight → now (today's runtime).
  const dayStart = startOfTodayVienna();
  const now = new Date();
  // Künye satırındaki "Düzenle" araç kaydı formunu açıyor; formun "Atanmış
  // şoför" seçimi bu listeyi ister. Liste sayfasındaki sorgunun aynısı:
  // pasifler de gelir (filtrelenirse yönetici atamayı temizlediğini sanıp
  // ex-çalışanı geri yazar).
  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // Patron kademesi (045) — katman kapalıysa boş kapsam, sorgu değişmez.
  const ownerScope = await getOwnerScope(effectiveViewerId(session));
  const [detail, telemetry, track, zones, events, dtc, driversResult] =
    await Promise.all([
      getVehicleDetail(id),
      latestVehicleTelemetry(id),
      listVehicleTrack(id, dayStart, now),
      getActiveGeofences(),
      listVehicleEvents(id, 10),
      listActiveDtc(id),
      // driver-scoped: araç detayındaki "Atanmış şoför" seçicisi — liste
      // sayfasıyla aynı gerekçe (bkz. app/admin/araclar/page.tsx).
      // owner-filtered: withoutOwner — aynı yerde, aynı gerekçe.
      withoutOwner(
        onlyDrivers(
          withoutTestRows(
            supabaseAdmin.from("workers").select("id, name, is_active").order("name"),
            "id",
            scope.workerIds
          ),
          "id",
          driverScope
        ),
        "id",
        ownerScope
      ),
    ]);
  if (!detail) notFound();
  const drivers = (driversResult.data ?? []) as {
    id: string;
    name: string;
    is_active: boolean;
  }[];
  // Same track feeds all device-GPS metrics (one query, pure computations).
  const engineHours = computeEngineHours(track);
  const distance = computeDistanceKm(track);
  const idle = computeIdleTime(track);
  // Depo bölgeleri (purpose='depot') KURAL değerlendirmesine GİRMEZ — yoksa araç
  // her depodan çıkışta sahte "ihlal" olayı üretirdi (Modül 3).
  const geofence = computeGeofenceEvents(
    track,
    zones.filter((z) => z.purpose !== "depot")
  );

  // DTC zenginleştirme SUNUCUDA: sözlük (lib/dtc-codes) client bundle'a girmez;
  // yalnız aktif kodların (~0-5 satır) yerelleştirilmiş 4 alanı prop'la iner.
  // Sözlükte olmayan kod → info:null → UI "üretici-spesifik" fallback metni.
  const locale = await getLocale();
  const dtcEnriched = dtc.map((d) => ({ ...d, info: lookupDtc(d.code, locale) }));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={detail.vehicle.plate}
    >
      <VehicleDetailClient
        detail={detail}
        telemetry={telemetry}
        engineHours={engineHours}
        distance={distance}
        idle={idle}
        geofence={geofence}
        events={events}
        dtc={dtcEnriched}
        drivers={drivers}
      />
    </DashboardShell>
  );
}
