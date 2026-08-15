import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  previousPeriod,
  computeTopDriversByType,
  computeSafetyScores,
  drivenVehiclesFromEntries,
  workedDaysFromEntries,
  getWorkerShiftDistance,
  shiftKmForScoring,
  shiftWindowsForScoring,
  scoreMinKmForWorkedDays,
  computeIdleWaste,
  computeMonthlyPivot,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
  scoreMinKmForSpan,
  FLEET_EPOCH,
  type AnalyticsRangeKey,
  type SafetyScoreRow,
} from "@/lib/analytics";
import { endOfTodayVienna } from "@/lib/format";
import { mapBounded } from "@/lib/db-fanout";
import {
  getLatestConfigEpoch,
  rangeStartsBeforeEpoch,
  comparisonCrossesEpoch,
} from "@/lib/config-epoch";
import { AnalizClient } from "./AnalizClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function AnalizPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/analiz");
  const sp = await searchParams;
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const prevRange = previousPeriod(range);

  // Alarm eşiklerinin toplu değiştiği an (lib/config-epoch.ts). Tablo yoksa
  // null döner ve her şey eskisi gibi çalışır.
  const configEpoch = await getLatestConfigEpoch();

  // test-filtered: aşağıdaki time_entries sorgusu bunu kullanır. workersById
  // zaten test hesaplarını taşımıyor ama filtre sorguda da olmalı — kalıcı test
  // şoförünün vardiyası km atfına girip gerçek bir aracı ona bağlayabilirdi.
  const testScope = await getTestScope();
  const { vehicles, workers } = await listVehiclesAndWorkers();
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));

  async function loadPeriod(r: { start: Date; end: Date }) {
    const startISO = r.start.toISOString();
    const endISO = r.end.toISOString();
    const [events, idleEpisodes, entryRes] = await Promise.all([
      listEventsInRange(startISO, endISO),
      listIdleEpisodesInRange(startISO, endISO),
      // FİİLEN SÜRÜLEN ARAÇ (09.08.2026): km artık atamadan değil vardiyadan
      // türüyor. Aralıkla KESİŞEN her vardiya sayılır (ended_at null = açık).
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("worker_id, vehicle_id, started_at")
          .lte("started_at", endISO)
          .or(`ended_at.is.null,ended_at.gte.${startISO}`),
        "worker_id",
        testScope.workerIds
      ),
    ]);
    const rangeEntryRows = (entryRes.data ?? []) as {
      worker_id: string | null;
      vehicle_id: string | null;
      started_at: string;
    }[];
    const drivenVehiclesByWorker = drivenVehiclesFromEntries(rangeEntryRows);
    const workedDaysByWorker = workedDaysFromEntries(rangeEntryRows);
    // VARDİYA PENCERELİ km (052). Üç durum ayrışır: başarılı / migration yok /
    // hesaplanamadı. Sonuncusunda eski yola DÜŞÜLMEZ — bkz. shiftKmForScoring.
    const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
    // Span (km + ÖLÇÜM PENCERESİ). Pencere, skor kapısının şoför başına
    // ölçeklenmesi için gerekli (B kararı, 27.07.2026 — scoreMinKmForSpan).
    // Eşzamanlılık tavanı (09.08.2026): araç başına İKİ sorgu, sınırsız hâlinde
    // 60 ifade. Ölçüm ve gerekçe lib/db-fanout.ts'te — sınırlamak duvar saatini
    // uzatmıyor, kısaltıyor; asıl kazanç ifade başına zaman aşımı payı.
    const spanEntries = await mapBounded(
      vehicles,
      async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)] as const
    );
    const spanByVehicle = new Map(spanEntries);
    const distanceByVehicle = new Map(
      [...spanByVehicle].map(([id, s]) => [id, s.km] as const)
    );
    return {
      events,
      idleEpisodes,
      distanceByVehicle,
      spanByVehicle,
      drivenVehiclesByWorker,
      workedDaysByWorker,
      shiftKmByWorker: shiftKmForScoring(shiftKmRes),
      // EKSEN BİRLİĞİ (15.08.2026): olay atfı da km'nin geldiği SATIRLARDAN.
      // İkisi tek `shiftKmRes`ten türüyor — ayrı sorgu olsaydı yine ayrışırdı.
      shiftWindowsByVehicle: shiftWindowsForScoring(shiftKmRes),
      shiftKmUnavailable: shiftKmRes.unavailable,
    };
  }

  /** Şoförün araçlarının ölçüm pencerelerinden km eşiğini türeten kapı. */
  // ÇALIŞILAN GÜN eşiği (09.08.2026). Odometre penceresi (scoreMinKmForSpan)
  // yerine şoförün gerçekten çalıştığı gün sayısı: ikisi de "takvim günü haksız"
  // sorununu çözüyordu ama pencere ARACIN ölçüm süresini, bu KİŞİNİN mesaisini
  // ölçüyor — doğru payda bu. Çalışılan gün bilinmiyorsa (0) eski pencere
  // yoluna düşülür, yani davranış hiçbir koşulda tanımsız kalmaz.
  const gateFor =
    (
      r: { start: Date; end: Date },
      spanByVehicle: Map<string, { firstAt: string | null; lastAt: string | null }>,
      workedDaysByWorker: Map<string, number>
    ) =>
    (vehicleIds: string[], workerId: string) => {
      const worked = workedDaysByWorker.get(workerId) ?? 0;
      // BAYRAK: çalışılan-gün eşiği varsayılan KAPALI (bkz. lib/tenant.ts).
      if (SCORE_THRESHOLD_WORKED_DAYS && worked > 0) {
        return scoreMinKmForWorkedDays(r, worked);
      }
      return scoreMinKmForSpan(
        r,
        vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })
      );
    };

  const current = await loadPeriod(range);
  const topByType = computeTopDriversByType(
    current.events,
    current.idleEpisodes,
    vehiclesById,
    workersById
  );
  const safetyRows = computeSafetyScores(
    current.events,
    current.idleEpisodes,
    vehiclesById,
    workersById,
    current.distanceByVehicle,
    gateFor(range, current.spanByVehicle, current.workedDaysByWorker),
    current.drivenVehiclesByWorker,
    current.shiftKmByWorker,
    current.shiftWindowsByVehicle
  );
  const idleWaste = computeIdleWaste(current.idleEpisodes, vehiclesById, workersById);

  // AYLIK PİVOT ARŞİVİ — aralık seçicisinden BAĞIMSIZ, filo başlangıcından
  // bugüne TÜM geçmiş. Kendi sorgusu var çünkü sayfanın seçili aralığı
  // (ör. "Bugün") arşivi tek sütuna düşürürdü; arşivin işi tam tersi.
  // Mesafe sorgusu YOK: pivot yalnız sayar, km'ye ihtiyaç duymaz.
  const archiveStartISO = FLEET_EPOCH.toISOString();
  const archiveEndISO = endOfTodayVienna().toISOString();
  const [archiveEvents, archiveIdle] = await Promise.all([
    listEventsInRange(archiveStartISO, archiveEndISO),
    listIdleEpisodesInRange(archiveStartISO, archiveEndISO),
  ]);
  const monthlyPivot = computeMonthlyPivot(
    archiveEvents,
    archiveIdle,
    vehiclesById,
    workersById
  );

  let safetyRowsWithTrend: SafetyScoreRow[] = safetyRows.map((r) => ({
    ...r,
    trend: null,
    prevScore: null,
  }));
  let prevIdleWaste: { totalMs: number; totalEuro: number } | null = null;

  // TREND KAPISI (22.07.2026): önceki dönemle karşılaştırma, alarm eşiklerinin
  // değiştiği sınırı aşıyorsa trend HESAPLANMAZ. Aşan bir karşılaştırmada her
  // şoför "düzelmiş" görünürdü — düzelen sürüş değil, cetvel. Önceki dönemin
  // verisini çekmeye de gerek yok (gereksiz sorgu).
  const trendBlocked =
    !!prevRange &&
    comparisonCrossesEpoch(
      range.start,
      range.end,
      prevRange.start,
      prevRange.end,
      configEpoch
    );

  if (prevRange && !trendBlocked) {
    const prev = await loadPeriod(prevRange);
    const prevSafety = computeSafetyScores(
      prev.events,
      prev.idleEpisodes,
      vehiclesById,
      workersById,
      prev.distanceByVehicle,
      gateFor(prevRange, prev.spanByVehicle, prev.workedDaysByWorker),
      prev.drivenVehiclesByWorker,
      prev.shiftKmByWorker,
      prev.shiftWindowsByVehicle
    );
    const prevScoreByWorker = new Map(prevSafety.map((r) => [r.workerId, r.score]));
    safetyRowsWithTrend = safetyRows.map((r) => {
      const prevScore = prevScoreByWorker.get(r.workerId) ?? null;
      // Trend yalnız İKİ dönemde de gerçek skor varsa anlamlı; biri "veri yok"
      // (null) ise ok gösterme.
      const trend: "up" | "down" | "flat" | null =
        prevScore === null || r.score === null
          ? null
          : r.score > prevScore
            ? "up"
            : r.score < prevScore
              ? "down"
              : "flat";
      return { ...r, prevScore, trend };
    });
    prevIdleWaste = computeIdleWaste(prev.idleEpisodes, vehiclesById, workersById);
  }

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
        <AnalizClient
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
          topByType={topByType}
          safetyRows={safetyRowsWithTrend}
          shiftKmFailed={
            current.shiftKmUnavailable === "timeout" ||
            current.shiftKmUnavailable === "error"
          }
          idleWaste={idleWaste}
          prevIdleWaste={prevIdleWaste}
          monthlyPivot={monthlyPivot}
          /* Eşik sınırı: not yalnız aralık sınırdan ÖNCE başlıyorsa çıkar;
             trend uyarısı ise karşılaştırma sınırı aştığında. */
          configEpochISO={configEpoch ? configEpoch.changedAt.toISOString() : null}
          showEpochNote={rangeStartsBeforeEpoch(range.start, configEpoch)}
          trendBlocked={trendBlocked}
        />
      </div>
    </DashboardShell>
  );
}
