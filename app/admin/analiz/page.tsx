import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  previousPeriod,
  computeTopDriversByType,
  computeSafetyScores,
  computeIdleWaste,
  getVehicleDistanceKm,
  listVehiclesAndWorkers,
  scoreMinKmForRange,
  type AnalyticsRangeKey,
  type SafetyScoreRow,
} from "@/lib/analytics";
import {
  getLatestConfigEpoch,
  rangeStartsBeforeEpoch,
  comparisonCrossesEpoch,
} from "@/lib/config-epoch";
import { AnalizClient } from "./AnalizClient";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function AnalizPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const prevRange = previousPeriod(range);

  // Alarm eşiklerinin toplu değiştiği an (lib/config-epoch.ts). Tablo yoksa
  // null döner ve her şey eskisi gibi çalışır.
  const configEpoch = await getLatestConfigEpoch();

  const { vehicles, workers } = await listVehiclesAndWorkers();
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));

  async function loadPeriod(r: { start: Date; end: Date }) {
    const startISO = r.start.toISOString();
    const endISO = r.end.toISOString();
    const [events, idleEpisodes] = await Promise.all([
      listEventsInRange(startISO, endISO),
      listIdleEpisodesInRange(startISO, endISO),
    ]);
    const distanceEntries = await Promise.all(
      vehicles.map(async (v) => [v.id, await getVehicleDistanceKm(v.id, startISO, endISO)] as const)
    );
    return { events, idleEpisodes, distanceByVehicle: new Map(distanceEntries) };
  }

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
    scoreMinKmForRange(range)
  );
  const idleWaste = computeIdleWaste(current.idleEpisodes, vehiclesById, workersById);

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
      scoreMinKmForRange(prevRange)
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
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <AnalizClient
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
          topByType={topByType}
          safetyRows={safetyRowsWithTrend}
          idleWaste={idleWaste}
          prevIdleWaste={prevIdleWaste}
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
