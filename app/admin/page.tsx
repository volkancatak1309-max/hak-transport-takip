import { requireFleetView, isOwnerCached } from "@/lib/session";
import { markKmMeasured } from "@/lib/km-quality";
import { audit } from "@/lib/security-log";
import { getFleetScope, onlyFleet } from "@/lib/fleet-scope";
import { supabaseAdmin, fetchAllRows, chunkIds } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, dropNonDrivers, onlyDrivers } from "@/lib/driver-scope";
import {
  dailyCapMs,
  touchesNightWindow,
  overLimitDayCount,
  overLimitEntryIds,
} from "@/lib/azg-rules";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AdminClient } from "./AdminClient";
import {
  workedMs,
  kmDiff,
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
  startOfDayViennaFromYmd,
  endOfDayViennaFromYmd,
} from "@/lib/format";
import { SLIDING_WEEK_DAYS, SLIDING_MONTH_DAYS } from "@/lib/analytics";
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

// All boundaries are resolved against the TENANT calendar (lib/tz.ts → lib/format
// helpers; HAK61/Sendigo/galzura-demo = Europe/Vienna), so "today / week / month"
// stay correct regardless of the server's own timezone (Vercel runs on UTC).
//
// KAYAN PENCERE (27.07.2026, Volkan kararı) — "week"/"month" artık TAKVİM
// haftası/ayı DEĞİL, son 7 / son 30 gün. Gerekçe ve canlı ölçüm:
// lib/analytics.ts computeAnalyticsRange. Yönetici panosu ile Analiz ve rapor
// sayfaları aynı pencere dilini konuşmak zorunda — aksi hâlde aynı gün için
// iki ekranda iki farklı sayı çıkar.
function computeRange(
  range: Range,
  from?: string,
  to?: string
): { start: Date; end: Date } {
  if (range === "week") {
    return {
      start: addCalendarDaysVienna(startOfTodayVienna(), -(SLIDING_WEEK_DAYS - 1)),
      end: endOfTodayVienna(),
    };
  }
  if (range === "month") {
    return {
      start: addCalendarDaysVienna(startOfTodayVienna(), -(SLIDING_MONTH_DAYS - 1)),
      end: endOfTodayVienna(),
    };
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
  const driverScope = await getDriverScope();
  const entriesQuery = fetchAllRows<TimeEntry>((from, to) => {
    // ÜÇ eleme de AŞAĞIDA, koşullu filtrelerden SONRA uygulanıyor
    // (zincirin sonunda `query = ...`), muhafızın penceresi dışında kalıyor:
    // test-filtered: withoutTestRows(query, "worker_id", scope.workerIds)
    // fleet-scoped: onlyFleet(query, "worker_id", fleetScope.workerIds)
    // driver-scoped: onlyDrivers(query, "worker_id", driverScope)
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
    // driver-scoped: üst toplamlar (Toplam Saat / Toplam KM / tavan aşımı) ve
    // Excel-PDF çıktısı bu diziden türüyor. Yönetici hesabından açılmış iki
    // demo vardiya tek başına 20.100 km taşıyordu — Raporlar > Performans onu
    // artık elediği için burası kapsamsız kalsaydı iki ekran birbirini tutmazdı.
    query = onlyDrivers(query, "worker_id", driverScope);
    // Arsiv sefte GIZLI; veriyi yine de daraltiyoruz ki gizli bir bilesen
    // ya da ileride acilacak bir gorunum karsi filoyu sizdirmasin.
    query = onlyFleet(query, "worker_id", fleetScope.workerIds, fleetScope);
    return query.range(from, to);
  });

  const [entriesResult, workersResult, dashboard] = await Promise.all([
    entriesQuery,
    // test-filtered: withoutTestRows — isim haritası + şoför filtresi dropdown'ı.
    // driver-scoped: sorgu BİLEREK geniş kalır — çıktısı hem geniş isim
    // haritasını (workerMap) hem dar şoför seçicisini (driverWorkers) besliyor.
    // Daraltma aşağıda, dropNonDrivers ile YALNIZ seçici tarafında yapılıyor;
    // burada daraltılsaydı eski vardiya satırları "—" adıyla kalırdı.
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
    // ÜST BÖLÜM SABİT BUGÜN (09.08.2026, Volkan kararı). Günün Panosu, 5'li
    // sayı ızgarası ve Dikkat/Aksiyon "ŞU AN ne oluyor" sorusunu cevaplar;
    // tarih aralığından etkilenmeleri anlamsızdı ve kafa karıştırıyordu
    // ("Son 30 gün" seçilince pano hâlâ bugünü gösteriyor, ama Dikkat listesi
    // 30 günlük teslim edilmemiş paketlerle doluyordu). Aralık artık YALNIZ
    // aşağıdaki Vardiya Kayıtları arşivini süzer.
    //
    // Dünden devreden AÇIK vardiyalar bu daralmayla kaybolmaz: onları
    // "Dünden açık" kartı ve Günün Panosu'ndaki 5. sekme taşıyor (2b89933).
    getDashboardData(
      startOfTodayVienna().toISOString(),
      endOfTodayVienna().toISOString(),
      fleetScope
    ),
  ]);

  const workersData = (workersResult.data ?? []) as WorkerPublic[];
  // İSİM HARİTASI — BİLEREK GENİŞ. Vardiya satırlarının adını buradan çözüyoruz;
  // daraltılırsa yönetici hesabından açılmış eski bir vardiya "—" adıyla ekranda
  // kalır (satır düşmez, yalnız kimliği kaybolur). Şoför EVRENİ ayrı: aşağıdaki
  // driverWorkers.
  const workerMap = new Map(workersData.map((w) => [w.id, w]));

  // driver-scoped: yalnız ŞOFÖR SEÇİCİSİ ve Excel'in Pers.-Nr numaralandırması
  // için. Yöneticiler seçicide şoför gibi görünüyordu (seçilince liste boş
  // geliyordu) ve sıralamada yer kapladıkları için employee_number'ı boş olan
  // şoförlerin yedek numaraları kayıyordu. Ayrılan şoförler KALIR — bu bir
  // GEÇMİŞ KAYIT filtresi, eski vardiyaları aranabilmeli.
  const driverWorkers = dropNonDrivers(workersData, (w) => w.id, driverScope);

  // km_measured: cihazı sessiz vardiyanın 0 km'si ÖLÇÜM DEĞİL — tablo, Excel
  // ve Almanca PDF üçü de bu bayrağı okuyan kmDiff'ten geçer (lib/km-quality.ts).
  const markedEntries = await markKmMeasured((entriesResult.data ?? []) as TimeEntry[]);
  let entriesData = markedEntries.map((e) => {
    const w = workerMap.get(e.worker_id);
    return {
      ...e,
      workers: w ? { id: w.id, name: w.name, plate: w.plate } : null,
    } as TimeEntryWithWorker;
  });
  // ŞOFÖR-GÜN EKSENİ (14.08.2026, lib/azg-rules.ts). § 9 Abs. 1 tavanı GÜNE
  // aittir; süzgeç satır başına baksaydı aynı gün 8 sa + 6 sa çalışan şoför
  // "tavan aşımı" süzgecinde hiç çıkmazdı — AZG PDF'i ise o günü ihlal sayıyor.
  const overIds = overLimitEntryIds(entriesData);
  if (statusFilter === "over") {
    entriesData = entriesData.filter((e) => overIds.has(e.id));
  }

  // Totals reflect the SELECTED range. Hours/KM come from COMPLETED shifts only.
  // The "active shifts" count is NOT range-derived: it must match the live
  // "drivers in field" number at the top, so it comes from the single source of
  // truth in getDashboardData (every open shift, regardless of window).
  let totalMs = 0;
  let totalKm = 0;
  for (const e of entriesData) {
    if (e.ended_at !== null) {
      totalMs += workedMs(e);
      const km = kmDiff(e);
      if (km !== null) totalKm += km;
    }
  }
  // İHLAL SAYISI = tavanı aşan ŞOFÖR-GÜN sayısı, aşan satır sayısı değil. Bir
  // günün iki vardiyası tek ihlaldir. Canlı ölçüm (14.08.2026, son 120 gün):
  // HAK61 78 (satır ekseniyle AYNI), Sendigo 3 (aynı).
  const overLimit = overLimitDayCount(entriesData);
  const activeCount = dashboard.todayOps.driversInField;

  // v2 (migration 020) — admin görünürlüğü: açık şoför bildirimleri (SORUN
  // BİLDİR) + hangi vardiyaların fotoğrafı var. Her iki sorgu da migration 020
  // öncesi tabloların yokluğunda hata döner (data null → boş liste); admin
  // panelini asla bozmaz.
  // shift_photos: yüzlerce UUID tek `.in()` ile URL sınırını aşar ve sorgu
  // sessizce boş döner; id listesi parçalanarak sorgulanır.
  const entryIds = entriesData.map((e) => e.id);
  const [reportsRes, ...photoChunks] = await Promise.all([
    // ŞOFÖR BİLDİRİMLERİ — ÜÇ kapsam da burada (28.07.2026).
    //
    // Bu sorgu uzun süre kapsamsız kaldı ve iki gerçek sızıntı taşıyordu:
    //   • test şoförünün bildirimi yönetici panosunda görünüyordu;
    //   • filo şefi KARŞI FİLONUN bildirimini görüyordu — hem tipini hem de
    //     Google Maps konum linkini. Aynı dosyadaki diğer üç sorgu ikisini de
    //     taşıyordu; yalnız bu atlanmıştı.
    // Kök neden yapısaldı: scripts/check-test-filters.mjs'in GUARDED listesi
    // driver_reports'u içermiyordu, yani muhafız bu sorguyu HİÇ denetlemiyordu.
    // Liste bu sürümde genişletildi; artık aynı hata derlemeyi kırar.
    //
    // driver-scoped: yönetici hesabından bildirim gelmesi beklenmez ama bu bir
    // ŞOFÖR bildirimi kartıdır; kapsam simetrik olsun diye o da uygulanıyor.
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("driver_reports")
            .select("id, worker_id, report_type, created_at, latitude, longitude")
            .is("resolved_at", null)
            .order("created_at", { ascending: false })
            .limit(50),
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
  // driver-scoped: "Kapanmamış Vardiyalar" kartı. Otomatik kapanış KALDIRILDI
  // (22.07.2026) → yönetici hesabının kapanmamış bir vardiyası burada süresiz
  // durur ve gerçek bir şoför sorunu gibi okunur.
  const { data: activeShiftData } = await onlyFleet(
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("id, worker_id, vehicle_id, plate, started_at")
          .is("ended_at", null)
          .order("started_at", { ascending: true }),
        "worker_id",
        scope.workerIds
      ),
      "worker_id",
      driverScope
    ),
    // Şoför ekseni: ödünç araç kullanan şoför kendi şefinin listesinde kalır.
    "worker_id",
    fleetScope.workerIds,
    fleetScope
  );

  const nowMs = Date.now();
  // Şoförün BUGÜN zaten kapattığı vardiyaların toplamı — açık vardiyanın gün
  // tavanı hesabına eklenir (aşağıda). Kaynak Günün Panosu'nun bugün penceresi;
  // ayrı bir sorgu açmaya gerek yok.
  const priorTodayMsByWorker = new Map<string, number>();
  for (const e of dashboard.todayEntries) {
    if (!e.worker_id || e.ended_at === null) continue;
    priorTodayMsByWorker.set(
      e.worker_id,
      (priorTodayMsByWorker.get(e.worker_id) ?? 0) + workedMs(e, nowMs)
    );
  }
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
    // ŞOFÖR-GÜN EKSENİ (14.08.2026): tavan güne aittir. Aynı şoför bugün daha
    // önce KAPANMIŞ bir vardiya çalıştıysa (SHIFT_PER_DAY='many' kiracısında
    // olağan) o süre de tavana sayılır — yoksa 6 sa + 7 sa çalışan şoför açık
    // vardiyası 7 saatte olduğu için temiz görünürdü. `elapsedMs` GÖSTERİLEN
    // süre olarak açık vardiyanınki kalır: kart "bu vardiya ne kadar sürdü"
    // sorusunu cevaplıyor, rozet ise "gün tavanı aşıldı mı" sorusunu.
    const priorMs = e.worker_id ? (priorTodayMsByWorker.get(e.worker_id) ?? 0) : 0;
    return {
      id: e.id,
      worker_name: e.worker_id ? workerMap.get(e.worker_id)?.name ?? "—" : "—",
      plate: e.plate,
      started_at: e.started_at,
      elapsedMs,
      capMs,
      overLimit: elapsedMs + priorMs > capMs,
    };
  });
  // Tavanı aşanlar en üstte, her iki grup kendi içinde en uzundan kısaya.
  activeShifts.sort(
    (a, b) =>
      Number(b.overLimit) - Number(a.overLimit) || b.elapsedMs - a.elapsedMs
  );
  const overLimitCount = activeShifts.filter((s) => s.overLimit).length;

  // Patron menü ögesi (045). Menü kozmetiktir; /admin/guvenlik kendi
  // requireOwner() kapısıyla korunur.
  //
  // Katman KAPALIYSA sorgu HİÇ atılmaz (lib/session.ts → isOwnerCached).
  // Bu şart ölçümle geldi: 08.08.2026'da canlı HAK61 veritabanına bakıldı,
  // `workers.is_owner` yok (42703) — yani gating olmadan bu satır /admin'in
  // HER açılışında hataya düşen bir gidiş-dönüş üretiyordu. Katman kapalıysa
  // gösterilecek ekran da yok, dolayısıyla sormanın anlamı da yok.
  const owner = session.worker_id ? await isOwnerCached(session.worker_id) : false;

  // Sayfa görüntüleme izi (045) — katman kapalıyken no-op.
  await audit(session.worker_id ?? null, "page_view", "/admin");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: !isChief,
        isOwner: owner,
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
          overLimitIds={[...overIds]}
          workers={driverWorkers}
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
