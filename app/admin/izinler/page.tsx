import { redirect } from "next/navigation";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, onlyFleet } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  LeaveCalendar,
  type CalLeave,
  type ArchiveLeave,
} from "@/components/admin/LeaveCalendar";
import { LEAVES_ENABLED } from "@/lib/features";
import { LEAVE_COLS, todayYmdVienna, type LeaveRow } from "@/lib/leaves";

export const dynamic = "force-dynamic";

/**
 * Arşiv tavanı. Canlıda toplam izin sayısı iki haneli; 200 satır yıllarca yeter
 * ve tek sayfada (PostgREST 1000 tavanının altında) kalır. Dolarsa UI bunu
 * söyler — sessizce kırpmayız.
 */
const ARCHIVE_LIMIT = 200;

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
  const driverScope = await getDriverScope();

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : todayYmdVienna().slice(0, 7);
  const { start, end } = monthBounds(month);

  const [activeRes, formerRes, leavesRes, archiveRes] = await Promise.all([
    // Aktif kadro (terminated_at'ten BAĞIMSIZ — migration 032 gelmeden de çalışır).
    onlyFleet(
      // driver-scoped: eski `.eq("is_admin", false)` kaldırıldı — aynı kural
      // artık lib/driver-scope.ts'te TEK yerde yaşıyor. Davranış birebir aynı
      // (şefler is_admin=false, izin takviminde KALIRLAR); değişen tek şey,
      // kuralın kopyası olmaması.
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("workers")
            .select("id, name")
            .eq("is_active", true)
            .order("name"),
          "id",
          scope.workerIds
        ),
        "id",
        driverScope
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Görüntülenen ayda HÂLÂ görünmesi gereken AYRILAN personel: çıkışı ay
    // başından sonra olanlar (çıkış ayına kadar gri, sonraki aylarda düşer).
    // Best-effort: migration 032 gelmeden terminated_at kolonu yok → error →
    // boş; aktif kadro yine görünür (M1↔M2 birleşimi).
    onlyFleet(
      // driver-scoped: yukarıdakiyle aynı gerekçe (tek kaynak).
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("workers")
            .select("id, name, terminated_at")
            .not("terminated_at", "is", null)
            .gte("terminated_at", start)
            .order("name"),
          "id",
          scope.workerIds
        ),
        "id",
        driverScope
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Ayı kesen izinler (reddedilenler hariç). Tablo yoksa data null → boş.
    // driver-scoped: filtre İZNİ ALAN kişinin (worker_id) üstünde. Onaylayan
    // yönetici approved_by/created_by alanlarında yaşıyor ve ELENMİYOR —
    // "kim onayladı" bilgisi korunur.
    onlyDrivers(
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
      "worker_id",
      driverScope
    ),
    // ARŞİV (25.07.2026): karara BAĞLANMIŞ izinler — aya bağlı DEĞİL, tüm geçmiş.
    // Takvim ızgarası yalnız görüntülenen ayı ve reddedilmeyenleri gösteriyor;
    // "kim neyi ne zaman onayladı/reddetti" sorusunun cevabı hiçbir yerde
    // görünmüyordu. Reddedilenler de burada: kayıt iz için DURUYOR (silinmiyor).
    // ARCHIVE_LIMIT satırla sınırlı — dolarsa UI dipnot basar.
    // driver-scoped: yukarıdakiyle aynı — eleme İZNİ ALAN kişide, karar veren
    // yöneticinin adı arşivde KALIR (arşivin amacı zaten o izi tutmak).
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("worker_leaves")
            .select(LEAVE_COLS)
            .in("status", ["approved", "rejected"])
            .order("decided_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(ARCHIVE_LIMIT),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
  ]);

  const active = ((activeRes.data ?? []) as { id: string; name: string }[]).map(
    (w) => ({ id: w.id, name: w.name, terminated: false })
  );
  const former = (
    (formerRes.data ?? []) as { id: string; name: string; terminated_at: string | null }[]
  ).map((w) => ({ id: w.id, name: w.name, terminated: true }));
  const workers = [...active, ...former].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const leaves: CalLeave[] = ((leavesRes.data ?? []) as LeaveRow[]).map((l) => ({
    id: l.id,
    worker_id: l.worker_id,
    leave_type: l.leave_type,
    start_date: l.start_date,
    end_date: l.end_date,
    status: l.status,
    note: l.note,
  }));

  // ── ARŞİV SATIRLARI ────────────────────────────────────────────────────────
  // Kararı VEREN kişi çoğu zaman patrondur, yukarıdaki `workers` sorgusu ise
  // `is_admin=false` filtreliyor → o isimler haritada YOK. Eksik id'ler tek ek
  // sorguyla çözülür (manuel-başlatma bildiriminin deseni); çözülemezse '—'
  // basılır, satır DÜŞMEZ.
  const archiveRows = (archiveRes.data ?? []) as LeaveRow[];
  const nameById = new Map(workers.map((w) => [w.id, w.name]));
  const missingIds = [
    ...new Set(
      archiveRows
        .flatMap((l) => [l.approved_by, l.created_by])
        .filter((id): id is string => !!id && !nameById.has(id))
    ),
  ];
  if (missingIds.length > 0) {
    const { data: extra } = await supabaseAdmin
      .from("workers")
      .select("id, name")
      .in("id", missingIds);
    for (const w of (extra ?? []) as { id: string; name: string }[]) {
      nameById.set(w.id, w.name);
    }
  }
  const archive: ArchiveLeave[] = archiveRows.map((l) => ({
    id: l.id,
    worker_name: nameById.get(l.worker_id) ?? "—",
    leave_type: l.leave_type,
    start_date: l.start_date,
    end_date: l.end_date,
    status: l.status as "approved" | "rejected",
    // Karar verilmemiş eski kayıtlarda (patron doğrudan girdiyse decided_at
    // dolu; 031 öncesi veri yok) tarih null kalır → UI '—' gösterir.
    decided_by: l.approved_by ? nameById.get(l.approved_by) ?? "—" : "—",
    decided_at: l.decided_at,
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
          archive={archive}
          archiveCapped={archiveRows.length >= ARCHIVE_LIMIT}
        />
      </div>
    </DashboardShell>
  );
}
