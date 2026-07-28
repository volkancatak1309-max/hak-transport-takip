import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, onlyFleet } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { LiveTrackingClient } from "./LiveTrackingClient";
import { listLatestVehiclePositions } from "@/lib/telemetry";
import { dailyCapMs, touchesNightWindow } from "@/lib/azg-rules";
import type { ActiveDriver } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Bu yaştan taze konum "canlı", daha eskisi "son bilinen" sayılır. */
const RECENT_MS = 10 * 60 * 1000;

type ShiftRow = {
  id: string;
  started_at: string;
  worker_id: string;
  vehicle_id: string | null;
};
type WorkerRow = { id: string; name: string; plate: string | null };

export default async function HaritaPage() {
  const { session, fleet, isChief } = await requireFleetView();
  const fleetScope = await getFleetScope(fleet);

  // 1) All active shifts (ended_at IS NULL)
  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // Test şoförünün açık vardiyası haritanın "Şoförler (N)" sekmesine düşmesin.
  //
  // driver-scoped: bu TEK sorgu altı ölçüyü birden besliyor — "Aktif Vardiya"
  // KPI'ı, "Şoförler (N)" sekmesi, yan panel listesi, "En Uzun Aktif", tavan
  // aşımı sayısı ve harita kartı başlığı. Yönetici hesabının kapanmamış bir
  // vardiyası burada kalırsa hepsi birden bozulur: otomatik kapanış KALDIRILDIĞI
  // için (bkz. 22.07.2026 kararı) böyle bir satır günlerce açık durur, "En Uzun
  // Aktif" saçma bir değere fırlar ve "Tavan aşımı" SAHTE AZG ihlali sayar.
  // Eleme burada, kaynak kümede yapılır — listede yapılırsa üst KPI ile sekme
  // sayısı birbirini tutmaz (bkz. satır 65-67'deki değişmez kural).
  const { data: shiftsData, error: shiftsErr } = await onlyFleet(
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("id, started_at, worker_id, vehicle_id")
          .is("ended_at", null),
        "worker_id",
        scope.workerIds
      ),
      "worker_id",
      driverScope
    ),
    // Şoför ekseni (kural 7): şoför ödünç araç kullansa da şefi onu görür.
    // Konumu ise aracın telemetrisinden gelir — o araç getFleetScope'ta
    // "bugün kullanılan" olarak kapsama eklenmiştir.
    "worker_id",
    fleetScope.workerIds,
    fleetScope
  );
  const shifts = (shiftsData ?? []) as ShiftRow[];

  const workerIds = [...new Set(shifts.map((s) => s.worker_id))];

  // 2) Worker info (separate query — avoids fragile embed joins)
  const { data: workersData, error: workersErr } = workerIds.length
    ? await supabaseAdmin.from("workers").select("id, name, plate").in("id", workerIds)
    : { data: [] as WorkerRow[], error: null };
  const workerMap = new Map((workersData ?? []).map((w) => [w.id, w as WorkerRow]));

  // 3) Şoförün konumu = SÜRDÜĞÜ ARACIN cihaz konumu.
  //    Telefon GPS'i (driver_locations) kaldırıldı — 21.07.2026. Konumun tek
  //    kaynağı FMC003. Şoför ile araç zaten vardiya satırında bağlı, dolayısıyla
  //    aracın son fix'i şoförün de konumudur; ayrı bir telefon hattına gerek yok.
  const vehicles = await listLatestVehiclePositions(fleetScope);
  const posByVehicle = new Map(vehicles.map((v) => [v.vehicle_id, v]));

  // Şoför listesi = AÇIK VARDİYA sayacıyla AYNI küme (shifts). Konum yoksa şoför
  // DÜŞMEZ; sadece durumu işaretlenir. Böylece üst kutu (Aktif Vardiya) ile
  // "Şoförler (N)" sekmesi her zaman tutarlı kalır.
  const nowForLoc = Date.now();
  const drivers: ActiveDriver[] = [];
  for (const s of shifts) {
    const w = workerMap.get(s.worker_id);
    const pos = s.vehicle_id ? posByVehicle.get(s.vehicle_id) ?? null : null;
    const ageMs = pos ? nowForLoc - new Date(pos.recorded_at).getTime() : null;
    const locStatus: ActiveDriver["locStatus"] =
      pos === null ? "waiting" : (ageMs as number) <= RECENT_MS ? "live" : "stale";
    drivers.push({
      worker_id: s.worker_id,
      name: w?.name ?? "—",
      plate: w?.plate ?? null,
      shift_started_at: s.started_at,
      time_entry_id: s.id,
      latitude: pos?.latitude ?? null,
      longitude: pos?.longitude ?? null,
      recorded_at: pos?.recorded_at ?? null,
      locStatus,
      // Şoför polyline'ı ARTIK YOK: telefon izi kalktı, araç izi zaten araç
      // katmanında ve rota tekrarı sayfasında. Alan tip uyumu için boş kalır.
      route: [],
    });
  }

  // Debug logging — kept in production to diagnose missing markers via Vercel logs
  console.log(
    `[harita] activeShifts=${shifts.length} workers=${workerMap.size} ` +
      `drivers=${drivers.length} vehicles=${vehicles.length}` +
      (shiftsErr ? ` shiftsErr=${shiftsErr.message}` : "") +
      (workersErr ? ` workersErr=${workersErr.message}` : "")
  );

  // Lightweight KPIs from the same data — no extra logic, demo-ready summary.
  // Yasal tavan (§ 9 Abs. 1 / gece § 14 Abs. 2) — 9 saat ihlal değil.
  const nowMs = Date.now();
  let longestMs = 0;
  let overLimit = 0;
  for (const s of shifts) {
    const ms = nowMs - new Date(s.started_at).getTime();
    if (ms > longestMs) longestMs = ms;
    if (ms > dailyCapMs(touchesNightWindow(s.started_at, null))) overLimit++;
  }

  const t = await getTranslations("map");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !isChief,
        managedFleet: fleet,
      }}
      title={t("live_title")}
    >
      <LiveTrackingClient
        drivers={drivers}
        vehicles={vehicles}
        summary={{
          activeShifts: shifts.length,
          longestMs,
          overLimit,
        }}
        serverNow={nowMs}
      />
    </DashboardShell>
  );
}
