import { requireFleetView } from "@/lib/session";
import { getFleetScope, onlyFleet } from "@/lib/fleet-scope";
import { supabaseAdmin, fetchAllRows, chunkIds } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { dailyCapMs, touchesNightWindow } from "@/lib/azg-rules";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AdminClient } from "./AdminClient";
import {
  workedMs,
  kmDiff,
  startOfTodayVienna,
  endOfTodayVienna,
  startOfWeekVienna,
  endOfWeekVienna,
  startOfMonthVienna,
  endOfMonthVienna,
  startOfDayViennaFromYmd,
  endOfDayViennaFromYmd,
} from "@/lib/format";
import { getDashboardData } from "@/lib/admin-dashboard";
import type {
  TimeEntry,
  TimeEntryWithWorker,
  WorkerPublic,
  DriverReportType,
} from "@/lib/types";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import type { AdminDriverReport } from "@/components/admin/DriverReportsCard";
import type { ActiveShiftRow } from "@/components/admin/ActiveShiftsCard";
import { listEditedEntryIds } from "@/lib/shift-edit-log";

export const dynamic = "force-dynamic";

type Range = "today" | "week" | "month" | "custom";

// All boundaries are resolved against the Europe/Vienna calendar (see
// lib/format helpers), so "today / week / month" stay correct regardless of the
// server's own timezone (Vercel runs on UTC).
function computeRange(
  range: Range,
  from?: string,
  to?: string
): { start: Date; end: Date } {
  if (range === "week") {
    return { start: startOfWeekVienna(), end: endOfWeekVienna() };
  }
  if (range === "month") {
    return { start: startOfMonthVienna(), end: endOfMonthVienna() };
  }
  if (range === "custom") {
    const start = (from && startOfDayViennaFromYmd(from)) || startOfTodayVienna();
    const end = (to && endOfDayViennaFromYmd(to)) || endOfTodayVienna();
    return { start, end };
  }
  // "today" (default)
  return { start: startOfTodayVienna(), end: endOfTodayVienna() };
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    worker?: string;
    status?: string;
  }>;
}) {
  // Patron VE filo sefi girer; sef icin kapsam kendi filosuyla sinirlidir.
  // Diger 17 yonetici sayfasi requireAdmin() ile korunmaya devam ediyor,
  // yani sef oralara URL'den de giremez (bkz. lib/session.ts).
  const { session, fleet, isChief } = await requireFleetView();
  const fleetScope = await getFleetScope(fleet);
  const sp = await searchParams;
  const range = (sp.range ?? "today") as Range;
  const workerFilter = sp.worker ?? "all";
  const statusFilter = sp.status ?? "all";
  const { start, end } = computeRange(range, sp.from, sp.to);

  // NOTE: we deliberately do NOT use a `workers!inner(...)` embed here. That
  // embed was returning no rows (fragile relationship resolution), which zeroed
  // every KPI for every range while the embed-free weekly chart stayed correct.
  // We fetch entries plainly and attach the worker from a separate query.
  // Uzun aralıklar (ay/özel) 1000 satır tavanını aşabilir; toplamlar ve
  // Excel/PDF dışa aktarımlar eksik kalmasın diye sonuna kadar sayfalanır.
  const scope = await getTestScope();
  const entriesQuery = fetchAllRows<TimeEntry>((from, to) => {
    // Her iki eleme de AŞAĞIDA, koşullu filtrelerden SONRA uygulanıyor
    // (zincirin sonunda `query = ...`), muhafızın penceresi dışında kalıyor:
    // test-filtered: withoutTestRows(query, "worker_id", scope.workerIds)
    // fleet-scoped: onlyFleet(query, "worker_id", fleetScope.workerIds)
    let query = supabaseAdmin
      .from("time_entries")
      .select("*")
      .gte("started_at", start.toISOString())
      .lte("started_at", end.toISOString())
      .order("started_at", { ascending: false })
      .order("id");

    if (workerFilter !== "all") query = query.eq("worker_id", workerFilter);
    if (statusFilter === "active") query = query.is("ended_at", null);
    else if (statusFilter === "completed")
      query = query.not("ended_at", "is", null);
    // Vardiya Kayıtları arşivi + üst toplamlar + CSV/PDF dışa aktarımı hepsi
    // bu diziden türer; eleme tek noktada.
    query = withoutTestRows(query, "worker_id", scope.workerIds);
    // Arsiv sefte GIZLI; veriyi yine de daraltiyoruz ki gizli bir bilesen
    // ya da ileride acilacak bir gorunum karsi filoyu sizdirmasin.
    query = onlyFleet(query, "worker_id", fleetScope.workerIds, fleetScope);
    return query.range(from, to);
  });

  const [entriesResult, workersResult, dashboard] = await Promise.all([
    entriesQuery,
    // test-filtered: withoutTestRows — isim haritası + şoför filtresi dropdown'ı.
    onlyFleet(
      withoutTestRows(
        supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
        "id",
        scope.workerIds
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    getDashboardData(start.toISOString(), end.toISOString(), fleetScope),
  ]);

  const workersData = (workersResult.data ?? []) as WorkerPublic[];
  const workerMap = new Map(workersData.map((w) => [w.id, w]));

  let entriesData = ((entriesResult.data ?? []) as TimeEntry[]).map((e) => {
    const w = workerMap.get(e.worker_id);
    return {
      ...e,
      workers: w ? { id: w.id, name: w.name, plate: w.plate } : null,
    } as TimeEntryWithWorker;
  });
  if (statusFilter === "over") {
    entriesData = entriesData.filter(
      (e) => workedMs(e) > dailyCapMs(touchesNightWindow(e.started_at, e.ended_at))
    );
  }

  // Totals reflect the SELECTED range. Hours/KM come from COMPLETED shifts only.
  // The "active shifts" count is NOT range-derived: it must match the live
  // "drivers in field" number at the top, so it comes from the single source of
  // truth in getDashboardData (every open shift, regardless of window).
  let totalMs = 0;
  let totalKm = 0;
  let overLimit = 0;
  for (const e of entriesData) {
    if (e.ended_at !== null) {
      totalMs += workedMs(e);
      const km = kmDiff(e);
      if (km !== null) totalKm += km;
    }
    if (workedMs(e) > dailyCapMs(touchesNightWindow(e.started_at, e.ended_at)))
      overLimit++;
  }
  const activeCount = dashboard.todayOps.driversInField;

  // v2 (migration 020) — admin görünürlüğü: açık şoför bildirimleri (SORUN
  // BİLDİR) + hangi vardiyaların fotoğrafı var. Her iki sorgu da migration 020
  // öncesi tabloların yokluğunda hata döner (data null → boş liste); admin
  // panelini asla bozmaz.
  // shift_photos: yüzlerce UUID tek `.in()` ile URL sınırını aşar ve sorgu
  // sessizce boş döner; id listesi parçalanarak sorgulanır.
  const entryIds = entriesData.map((e) => e.id);
  const [reportsRes, ...photoChunks] = await Promise.all([
    supabaseAdmin
      .from("driver_reports")
      .select("id, worker_id, report_type, created_at, latitude, longitude")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    // SAYFALI (25.07.2026): chunk BAŞINA da 1000 satır tavanı işliyor. 100
    // vardiyalık bir chunk'ta ortalama 10 fotoğraf tavanı doldurur ve fazlası
    // sessizce düşerdi → bazı vardiyalar "fotoğrafı yok" görünürdü.
    ...chunkIds(entryIds).map((ids) =>
      fetchAllRows<{ time_entry_id: string }>(
        (from, to) =>
          supabaseAdmin
            .from("shift_photos")
            .select("time_entry_id")
            .in("time_entry_id", ids)
            .order("id")
            .range(from, to),
        "admin/shift_photos"
      )
    ),
  ]);
  const photosRes = {
    data: photoChunks.flatMap(
      (c) => (c.data ?? []) as { time_entry_id: string }[]
    ),
  };

  const openReports: AdminDriverReport[] = (
    (reportsRes.data ?? []) as {
      id: string;
      worker_id: string;
      report_type: DriverReportType;
      created_at: string;
      latitude: number | null;
      longitude: number | null;
    }[]
  ).map((r) => ({
    id: r.id,
    worker_name: workerMap.get(r.worker_id)?.name ?? "—",
    report_type: r.report_type,
    created_at: r.created_at,
    latitude: r.latitude,
    longitude: r.longitude,
  }));

  // Elle düzeltilmiş kayıtlar → listede "düzenlendi" rozeti. Tablo yoksa boş
  // küme döner ve hiçbir rozet çıkmaz (bkz. lib/shift-edit-log.ts).
  const editedEntryIds = [...(await listEditedEntryIds(entryIds))];

  const photoEntryIds = [
    ...new Set(
      ((photosRes.data ?? []) as { time_entry_id: string }[]).map(
        (p) => p.time_entry_id
      )
    ),
  ];

  // AKTİF VARDİYALAR (23.07.2026'da yeniden kuruldu) — seçili tarih
  // aralığından BAĞIMSIZ. Açık vardiya "bugünün verisi" değil, şu anki
  // durumdur; "bu ay" filtresinde kaybolması onu telafi aracı olmaktan
  // çıkarırdı. Süre sunucuda hesaplanır — istemcide Date.now() ile
  // hesaplansaydı ilk render'da hidrasyon uyuşmazlığı üretirdi.
  // test-filtered + fleet-scoped: bu kart filo sefinin gordugu dort
  // bolumden biri. Kapsam UNUTULMUSTU ve muhafiz yakaladi (22.07.2026):
  // sef karsi filonun acik vardiyalarini goruyordu. vehicle_id select'e
  // eklendi — filo bagi arac uzerinden kuruluyor, plaka metni degil.
  const { data: activeShiftData } = await onlyFleet(
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, plate, started_at")
        .is("ended_at", null)
        .order("started_at", { ascending: true }),
      "worker_id",
      scope.workerIds
    ),
    // Şoför ekseni: ödünç araç kullanan şoför kendi şefinin listesinde kalır.
    "worker_id",
    fleetScope.workerIds,
    fleetScope
  );

  const nowMs = Date.now();
  // Açık vardiyada "dünden kalmış mı" YANLIŞ sinyaldi (23.07.2026): 22:00'de
  // başlayan gece vardiyası ertesi güne sarkar ve tamamen normaldir; o ölçüt
  // her gece şoförünü uyarı listesine sokuyordu. Tek gerçek sinyal yasal
  // günlük tavanın aşılmasıdır. Tavan gece penceresine değen vardiyada 10
  // saate iner — panelin geri kalanı (harita, dikkat panosu, AZG raporu)
  // zaten bu ikili hesabı kullanıyor, kart da aynı kaynağa bağlandı.
  const activeShifts: ActiveShiftRow[] = (
    (activeShiftData ?? []) as {
      id: string;
      worker_id: string | null;
      vehicle_id: string | null;
      plate: string | null;
      started_at: string;
    }[]
  ).map((e) => {
    const startedMs = new Date(e.started_at).getTime();
    const elapsedMs = Math.max(0, nowMs - startedMs);
    const capMs = dailyCapMs(touchesNightWindow(e.started_at, null));
    return {
      id: e.id,
      worker_name: e.worker_id ? workerMap.get(e.worker_id)?.name ?? "—" : "—",
      plate: e.plate,
      started_at: e.started_at,
      elapsedMs,
      capMs,
      overLimit: elapsedMs > capMs,
    };
  });
  // Tavanı aşanlar en üstte, her iki grup kendi içinde en uzundan kısaya.
  activeShifts.sort(
    (a, b) =>
      Number(b.overLimit) - Number(a.overLimit) || b.elapsedMs - a.elapsedMs
  );
  const overLimitCount = activeShifts.filter((s) => s.overLimit).length;

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
        <AdminClient
          /* Sef SADECE IZLER: Excel/PDF/AZG/Calisan Ekle, arsiv, sofor
             bildirimleri ve Kapat/Duzelt kisayollari gizlenir. Sunucu
             tarafi zaten requireAdmin() ile korunuyor; bu, olu buton
             gostermemek icin. */
          readOnly={isChief}
          entries={entriesData}
          workers={workersData}
          range={range}
          from={sp.from ?? ""}
          to={sp.to ?? ""}
          workerFilter={workerFilter}
          statusFilter={statusFilter}
          summary={{ totalMs, totalKm, activeCount, overLimit }}
          dashboard={dashboard}
          reports={openReports}
          activeShifts={activeShifts}
          overLimitShifts={overLimitCount}
          photoEntryIds={photoEntryIds}
          editedEntryIds={editedEntryIds}
        />
      </div>
    </DashboardShell>
  );
}
