import { redirect } from "next/navigation";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, onlyFleet } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { LeaveCalendar, type CalLeave } from "@/components/admin/LeaveCalendar";
import { LEAVES_ENABLED } from "@/lib/features";
import { LEAVE_COLS, todayYmdVienna, type LeaveRow } from "@/lib/leaves";

export const dynamic = "force-dynamic";

/** month = "YYYY-MM" → o ayın ilk/son günü (YYYY-MM-DD). */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // monthIndex m, gün 0 = ay son günü
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export default async function IzinlerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!LEAVES_ENABLED) redirect("/admin");

  // Patron VE filo şefi girer (requireFleetView). Şef kendi filosunun izin
  // TALEBİNİ açar (pending); onay yalnız patronda. Diğer yönetici sayfaları
  // requireAdmin() ile korunmaya devam ediyor.
  const { session, fleet, isChief } = await requireFleetView();
  const fleetScope = await getFleetScope(fleet);
  const scope = await getTestScope();

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : todayYmdVienna().slice(0, 7);
  const { start, end } = monthBounds(month);

  const [workersRes, leavesRes] = await Promise.all([
    // Aktif, yönetici-olmayan personel (M2 terminated_at gelince "ayrılan gri"
    // kuralı buraya eklenecek). test + filo daraltması roster ile aynı eksende.
    onlyFleet(
      withoutTestRows(
        supabaseAdmin
          .from("workers")
          .select("id, name")
          .eq("is_active", true)
          .eq("is_admin", false)
          .order("name"),
        "id",
        scope.workerIds
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Ayı kesen izinler (reddedilenler hariç). Tablo yoksa data null → boş.
    onlyFleet(
      withoutTestRows(
        supabaseAdmin
          .from("worker_leaves")
          .select(LEAVE_COLS)
          .neq("status", "rejected")
          .lte("start_date", end)
          .gte("end_date", start),
        "worker_id",
        scope.workerIds
      ),
      "worker_id",
      fleetScope.workerIds,
      fleetScope
    ),
  ]);

  const workers = (workersRes.data ?? []) as { id: string; name: string }[];
  const leaves: CalLeave[] = ((leavesRes.data ?? []) as LeaveRow[]).map((l) => ({
    id: l.id,
    worker_id: l.worker_id,
    leave_type: l.leave_type,
    start_date: l.start_date,
    end_date: l.end_date,
    status: l.status,
    note: l.note,
  }));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !isChief,
        managedFleet: fleet,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <LeaveCalendar
          workers={workers}
          leaves={leaves}
          month={month}
          isChief={isChief}
        />
      </div>
    </DashboardShell>
  );
}
