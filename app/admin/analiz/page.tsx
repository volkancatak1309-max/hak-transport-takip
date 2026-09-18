import { requireAdmin } from "@/lib/session";
import { FUEL_PRICE_EUR_PER_L } from "@/lib/tenant";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  previousPeriod,
  computeTopDriversByType,
  computeSafetyScores,
  computeOwnerlessEvents,
  computeIdleWaste,
  computeMonthlyPivot,
  listVehiclesAndWorkers,
  FLEET_EPOCH,
  type AnalyticsRangeKey,
  type SafetyScoreRow,
} from "@/lib/analytics";
import { endOfTodayVienna } from "@/lib/format";
import { loadScoreInput } from "@/lib/score-core";
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

  const { vehicles, workers } = await listVehiclesAndWorkers();
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));

  /**
   * ⚠️ KENDİ `time_entries` SORGUSU KALDIRILDI (18.09.2026).
   *
   * Bu sayfa kendi vardiya sorgusunu yazıyordu ve iki noktada Performans
   * raporundan AYRILIYORDU:
   *   · kapsam — yalnız `withoutTestRows`; ŞOFÖR kapsamı (lib/driver-scope.ts)
   *     yoktu, yani yönetici hesabından açılmış vardiya buranın km atfına
   *     giriyor, raporunkine girmiyordu;
   *   · vardiya tanımı — kesişim (`ended_at >= start`), rapor ise başlangıç.
   * İki ekran aynı şoför için farklı karar veremez; artık ikisi de
   * `loadScoreInput` çağırıyor (lib/score-core.ts).
   */
  async function loadPeriod(r: { start: Date; end: Date }) {
    const startISO = r.start.toISOString();
    const endISO = r.end.toISOString();
    const [events, idleEpisodes, skor] = await Promise.all([
      listEventsInRange(startISO, endISO),
      listIdleEpisodesInRange(startISO, endISO),
      loadScoreInput(r),
    ]);
    /**
     * ⚠️ ODOMETRE AÇIKLIĞI OKUMASI KALDIRILDI (19.09.2026).
     *
     * Burada `okuFiloSpan` (097 RPC, demo'da "ay" penceresinde 4.183 ms) ve
     * geri düşüşünde araç başına iki sorgu koşuyordu. Sonucu (`distanceByVehicle`)
     * `computeSafetyScores`a gidiyordu; skor 18.09'da çekirdek km'ye geçince
     * TÜKETİCİSİ KALMADI ama okuma yerinde kaldı — her Analiz açılışında
     * ödenen, hiçbir sayıyı etkilemeyen bir bedeldi.
     *
     * Sayfanın mesafe gösterimi yok; olsaydı `buildDistanceReport` çağırırdı
     * ve o da artık aynı çekirdeği kullanıyor.
     */
    return { events, idleEpisodes, scoreInput: skor.input };
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
    workersById,
    current.scoreInput
  );
  /**
   * SAHİPSİZ OLAY KÖPRÜSÜ (20.08.2026) — KPI ile skor tablosu arasındaki fark.
   *
   * Yeni sorgu YOK: `current` zaten sayfada olan olaylar, epizodlar ve vardiya
   * pencereleridir. `computeSafetyScores` ile AYNI `eventOwnerAt` kararını
   * kullanır, o yüzden `scorable === attributed + ownerless + outOfRoster`
   * kimliği tanım gereği kapanır (bkz. lib/analytics-shared.ts).
   */
  const ownerless = computeOwnerlessEvents(
    current.events,
    current.idleEpisodes,
    vehiclesById,
    workersById,
    current.scoreInput.windowsByVehicle
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
      workersById,
      prev.scoreInput
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
          ownerless={ownerless}
          idleWaste={idleWaste}
          prevIdleWaste={prevIdleWaste}
          monthlyPivot={monthlyPivot}
          /* Eşik sınırı: not yalnız aralık sınırdan ÖNCE başlıyorsa çıkar;
             trend uyarısı ise karşılaştırma sınırı aştığında. */
          configEpochISO={configEpoch ? configEpoch.changedAt.toISOString() : null}
          showEpochNote={rangeStartsBeforeEpoch(range.start, configEpoch)}
          trendBlocked={trendBlocked}
          /* Fiyat SUNUCUDA okunur, prop olarak iner — istemcide
             process.env.FUEL_PRICE_EUR_PER_L undefined olurdu. */
          fuelPriceEurPerL={FUEL_PRICE_EUR_PER_L}
        />
      </div>
    </DashboardShell>
  );
}
