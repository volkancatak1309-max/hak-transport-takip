import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
  IDLE_TRIGGER_S,
} from "@/lib/telemetry";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
} from "@/lib/format";
import { AlarmsClient, type AlarmRow } from "./AlarmsClient";

export const dynamic = "force-dynamic";

export type AlarmRange = "today" | "7d" | "30d";

function computeRange(range: AlarmRange): { start: Date; end: Date } {
  const end = endOfTodayVienna();
  if (range === "today") return { start: startOfTodayVienna(), end };
  const days = range === "30d" ? 29 : 6;
  return { start: addCalendarDaysVienna(startOfTodayVienna(), -days), end };
}

export default async function AlarmsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const range = (["today", "7d", "30d"].includes(sp.range ?? "")
    ? sp.range
    : "7d") as AlarmRange;
  const { start, end } = computeRange(range);
  // Nokta-olaylar (vehicle_events — artık idling YOK) + rölanti EPİZODLARI
  // (idle_episodes, migration 024). İkisi tek listeye birleşir; idling satırları
  // epizoddan gelir (süre taşır), diğerleri olduğu gibi.
  const [events, episodes] = await Promise.all([
    listEventsInRange(start.toISOString(), end.toISOString()),
    listIdleEpisodesInRange(start.toISOString(), end.toISOString()),
  ]);

  // Epizod → alarm satırı. Süre = ham span (ended veya son görülme − başlangıç)
  // + IDLE_TRIGGER_S (flespi'den 11205 okunamadığı için şu an 0 = ham span).
  // ongoing: ended_at NULL → "devam ediyor".
  const idleRows: AlarmRow[] = episodes.map((e) => {
    const startMs = new Date(e.started_at).getTime();
    const endMs = new Date(e.ended_at ?? e.last_seen_at).getTime();
    const duration_ms = Math.max(0, endMs - startMs) + IDLE_TRIGGER_S * 1000;
    return {
      id: e.id,
      vehicle_id: e.vehicle_id,
      event_type: "idling",
      event_value: null,
      latitude: e.latitude,
      longitude: e.longitude,
      speed_kmh: 0,
      occurred_at: e.started_at,
      plate: e.plate,
      duration_ms,
      ongoing: e.ended_at === null,
    };
  });

  const rows: AlarmRow[] = [...events, ...idleRows].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <AlarmsClient events={rows} range={range} />
      </div>
    </DashboardShell>
  );
}
