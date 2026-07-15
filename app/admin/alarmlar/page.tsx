import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listEventsInRange } from "@/lib/telemetry";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
} from "@/lib/format";
import { AlarmsClient } from "./AlarmsClient";

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
  const events = await listEventsInRange(start.toISOString(), end.toISOString());

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
        <AlarmsClient events={events} range={range} />
      </div>
    </DashboardShell>
  );
}
