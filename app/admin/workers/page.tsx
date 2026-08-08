import { requireAdmin, effectiveViewerId } from "@/lib/session";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { WorkersClient } from "./WorkersClient";
import { startOfMonthVienna, workedMs } from "@/lib/format";
import type { WorkerPublic, TimeEntry } from "@/lib/types";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export type WorkerWithStats = WorkerPublic & {
  lastShiftAt: string | null;
  monthHoursMs: number;
  /**
   * Şoförün atanmış aracının plakası. vehicles.assigned_worker_id üzerinden
   * TÜRETİLİR — workers.plate DEĞİL. Şoför paneli de aynı ilişkiye baktığı için
   * iki ekran artık aynı gerçeği gösterir.
   */
  assignedPlate: string | null;
};

export default async function WorkersPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/workers");

  const monthStart = startOfMonthVienna();

  type MonthEntry = Pick<
    TimeEntry,
    "worker_id" | "started_at" | "ended_at" | "break_minutes"
  >;
  // Aylık vardiyalar 26-28 araçta 1000 satır tavanına dayanır; "Bu Ay" saat
  // toplamları ve "Son Vardiya" eksik hesaplanmasın diye sonuna kadar okunur.
  const scope = await getTestScope();
  // Patron kademesi (045): is_owner OLMAYAN yöneticiye patron gösterilmez.
  // Katman kapalıysa boş kapsam → sorgu birebir bugünküyle aynı kalır.
  const ownerScope = await getOwnerScope(effectiveViewerId(session));
  const [workersResult, entriesResult, vehiclesResult] = await Promise.all([
    // test-filtered: withoutTestRows — Çalışanlar listesinin ana giriş noktası.
    // owner-filtered: withoutOwner — patron bu listede is_owner olmayana çıkmaz.
    withoutOwner(
      withoutTestRows(
        supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
        "id",
        scope.workerIds
      ),
      "id",
      ownerScope
    ),
    fetchAllRows<MonthEntry>((from, to) =>
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("worker_id, started_at, ended_at, break_minutes")
          .gte("started_at", monthStart.toISOString())
          .order("id"),
        "worker_id",
        scope.workerIds
      ).range(from, to)
    ),
    withoutTestRows(
      supabaseAdmin
        .from("vehicles")
        .select("plate, assigned_worker_id")
        .not("assigned_worker_id", "is", null)
        .neq("status", "inactive")
        .order("plate"),
      "id",
      scope.vehicleIds
    ),
  ]);

  const workers = (workersResult.data ?? []) as WorkerPublic[];
  const entries = entriesResult.data;

  // Plaka artık workers.plate serbest metninden değil, tek kaynak olan
  // vehicles.assigned_worker_id ilişkisinden gelir (şoför paneliyle aynı kural,
  // aynı sıralama: bir şoförde birden çok araç varsa plakaca ilk olanı).
  const plateByWorker = new Map<string, string>();
  for (const v of (vehiclesResult.data ?? []) as {
    plate: string;
    assigned_worker_id: string;
  }[]) {
    if (!plateByWorker.has(v.assigned_worker_id)) {
      plateByWorker.set(v.assigned_worker_id, v.plate);
    }
  }

  const stats: Record<string, { lastShiftAt: string | null; ms: number }> = {};
  for (const w of workers) stats[w.id] = { lastShiftAt: null, ms: 0 };

  for (const e of entries) {
    const s = stats[e.worker_id];
    if (!s) continue;
    s.ms += workedMs({
      started_at: e.started_at,
      ended_at: e.ended_at,
      break_minutes: e.break_minutes ?? 0,
    });
    if (!s.lastShiftAt || new Date(e.started_at) > new Date(s.lastShiftAt)) {
      s.lastShiftAt = e.started_at;
    }
  }

  const enriched: WorkerWithStats[] = workers.map((w) => ({
    ...w,
    lastShiftAt: stats[w.id].lastShiftAt,
    monthHoursMs: stats[w.id].ms,
    assignedPlate: plateByWorker.get(w.id) ?? null,
  }));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <WorkersClient workers={enriched} />
      </div>
    </DashboardShell>
  );
}
