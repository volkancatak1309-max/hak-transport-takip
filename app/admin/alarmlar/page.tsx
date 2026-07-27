import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
  IDLE_TRIGGER_S,
} from "@/lib/telemetry";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
} from "@/lib/format";
import {
  getLatestConfigEpoch,
  rangeStartsBeforeEpoch,
  comparisonCrossesEpoch,
  type ConfigEpoch,
} from "@/lib/config-epoch";
import { eventTone } from "@/lib/event-ui";
import type { TrendBucket } from "@/components/ui-v2";
import { AlarmsClient, type AlarmRow } from "./AlarmsClient";

export const dynamic = "force-dynamic";

/**
 * "epoch" = alarm eşiklerinin son değiştiği andan bugüne (device_config_epochs).
 * Sabit tarih YOK: sınır her zaman tablodan okunur, eşikler tekrar değişirse
 * bu seçenek kendiliğinden yeni sınıra kayar.
 */
export type AlarmRange = "epoch" | "today" | "7d" | "30d";

const ALARM_RANGES: AlarmRange[] = ["epoch", "today", "7d", "30d"];

function computeRange(
  range: AlarmRange,
  epoch: ConfigEpoch | null
): { start: Date; end: Date } {
  const end = endOfTodayVienna();
  // Sınır anından bugünün sonuna. Çağıran, epoch null iken bu dalı hiç
  // seçmiyor (bkz. effectiveRange) — yine de savunmacı davranıyoruz.
  if (range === "epoch" && epoch) return { start: epoch.changedAt, end };
  if (range === "today") return { start: startOfTodayVienna(), end };
  const days = range === "30d" ? 29 : 6;
  return { start: addCalendarDaysVienna(startOfTodayVienna(), -days), end };
}

export type AlarmTrend = {
  buckets: TrendBucket[];
  /** Bu dönem toplamı / önceki dönem toplamı (yoksa null). */
  total: number;
  prevTotal: number | null;
  /** Eşik sınırı aşıldığı için karşılaştırma yapılmadı. */
  comparisonBlocked: boolean;
};

/**
 * GÜN GÜN alarm sayısı + kritik kırılımı. Aralık 2 günden uzunsa GÜN, değilse
 * SAAT kovaları kullanılır — "bugün" seçildiğinde tek çubuk anlamsız olurdu.
 */
function buildAlarmTrend(
  cur: {
    events: { occurred_at: string; event_type: string }[];
    episodes: { started_at: string }[];
    start: Date;
    end: Date;
  },
  prev: {
    events: { occurred_at: string; event_type: string }[];
    episodes: { started_at: string }[];
  } | null
): AlarmTrend {
  const spanMs = cur.end.getTime() - cur.start.getTime();
  const byHour = spanMs <= 2 * 86_400_000;
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    return byHour
      ? d.toLocaleString("sv-SE", { timeZone: "Europe/Vienna", hour: "2-digit", hour12: false }).slice(-2) + ":00"
      : d.toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
  };
  const labelOf = (key: string) =>
    byHour ? key : `${Number(key.slice(8, 10))}.${key.slice(5, 7)}`;

  const acc = new Map<string, { value: number; critical: number }>();
  const bump = (iso: string, critical: boolean) => {
    const k = keyOf(iso);
    const c = acc.get(k) ?? { value: 0, critical: 0 };
    c.value++;
    if (critical) c.critical++;
    acc.set(k, c);
  };
  for (const e of cur.events) bump(e.occurred_at, eventTone(e.event_type) === "critical");
  for (const e of cur.episodes) bump(e.started_at, false);

  const buckets: TrendBucket[] = [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, label: labelOf(key), value: v.value, critical: v.critical }));

  const total = cur.events.length + cur.episodes.length;
  const prevTotal = prev ? prev.events.length + prev.episodes.length : null;
  return { buckets, total, prevTotal, comparisonBlocked: prev === null };
}

export default async function AlarmsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;

  // Eşik sınırı önce okunur: hem VARSAYILAN aralığı hem uyarıyı o belirliyor.
  // Tablo/kayıt yoksa null döner (lib/config-epoch.ts) → sayfa eski davranışına
  // düşer: varsayılan 7 gün, "yeni eşiklerden beri" seçeneği hiç görünmez.
  const epoch = await getLatestConfigEpoch();

  const requested = ALARM_RANGES.includes(sp.range as AlarmRange)
    ? (sp.range as AlarmRange)
    : null;
  // VARSAYILAN: eşik sınırı varsa "yeni eşiklerden beri", yoksa 7 gün.
  const fallback: AlarmRange = epoch ? "epoch" : "7d";
  const requestedRange = requested ?? fallback;
  // URL'de ?range=epoch var ama sınır kaydı yoksa boş sayfa göstermeyiz.
  const range: AlarmRange =
    requestedRange === "epoch" && !epoch ? "7d" : requestedRange;

  const { start, end } = computeRange(range, epoch);
  // Nokta-olaylar (vehicle_events — artık idling YOK) + rölanti EPİZODLARI
  // (idle_episodes, migration 024). İkisi tek listeye birleşir; idling satırları
  // epizoddan gelir (süre taşır), diğerleri olduğu gibi.
  // 90 günlük yoğunluk şeridi (Zendesk deseni) 27.07.2026'da İPTAL edildi —
  // listEventDensity çağrısı ve stripStart penceresi buradan kalktı.
  // Araç künyesi KALIYOR: alarm satırlarında şoför adı ondan geliyor.
  const [events, episodes, vehicles] = await Promise.all([
    listEventsInRange(start.toISOString(), end.toISOString()),
    listIdleEpisodesInRange(start.toISOString(), end.toISOString()),
    listVehiclesWithStatus(),
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

  // ── DÖNEM TRENDİ (27.07.2026, Volkan kararı) ────────────────────────────
  // Analiz'deki tip-dağılımı grafiği KALDIRILMADI (Volkan: "Analiz'e dokunma").
  // Trend BURAYA eklendi: Alarmlar'ın yapabildiği ama Analiz'in yapamadığı şey
  // "zaman içinde ne oldu" — gün gün, önceki eşit uzunluktaki dönemle birlikte.
  //
  // Önceki dönem aynı UZUNLUKTA ve hemen öncesi. Eşik sınırını aşıyorsa
  // karşılaştırma YAPILMAZ (aynı gerekçe: düzelen sürüş değil, cetvel).
  const spanMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  const trendCrossesEpoch = comparisonCrossesEpoch(start, end, prevStart, prevEnd, epoch);
  const [prevEvents, prevEpisodes] = trendCrossesEpoch
    ? [[], []]
    : await Promise.all([
        listEventsInRange(prevStart.toISOString(), prevEnd.toISOString()),
        listIdleEpisodesInRange(prevStart.toISOString(), prevEnd.toISOString()),
      ]);

  const trend = buildAlarmTrend(
    { events, episodes, start, end },
    trendCrossesEpoch ? null : { events: prevEvents, episodes: prevEpisodes }
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
        <AlarmsClient
          events={rows}
          /* ŞOFÖR ADI (27.07.2026): `driver_name` açık vardiyadaki şoför, yoksa
             araca ATANMIŞ şoför — raporların kullandığı kaynağın AYNISI
             (lib/reports.ts assigned_worker_id). Alarmlar ile raporlar aynı
             kişiyi söylemek zorunda. Geçmişe dönük kusuru bilinçli kabul
             edildi: araç el değiştirdiyse eski olay bugünkü şoförle
             etiketlenir; tarihsel atama kaydı veritabanında YOK. Ekranda
             adın yanındaki ipucu bunu yazıyor. */
          vehicles={vehicles.map((v) => ({
            id: v.id,
            plate: v.plate,
            driverName: v.driver_name,
          }))}
          range={range}
          trend={trend}
          /* Uyarı KOŞULU tek yerde: görüntülenen aralık sınırdan önce
             başlıyorsa. "epoch" aralığında start === sınır olduğu için uyarı
             hiç çıkmaz; "bugün" seçildiğinde ise gün sınırdan önce başladığı
             için ÇIKAR — doğru davranış, o günün ilk saatleri eski eşikte. */
          epochISO={epoch ? epoch.changedAt.toISOString() : null}
          showEpochWarning={rangeStartsBeforeEpoch(start, epoch)}
        />
      </div>
    </DashboardShell>
  );
}
