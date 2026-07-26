import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
  listEventDensity,
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
  type ConfigEpoch,
} from "@/lib/config-epoch";
import { AlarmsClient, type AlarmRow } from "./AlarmsClient";

export const dynamic = "force-dynamic";

/**
 * "epoch" = alarm eşiklerinin son değiştiği andan bugüne (device_config_epochs).
 * Sabit tarih YOK: sınır her zaman tablodan okunur, eşikler tekrar değişirse
 * bu seçenek kendiliğinden yeni sınıra kayar.
 */
export type AlarmRange = "epoch" | "today" | "7d" | "30d";

/** Genel bakış şeridi penceresi (Zendesk 90 gün). */
export const STRIP_DAYS = 90;

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
  // ŞERİT PENCERESİ aralıktan BAĞIMSIZ: genel bakış her zaman son 90 günü
  // gösterir (Zendesk deseni). Aralık filtresi yalnız aşağıdaki listeyi keser —
  // yoksa "bugün" seçildiğinde şerit tek sütuna düşer ve anlamını yitirirdi.
  const stripStart = addCalendarDaysVienna(startOfTodayVienna(), -(STRIP_DAYS - 1));
  const [events, episodes, density, vehicles] = await Promise.all([
    listEventsInRange(start.toISOString(), end.toISOString()),
    listIdleEpisodesInRange(start.toISOString(), end.toISOString()),
    listEventDensity(stripStart.toISOString(), end.toISOString()),
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
          density={density}
          stripDays={STRIP_DAYS}
          vehicles={vehicles.map((v) => ({ id: v.id, plate: v.plate, fleet: v.fleet }))}
          range={range}
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
