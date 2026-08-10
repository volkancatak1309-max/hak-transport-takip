import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { fetchLastKnownDtc } from "@/lib/flespi";
import type {
  FlespiDtcSnapshot,
  FlespiEvent,
  FlespiPoint,
  IdleReading,
} from "@/lib/flespi";
import { IDLE_SPEED_THRESHOLD_KMH, MAX_GAP_MS } from "@/lib/metrics-idle";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { UNRESTRICTED, dropOtherFleets, type FleetScope } from "@/lib/fleet-scope";
import type { ActiveVehicle, VehicleFleet } from "@/lib/types";
import { VIN_BACKFILL_ENABLED } from "@/lib/tenant";

/**
 * Rölanti "aşırı" tetik eşiği (Teltonika param 11205, saniye). Cihaz idle.status
 * bayrağını ancak bu süre geçince kaldırır → epizodun started_at'i fiziksel
 * duruştan bu kadar SONRADIR, yani ham span (ended−started) gerçek rölantiyi
 * bu kadar EKSİK sayar. Ekranda süreye eklenir; DB'ye asla yazılmaz (ham
 * timestamp'ler saklanır).
 *
 * 300 = filoya kendi kurulum komutumuzla basılan değer: 26 cihaza flespi
 * commands-queue üzerinden "setparam 11200:1;11205:300" toplu uygulandı.
 * flespi API'si 11205'i geri OKUTMUYOR (/gw/devices settings yalnız SMS/GPRS/
 * OBD-IO komut ayarlarını veriyor) → tek doğruluk kaynağı bu kurulum komutu.
 * Cihaz yapılandırması (11205) değişirse BU SABİT DE DEĞİŞMELİ. */
export const IDLE_TRIGGER_S = 300;

/**
 * Persistence helpers for vehicle-centric GPS telemetry (device_telemetry).
 * Completely separate from the phone-GPS path (driver_locations / recordLocation),
 * which this module NEVER touches.
 */

/** Newest telemetry instant for a vehicle — the polling cursor for that device. */
export async function lastRecordedAt(vehicleId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select("recorded_at")
    .eq("vehicle_id", vehicleId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.recorded_at ?? null;
}

/**
 * Idempotently write flespi points for one vehicle. The conflict target
 * (vehicle_id, recorded_at) makes re-polling an overlapping window a no-op, so
 * the table never accumulates duplicates. Returns the number of rows written.
 */
export async function saveTelemetry(
  vehicleId: string,
  points: FlespiPoint[]
): Promise<number> {
  if (points.length === 0) return 0;

  // Drop in-batch duplicate timestamps up front (ON CONFLICT DO NOTHING also
  // tolerates them, but this keeps the request smaller).
  const seen = new Set<string>();
  const rows = [];
  for (const p of points) {
    if (seen.has(p.recorded_at)) continue;
    seen.add(p.recorded_at);
    rows.push({
      vehicle_id: vehicleId,
      flespi_device_id: p.flespi_device_id,
      latitude: p.latitude,
      longitude: p.longitude,
      speed_kmh: p.speed_kmh,
      heading: p.heading,
      ignition_on: p.ignition_on,
      fuel_level_pct: p.fuel_level_pct,
      // can.fuel.volume, HAM litre (migration 039). Kolon yoksa aşağıdaki
      // fallback bu alanı düşürüp tekrar dener — telemetri ASLA yeni bir kolon
      // yüzünden kaybolmaz.
      fuel_volume_l: p.fuel_volume_l,
      odometer_km: p.odometer_km,
      // Extended CAN/OBD (migration 021) — null on frames without engine data.
      engine_rpm: p.engine_rpm,
      engine_load_pct: p.engine_load_pct,
      coolant_temp_c: p.coolant_temp_c,
      fuel_consumption: p.fuel_consumption,
      power_voltage: p.power_voltage,
      battery_voltage: p.battery_voltage,
      gsm_signal: p.gsm_signal,
      altitude_m: p.altitude_m,
      satellites: p.satellites,
      dtc_number: p.dtc_number,
      recorded_at: p.recorded_at,
    });
  }

  const upsert = (r: Record<string, unknown>[]) =>
    supabaseAdmin
      .from("device_telemetry")
      .upsert(r, { onConflict: "vehicle_id,recorded_at", ignoreDuplicates: true })
      .select("id");

  let { data, error } = await upsert(rows);
  // 039 uygulanmamış ortam: fuel_volume_l kolonu yok → alanı düşürüp tekrar
  // dene. GPS akışı yeni bir kolon yüzünden durmaz (037/auto-shift deseninin
  // aynısı); yalnız hacim kaydedilmez, diğer her şey yazılır.
  if (error && /fuel_volume_l|column/i.test(error.message)) {
    const stripped = rows.map((r) => {
      const copy: Record<string, unknown> = { ...r };
      delete copy.fuel_volume_l;
      return copy;
    });
    ({ data, error } = await upsert(stripped));
  }

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// ── Araç olayları (vehicle_events, migration 018) ───────────────────────────

/**
 * Tür başına cooldown: aynı araç + aynı türün yeni satırı ancak son YAZILAN
 * kayıttan bu süre geçtiyse yazılır.
 * - Durum-tipi olaylar: cihaz, durum sürdükçe bayrağı HER periyodik kayıtta
 *   tekrar gönderir (örn. 30 dk rölanti = her 30 sn'de bir idle.status=true) → 5 dk.
 * - Anlık olaylar (crash, harsh_*): tek fiziksel olay sensörü art arda
 *   tetikleyip saniyeler arayla onlarca satır üretebiliyor → 60 sn.
 */
const STATE_EVENT_COOLDOWN_MS = 5 * 60 * 1000;
const INSTANT_EVENT_COOLDOWN_MS = 60 * 1000;
const EVENT_COOLDOWN_MS = new Map<string, number>([
  ["overspeeding", STATE_EVENT_COOLDOWN_MS],
  ["idling", STATE_EVENT_COOLDOWN_MS],
  ["jamming", STATE_EVENT_COOLDOWN_MS],
  ["towing", STATE_EVENT_COOLDOWN_MS],
  ["unplug", STATE_EVENT_COOLDOWN_MS],
  ["crash", INSTANT_EVENT_COOLDOWN_MS],
  ["harsh_braking", INSTANT_EVENT_COOLDOWN_MS],
  ["harsh_acceleration", INSTANT_EVENT_COOLDOWN_MS],
  ["harsh_cornering", INSTANT_EVENT_COOLDOWN_MS],
]);

/**
 * Idempotently write device events for one vehicle. The unique index
 * (vehicle_id, event_type, occurred_at) + ON CONFLICT DO NOTHING makes the
 * stream (ingest) and REST poll (sync) delivering the SAME event a no-op.
 * Returns the number of rows written.
 */
export async function saveVehicleEvents(
  vehicleId: string,
  events: FlespiEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  // Kronolojik işle: cooldown karşılaştırması sıraya bağlı.
  const sorted = [...events].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at)
  );

  // Cooldown'lu türler için tür başına son yazılan an: önce DB'deki en yeni
  // kayıt, sonra batch içinde ilerledikçe güncellenir.
  const lastByType = new Map<string, number>();
  const cooldownTypes = [
    ...new Set(
      sorted
        .filter((e) => EVENT_COOLDOWN_MS.has(e.event_type))
        .map((e) => e.event_type)
    ),
  ];
  for (const type of cooldownTypes) {
    const { data } = await supabaseAdmin
      .from("vehicle_events")
      .select("occurred_at")
      .eq("vehicle_id", vehicleId)
      .eq("event_type", type)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.occurred_at) {
      lastByType.set(type, new Date(data.occurred_at).getTime());
    }
  }

  const seen = new Set<string>(); // batch içi birebir (tür+an) tekrarları at
  const rows = [];
  for (const e of sorted) {
    const key = `${e.event_type}|${e.occurred_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cooldownMs = EVENT_COOLDOWN_MS.get(e.event_type);
    if (cooldownMs !== undefined) {
      const t = new Date(e.occurred_at).getTime();
      const last = lastByType.get(e.event_type);
      if (last !== undefined && t - last < cooldownMs) continue;
      lastByType.set(e.event_type, t);
    }
    rows.push({
      vehicle_id: vehicleId,
      event_type: e.event_type,
      event_value: e.event_value,
      latitude: e.latitude,
      longitude: e.longitude,
      speed_kmh: e.speed_kmh,
      occurred_at: e.occurred_at,
    });
  }
  if (rows.length === 0) return 0;

  const { data, error } = await supabaseAdmin
    .from("vehicle_events")
    .upsert(rows, {
      onConflict: "vehicle_id,event_type,occurred_at",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export type VehicleEventRow = {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_value: Record<string, unknown> | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  occurred_at: string;
};

/**
 * Son olaylar — tek araç (araç detay "Son Olaylar" bölümü). Migration 018
 * çalıştırılmamışsa boş listeye düşer (sayfayı asla düşürmez).
 */
export async function listVehicleEvents(
  vehicleId: string,
  limit = 10
): Promise<VehicleEventRow[]> {
  const { data } = await supabaseAdmin
    .from("vehicle_events")
    .select(
      "id, vehicle_id, event_type, event_value, latitude, longitude, speed_kmh, occurred_at"
    )
    .eq("vehicle_id", vehicleId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as VehicleEventRow[];
}

/**
 * TEK ARAÇ + ZAMAN PENCERESİ olayları, eskiden yeniye (vardiya detayı).
 *
 * `listEventsInRange` tüm filoyu tarar; vardiya detayı tek aracın birkaç
 * saatini ister. `vehicle_events`'te `time_entry_id` YOK ve eklenmesi de
 * gerekmiyor: (araç, [başlangıç, bitiş]) penceresi vardiyayı birebir seçer.
 *
 * 1000 SATIR: `fetchAllRows` ile sayfalanır — bir vardiyada onlarca olay olur,
 * ama sessiz kırpma riski hiç doğmasın diye ham `.limit()` yazılmıyor.
 * Migration 018 yoksa boş listeye düşer.
 */
export async function listVehicleEventsInWindow(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<VehicleEventRow[]> {
  const { data } = await fetchAllRows<VehicleEventRow>((from, to) =>
    supabaseAdmin
      .from("vehicle_events")
      .select(
        "id, vehicle_id, event_type, event_value, latitude, longitude, speed_kmh, occurred_at"
      )
      .eq("vehicle_id", vehicleId)
      .gte("occurred_at", startISO)
      .lte("occurred_at", endISO)
      .order("occurred_at", { ascending: true })
      .order("id")
      .range(from, to)
  );
  return data;
}

export type VehicleEventWithPlate = VehicleEventRow & { plate: string };

/**
 * Son olaylar — tüm araçlar, plaka ile (admin /alarmlar listesi). Plaka,
 * listLatestVehiclePositions ile aynı iki-adımlı desenle eklenir. Migration
 * 018 yoksa boş listeye düşer.
 */
export async function listRecentEvents(
  limit = 100
): Promise<VehicleEventWithPlate[]> {
  const { data } = await supabaseAdmin
    .from("vehicle_events")
    .select(
      "id, vehicle_id, event_type, event_value, latitude, longitude, speed_kmh, occurred_at"
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const scope = await getTestScope();
  const rows = dropTestRows(
    (data ?? []) as VehicleEventRow[],
    (r) => ({ vehicle: r.vehicle_id }),
    scope
  );
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.vehicle_id))];
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .in("id", ids);
  const plates = new Map(
    ((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate])
  );
  return rows.map((r) => ({ ...r, plate: plates.get(r.vehicle_id) ?? "—" }));
}

/**
 * Bir tarih aralığındaki TÜM olaylar, plaka ile (admin /alarmlar). 1000 satır
 * tavanını aşmasın diye sonuna kadar sayfalanır (fetchAllRows). Migration 018
 * yoksa boş listeye düşer.
 */
export async function listEventsInRange(
  startISO: string,
  endISO: string
): Promise<VehicleEventWithPlate[]> {
  const { data } = await fetchAllRows<VehicleEventRow>((from, to) =>
    supabaseAdmin
      .from("vehicle_events")
      .select(
        "id, vehicle_id, event_type, event_value, latitude, longitude, speed_kmh, occurred_at"
      )
      .gte("occurred_at", startISO)
      .lte("occurred_at", endISO)
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(from, to)
  );
  const scope = await getTestScope();
  const rows = dropTestRows(data, (r) => ({ vehicle: r.vehicle_id }), scope);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.vehicle_id))];
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .in("id", ids);
  const plates = new Map(
    ((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate])
  );
  return rows.map((r) => ({ ...r, plate: plates.get(r.vehicle_id) ?? "—" }));
}

// ── Rölanti epizodları (idle_episodes, migration 024) ───────────────────────
//
// Cihazın idle.status bayrağı "şu an aşırı rölantide" durumudur ve rölanti
// sürdükçe her periyodik kayıtta tekrar gelir. Eski model (idling nokta-olayı)
// bu yüzden 25 dk'lık TEK rölantiyi 5 ayrı ping-satırına bölüyor, süre
// taşımıyordu. Yeni model bayrak GEÇİŞLERİNİ bir epizoda (başlangıç→bitiş→süre)
// toplar: bir rölanti = TEK satır + gerçek süre. Durum DB'de tutulur (in-memory
// değil) → sunucu/ingest restart'ına dayanır; `uq_idle_open_per_vehicle` (partial
// unique, araç başına tek açık) iki ingest yolunun (stream+poll) yarışını da
// engeller. Saf DB durumu → cooldown/DTC bekçisiyle aynı dayanıklı desen.

type OpenEpisode = { id: string; started_at: string; last_seen_at: string };

async function getOpenEpisode(vehicleId: string): Promise<OpenEpisode | null> {
  const { data } = await supabaseAdmin
    .from("idle_episodes")
    .select("id, started_at, last_seen_at")
    .eq("vehicle_id", vehicleId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data as OpenEpisode) : null;
}

async function latestClosedEndMs(vehicleId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("idle_episodes")
    .select("ended_at")
    .eq("vehicle_id", vehicleId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.ended_at ? new Date(data.ended_at as string).getTime() : null;
}

/**
 * idle.status geçişlerini idle_episodes durum makinesine uygular. Araç başına
 * KRONOLOJİK işlenir; en son epizod sınırından (açık epizodun last_seen'i veya
 * son kapalının ended_at'i) ESKİ mesajlar yok sayılır — poll eski pencereyi
 * yeniden çektiğinde kapalı epizod yeniden açılmasın. Throws on DB error — çağıran
 * KENDİ try/catch'iyle sarmalı, rölanti asla GPS akışını düşürmesin.
 * Dönen: bu batch'te AÇILAN epizod sayısı.
 */
export async function saveIdleEpisodes(
  vehicleId: string,
  readings: IdleReading[]
): Promise<number> {
  if (readings.length === 0) return 0;
  const sorted = [...readings].sort((a, b) => a.ts - b.ts);

  let open = await getOpenEpisode(vehicleId);
  const closedMs = await latestClosedEndMs(vehicleId);
  let cursorMs = Math.max(
    open ? new Date(open.last_seen_at).getTime() : -Infinity,
    closedMs ?? -Infinity
  );

  let opened = 0;
  for (const r of sorted) {
    const tMs = r.ts * 1000;
    if (tMs <= cursorMs) continue; // yeniden teslim / zaten işlenmiş

    if (r.idle === true) {
      if (!open) {
        const { data, error } = await supabaseAdmin
          .from("idle_episodes")
          .insert({
            vehicle_id: vehicleId,
            started_at: r.occurred_at,
            last_seen_at: r.occurred_at,
            latitude: r.latitude,
            longitude: r.longitude,
          })
          .select("id, started_at, last_seen_at")
          .maybeSingle();
        if (error) {
          // Araç başına tek-açık yarışı (23505): mevcut açığı al, sürdür.
          if (error.code === "23505") open = await getOpenEpisode(vehicleId);
          else throw new Error(error.message);
        } else if (data) {
          open = data as OpenEpisode;
          opened++;
        }
      } else {
        // last_seen yalnız ileri gider (out-of-order koruması).
        await supabaseAdmin
          .from("idle_episodes")
          .update({ last_seen_at: r.occurred_at })
          .eq("id", open.id)
          .is("ended_at", null)
          .lt("last_seen_at", r.occurred_at);
        open.last_seen_at = r.occurred_at;
      }
      cursorMs = tMs;
    } else {
      // idle=false (idle_off) / ignition kapalı / hareket → açık epizodu kapat.
      let reason: string | null = null;
      if (r.idle === false) reason = "idle_off";
      else if (r.ignition_on === false) reason = "ignition_off";
      else if (r.speed_kmh !== null && r.speed_kmh >= IDLE_SPEED_THRESHOLD_KMH)
        reason = "moving";
      if (open && reason) {
        await supabaseAdmin
          .from("idle_episodes")
          .update({ ended_at: r.occurred_at, end_reason: reason })
          .eq("id", open.id)
          .is("ended_at", null);
        open = null;
        cursorMs = tMs;
      }
      // açık epizod yoksa yok say
    }
  }
  return opened;
}

/**
 * Bekçi: last_seen_at üstünden MAX_GAP_MS geçmiş AÇIK epizodları kapatır
 * (sinyal kesildi / cihaz kapandı, açık epizod hiç kapanmadı). ended_at =
 * last_seen_at, end_reason='gap_timeout' — GÖZLEMLENMEMİŞ süre asla sayılmaz
 * (computeIdleTime'ın gap mantığıyla birebir). Her sync turunda çağrılır.
 * Dönen: kapatılan epizod sayısı.
 */
export async function reconcileIdleEpisodes(
  nowMs: number = Date.now()
): Promise<number> {
  const cutoff = new Date(nowMs - MAX_GAP_MS).toISOString();
  // SAYFALI (25.07.2026): limitsiz sorgu 1000 satırda sessizce kesiliyordu.
  // Bekçi her turda çalıştığı için fazlası bir sonraki turda kapanırdı, ama
  // "kaç epizod açık kaldı" sayısı yanlış raporlanırdı.
  const { data } = await fetchAllRows<{ id: string; last_seen_at: string }>(
    (from, to) =>
      // test-visible: BAKIM İŞİ, gösterim değil. Bekçi açık kalmış epizodları
      // kapatır; test aracının epizodu elenirse SONSUZA KADAR açık kalır ve
      // "kaç epizod açık" sayısını kalıcı olarak bozar. Gizleme, bu satırların
      // OKUNDUĞU yönetici yüzeylerinde yapılır (listIdleEpisodesInRange).
      supabaseAdmin
        .from("idle_episodes")
        .select("id, last_seen_at")
        .is("ended_at", null)
        .lt("last_seen_at", cutoff)
        .order("id")
        .range(from, to),
    "reconcileIdleEpisodes"
  );
  const rows = data;
  for (const e of rows) {
    await supabaseAdmin
      .from("idle_episodes")
      .update({ ended_at: e.last_seen_at, end_reason: "gap_timeout" })
      .eq("id", e.id)
      .is("ended_at", null);
  }
  return rows.length;
}

export type IdleEpisodeWithPlate = {
  id: string;
  vehicle_id: string;
  plate: string;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string;
  end_reason: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Bir tarih aralığında BAŞLAYAN rölanti epizodları, plaka ile (alarmlar listesi).
 * 1000 satır tavanına karşı sayfalanır. Tablo yoksa (migration 024 uygulanmadıysa)
 * boş listeye düşer — alarmlar sayfasını asla bozmaz.
 */
export async function listIdleEpisodesInRange(
  startISO: string,
  endISO: string
): Promise<IdleEpisodeWithPlate[]> {
  type Row = Omit<IdleEpisodeWithPlate, "plate">;
  const { data } = await fetchAllRows<Row>((from, to) =>
    supabaseAdmin
      .from("idle_episodes")
      .select(
        "id, vehicle_id, started_at, ended_at, last_seen_at, end_reason, latitude, longitude"
      )
      .gte("started_at", startISO)
      .lte("started_at", endISO)
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, to)
  );
  const scope = await getTestScope();
  const rows = dropTestRows(data, (r) => ({ vehicle: r.vehicle_id }), scope);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.vehicle_id))];
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .in("id", ids);
  const plates = new Map(
    ((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate])
  );
  return rows.map((r) => ({ ...r, plate: plates.get(r.vehicle_id) ?? "—" }));
}

/**
 * TEK ARAÇ + ZAMAN PENCERESİNDE BAŞLAYAN rölanti epizodları (vardiya detayı).
 * `listVehicleEventsInWindow` ile aynı gerekçe: `idle_episodes` araç bazlı,
 * `worker_id` YOK; vardiya bağı pencereyle kurulur. Epizod pencereden ÖNCE
 * başlayıp içine sarkıyorsa listeye girmez — alarmlar sayfasının kuralı da bu
 * (`started_at` üstünden aralık), iki yüzey aynı sayıyı basar.
 * Tablo yoksa (024 uygulanmadıysa) boş liste.
 */
export async function listVehicleIdleEpisodesInWindow(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<Omit<IdleEpisodeWithPlate, "plate">[]> {
  type Row = Omit<IdleEpisodeWithPlate, "plate">;
  const { data } = await fetchAllRows<Row>((from, to) =>
    supabaseAdmin
      .from("idle_episodes")
      .select(
        "id, vehicle_id, started_at, ended_at, last_seen_at, end_reason, latitude, longitude"
      )
      .eq("vehicle_id", vehicleId)
      .gte("started_at", startISO)
      .lte("started_at", endISO)
      .order("started_at", { ascending: true })
      .order("id")
      .range(from, to)
  );
  return data;
}

export type TelemetryRow = {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition_on: boolean | null;
  // OBD/CAN fields (migrations 017 + 021). Only latestVehicleTelemetry selects
  // these; the map + track queries omit them (nobody reads fuel/odometer there),
  // so on those rows they are absent — read them only off latestVehicleTelemetry.
  fuel_level_pct: number | null;
  odometer_km: number | null;
  engine_rpm: number | null;
  engine_load_pct: number | null;
  coolant_temp_c: number | null;
  fuel_consumption: number | null;
  power_voltage: number | null;
  battery_voltage: number | null;
  gsm_signal: number | null;
  altitude_m: number | null;
  satellites: number | null;
  dtc_number: number | null;
  recorded_at: string;
};

// CAN/OBD columns that arrive only on engine-ECU frames (~45% of messages), so
// the single newest row is often null for them. latestVehicleTelemetry coalesces
// each to its most-recent non-null value across a small recent window.
const CAN_COALESCE_FIELDS = [
  "speed_kmh",
  "ignition_on",
  "fuel_level_pct",
  "odometer_km",
  "engine_rpm",
  "engine_load_pct",
  "coolant_temp_c",
  "fuel_consumption",
  "power_voltage",
  "battery_voltage",
  "gsm_signal",
  "altitude_m",
  "satellites",
  "dtc_number",
] as const;
const LATEST_COALESCE_WINDOW = 40; // rows scanned back to fill sparse CAN fields

/**
 * The single most-recent telemetry point for ONE vehicle, or null if the device
 * has never reported (no row in device_telemetry). Like
 * listLatestVehiclePositions, there is NO recency window: the vehicle-detail
 * "live position" card shows the last known fix however old, and surfaces its
 * age via recorded_at — so a parked/offline tracker still renders its last
 * position instead of vanishing. Served cheaply by the
 * (vehicle_id, recorded_at) index.
 */
export async function latestVehicleTelemetry(
  vehicleId: string
): Promise<TelemetryRow | null> {
  // Fetch the newest window (not just row 1): position/heading come from the very
  // latest fix, but the sparse CAN/OBD fields (fuel, rpm, coolant, …) are
  // back-filled from the most-recent row that actually reported each — otherwise
  // the detail card shows "—" whenever the newest frame lacked engine data.
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select(
      "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, fuel_level_pct, odometer_km, engine_rpm, engine_load_pct, coolant_temp_c, fuel_consumption, power_voltage, battery_voltage, gsm_signal, altitude_m, satellites, dtc_number, recorded_at"
    )
    .eq("vehicle_id", vehicleId)
    .order("recorded_at", { ascending: false })
    .limit(LATEST_COALESCE_WINDOW);

  const rows = (data ?? []) as TelemetryRow[];
  if (rows.length === 0) return null;

  // Base = newest fix (position, heading, recorded_at come from here as-is).
  const latest: TelemetryRow = { ...rows[0] };
  // For each sparse field, walk forward to the first row that reported it.
  const acc = latest as Record<string, unknown>;
  for (const field of CAN_COALESCE_FIELDS) {
    if (acc[field] !== null && acc[field] !== undefined) continue;
    for (let i = 1; i < rows.length; i++) {
      const v = (rows[i] as Record<string, unknown>)[field];
      if (v !== null && v !== undefined) {
        acc[field] = v;
        break;
      }
    }
  }
  return latest;
}

/**
 * Last known position for EVERY device-equipped vehicle, joined with the plate —
 * the live-map vehicle layer. NO recency window (Reveal behavior): a parked or
 * offline tracker keeps its last fix on the map however old, instead of
 * vanishing when the ignition goes off; the UI derives freshness from
 * recorded_at (normal color vs. faded + "son görülme"). One limit-1 query per
 * vehicle, served by the (vehicle_id, recorded_at) index — never a whole time
 * window of rows. Degrades to an empty list if the telemetry table doesn't
 * exist yet (migrations not run).
 */
export async function listLatestVehiclePositions(
  fleet: FleetScope = UNRESTRICTED
): Promise<ActiveVehicle[]> {
  // "Cihazlı araç" = flespi_device_id VEYA imei dolu — auto-shift ile aynı
  // tanım. IMEI-only araçlar stream ingest üzerinden telemetri üretir
  // (flespi_device_id NULL kalır), onları elemek haritadan düşürürdü.
  const scope = await getTestScope();
  // test-filtered: dropTestRows — harita araç katmanı + panonun "konum
  // göndermiyor" uyarısı. Test aracının cihazı yok, yani bugün zaten bu
  // sorgudan düşüyor; filtre ileride cihaz eklenirse sızmasın diye.
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, fleet")
    .or("flespi_device_id.not.is.null,imei.not.is.null");
  const vehicles = dropOtherFleets(
    dropTestRows(
      (vData ?? []) as {
        id: string;
        plate: string;
        fleet: VehicleFleet;
      }[],
      (v) => ({ vehicle: v.id }),
      scope
    ),
    (v) => ({ vehicle: v.id }),
    fleet
  );
  if (vehicles.length === 0) return [];

  const out = await Promise.all(
    vehicles.map(async (v): Promise<ActiveVehicle | null> => {
      const { data, error } = await supabaseAdmin
        .from("device_telemetry")
        .select(
          "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
        )
        .eq("vehicle_id", v.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Geçici sorgu hatasında aracı bu turda atla ama SESSİZCE değil —
        // yoksa "cihaz hiç veri göndermemiş"ten ayırt edilemez.
        console.error(
          `[telemetry] son-konum sorgusu başarısız vehicle=${v.id}: ${error.message}`
        );
        return null;
      }
      const r = data as TelemetryRow | null;
      if (!r) return null; // device assigned but never reported yet
      return {
        vehicle_id: v.id,
        plate: v.plate,
        fleet: v.fleet,
        latitude: r.latitude,
        longitude: r.longitude,
        speed_kmh: r.speed_kmh,
        heading: r.heading,
        ignition_on: r.ignition_on,
        recorded_at: r.recorded_at,
      };
    })
  );
  return out
    .filter((v): v is ActiveVehicle => v !== null)
    .sort(
      (a, b) =>
        new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );
}

const TRACK_PAGE = 1000; // PostgREST page size; we paginate to defeat any max-rows cap
const TRACK_MAX_PAGES = 100; // hard backstop: ≤100k points per vehicle+range

/**
 * Every telemetry point for ONE vehicle within [from, to], oldest-first.
 *
 * The shared base for ALL device-GPS-derived features — route replay today, and
 * engine-hours / distance / idle / trip-stop metrics later — so it returns the
 * COMPLETE series, never a sampled or silently-capped subset. Results are
 * paginated to defeat PostgREST's per-request row cap (a busy day easily exceeds
 * 1000 fixes); the (vehicle_id, recorded_at) index serves the range scan
 * cheaply. Callers that only need a drawable line should sample afterward.
 */
export async function listVehicleTrack(
  vehicleId: string,
  from: Date | string,
  to: Date | string
): Promise<TelemetryRow[]> {
  const fromIso = typeof from === "string" ? from : from.toISOString();
  const toIso = typeof to === "string" ? to : to.toISOString();

  const rows: TelemetryRow[] = [];
  for (let page = 0; page < TRACK_MAX_PAGES; page++) {
    const offset = page * TRACK_PAGE;
    const { data, error } = await supabaseAdmin
      .from("device_telemetry")
      .select(
        "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
      )
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", fromIso)
      .lte("recorded_at", toIso)
      .order("recorded_at", { ascending: true })
      .range(offset, offset + TRACK_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as TelemetryRow[];
    rows.push(...batch);
    if (batch.length < TRACK_PAGE) break;
  }
  return rows;
}

// ── Arıza kodları (vehicle_dtc, migration 021) ──────────────────────────────

export type VehicleDtcRow = {
  id: string;
  code: string;
  standard: string | null;
  first_seen: string;
  last_seen: string;
  /** Araç km'si arıza İLK görüldüğünde (migration 022) — cihaz o an km
   *  raporlamadıysa null. UI "o günden beri Y km" rozetini bundan türetir. */
  first_seen_odometer_km: number | null;
};

type ActiveDtc = { id: string; code: string; last_seen: string };

/**
 * Reconcile a device's active DTC list against `vehicle_dtc` from the snapshots
 * found in a poll/stream batch. Each snapshot (see extractDtc) is authoritative:
 * codes it lists are upserted as active, active codes it omits are marked
 * cleared. Snapshots are applied chronologically so the newest wins. Idempotent:
 * re-applying the same snapshot only bumps last_seen. Throws on DB error — the
 * caller MUST wrap this in its own try/catch so DTC never drops the GPS flow.
 */
export async function saveDtc(
  vehicleId: string,
  snapshots: FlespiDtcSnapshot[]
): Promise<number> {
  const snaps = snapshots
    .filter((s) => s.present)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (snaps.length === 0) return 0;

  // Aracın güncel km'si (yeni arıza satırının first_seen_odometer_km değeri,
  // migration 022). Yalnız gerçekten YENİ bir kod eklenirken, çağrı başına en
  // fazla bir kez sorgulanır. saveTelemetry bu batch'in noktalarını saveDtc'den
  // ÖNCE yazdığı için en güncel km zaten DB'de. Cihaz hiç km raporlamadıysa null.
  let odoFetched = false;
  let currentOdo: number | null = null;
  const currentOdometerKm = async (): Promise<number | null> => {
    if (!odoFetched) {
      odoFetched = true;
      const { data } = await supabaseAdmin
        .from("device_telemetry")
        .select("odometer_km")
        .eq("vehicle_id", vehicleId)
        .not("odometer_km", "is", null)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      currentOdo = (data?.odometer_km as number | null) ?? null;
    }
    return currentOdo;
  };

  let written = 0;
  for (const snap of snaps) {
    const at = snap.occurred_at;
    const { data } = await supabaseAdmin
      .from("vehicle_dtc")
      .select("id, code, last_seen")
      .eq("vehicle_id", vehicleId)
      .is("cleared_at", null);
    const active = new Map(
      ((data ?? []) as ActiveDtc[]).map((r) => [r.code, r])
    );
    const wanted = new Set(snap.codes.map((c) => c.code));

    for (const c of snap.codes) {
      const ex = active.get(c.code);
      if (ex) {
        if (new Date(at).getTime() > new Date(ex.last_seen).getTime()) {
          await supabaseAdmin
            .from("vehicle_dtc")
            .update({ last_seen: at })
            .eq("id", ex.id);
        }
      } else {
        const { error } = await supabaseAdmin.from("vehicle_dtc").insert({
          vehicle_id: vehicleId,
          code: c.code,
          standard: c.standard,
          first_seen: at,
          last_seen: at,
          first_seen_odometer_km: await currentOdometerKm(),
        });
        // A concurrent insert of the same active code trips the partial-unique
        // index; that's fine (already recorded) — don't fail the whole batch.
        if (!error) written++;
      }
    }

    // Codes previously active but absent from this fresh snapshot → cleared.
    for (const [code, ex] of active) {
      if (!wanted.has(code)) {
        await supabaseAdmin
          .from("vehicle_dtc")
          .update({ cleared_at: at })
          .eq("id", ex.id);
      }
    }
  }
  return written;
}

/**
 * Active (uncleared) DTCs for one vehicle, newest-first — the detail "arıza
 * kodları" card. Degrades to an empty list if the table doesn't exist yet
 * (migration 021 not run), so the page never breaks.
 */
export async function listActiveDtc(
  vehicleId: string
): Promise<VehicleDtcRow[]> {
  const { data } = await supabaseAdmin
    .from("vehicle_dtc")
    .select("id, code, standard, first_seen, last_seen, first_seen_odometer_km")
    .eq("vehicle_id", vehicleId)
    .is("cleared_at", null)
    .order("last_seen", { ascending: false });
  return (data ?? []) as VehicleDtcRow[];
}

/** Filo geneli arıza özeti — araç başına aktif kod sayısı + en uzun süredir
 *  açık kod. ŞİDDET YOK: `vehicle_dtc`'de severity kolonu, `dtc-codes.ts`
 *  sözlüğünde de karşılaştırılabilir bir seviye alanı yok (yalnız düz metin
 *  `risk` açıklaması). "En kritik kod" uydurmak yerine gerçek veriden türeyen
 *  en güçlü aciliyet sinyalini veriyoruz: en eski `first_seen` = en uzun
 *  ihmal edilmiş arıza. */
export type FleetDtcVehicle = {
  vehicle_id: string;
  count: number;
  oldest: { code: string; first_seen: string } | null;
  /** Aktif kodların kendisi, first_seen ARTAN (en eski/en ihmal edilmiş önce).
   *  Sorgu zaten satır satır okuyordu; 10.08.2026'ya kadar toplarken atılıyordu
   *  — mobil "Arızalı Araçlar" dökümü için artık taşınıyor. */
  codes: { code: string; first_seen: string }[];
};

/**
 * Tüm filodaki aktif (temizlenmemiş) arızalar, araca göre gruplanmış. Tablo
 * yoksa (migration 021 uygulanmadıysa) boş liste döner — dashboard bozulmaz.
 */
export async function listFleetActiveDtc(): Promise<FleetDtcVehicle[]> {
  const { data } = await fetchAllRows<{
    vehicle_id: string;
    code: string;
    first_seen: string;
  }>((from, to) =>
    supabaseAdmin
      .from("vehicle_dtc")
      .select("vehicle_id, code, first_seen")
      .is("cleared_at", null)
      .order("id")
      .range(from, to)
  );

  const byVehicle = new Map<string, FleetDtcVehicle>();
  for (const r of data) {
    let row = byVehicle.get(r.vehicle_id);
    if (!row) {
      row = { vehicle_id: r.vehicle_id, count: 0, oldest: null, codes: [] };
      byVehicle.set(r.vehicle_id, row);
    }
    row.count++;
    row.codes.push({ code: r.code, first_seen: r.first_seen });
    if (
      !row.oldest ||
      new Date(r.first_seen).getTime() < new Date(row.oldest.first_seen).getTime()
    ) {
      row.oldest = { code: r.code, first_seen: r.first_seen };
    }
  }
  // Kod listesi en eski önce — `oldest` her zaman listenin başıdır; tavan
  // uygulanırsa (mobil, araç başına 10) en uzun ihmal edilenler listede kalır.
  for (const row of byVehicle.values()) {
    row.codes.sort(
      (a, b) =>
        new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime()
    );
  }
  // En çok arızası olan araç önce; eşitlikte en eski arıza öne.
  return [...byVehicle.values()].sort(
    (a, b) =>
      b.count - a.count ||
      new Date(a.oldest?.first_seen ?? 0).getTime() -
        new Date(b.oldest?.first_seen ?? 0).getTime()
  );
}

/**
 * DTC bekçisi (öz-iyileşme). Sorunu çözdüğü sınıf: cihaz tam can.dtc listesini
 * yalnız liste DEĞİŞİNCE gönderir; deploy penceresi / cron kesintisi / cihaz
 * reboot'u o tek snapshot'ı kaçırırsa vehicle_dtc süresiz boş/eksik kalır
 * (canlıda yaşandı: 2026-07-13, DO-992GO — snapshot 15:39'da, DTC kodu 17:10'da
 * deploy oldu). can.dtc.number ise her CAN frame'inde akar; sayı ile aktif satır
 * sayısı uyuşmuyorsa flespi'nin telemetry ucundaki son bilinen listeyi çekip
 * normal snapshot gibi saveDtc'ye verir.
 *
 * Korumalar:
 * - dtcNumber null/0 → hiç çalışmaz (0'ı zaten mesaj yolu explicit-zero
 *   snapshot olarak işler).
 * - Sayı zaten uyuşuyorsa → hiç çalışmaz (flespi'ye istek yok).
 * - Telemetry snapshot'ı tablodaki EN YENİ last_seen'den yeni değilse →
 *   uygulanmaz. Bu, "sayı değişti ama liste henüz gelmedi" (örn. 3. arıza
 *   eklendi, liste hâlâ eski) durumunda bayat listeyi tekrar tekrar işleyip
 *   taze kayıtları geriye çekmeyi engeller.
 *
 * Throws on DB/flespi error — the caller MUST wrap this in its own try/catch
 * so the watchdog can never drop the GPS flow.
 */
export async function reconcileDtc(
  vehicleId: string,
  flespiDeviceId: number,
  dtcNumber: number | null
): Promise<number> {
  if (dtcNumber === null || dtcNumber <= 0) return 0;

  const { count } = await supabaseAdmin
    .from("vehicle_dtc")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId)
    .is("cleared_at", null);
  if ((count ?? 0) === dtcNumber) return 0;

  const snap = await fetchLastKnownDtc(flespiDeviceId);
  if (!snap || snap.codes.length === 0) return 0;

  // Bayat snapshot koruması: tablodaki en yeni last_seen'den (temizlenmiş
  // satırlar dahil) yeni olmayan liste uygulanmaz.
  const { data: newest } = await supabaseAdmin
    .from("vehicle_dtc")
    .select("last_seen")
    .eq("vehicle_id", vehicleId)
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    newest?.last_seen &&
    new Date(snap.occurred_at).getTime() <=
      new Date(newest.last_seen as string).getTime()
  ) {
    return 0;
  }

  return saveDtc(vehicleId, [snap]);
}

/**
 * One-time VIN backfill: set vehicles.vin from a device-reported VIN, but ONLY
 * when it is currently NULL, so a manually-entered value is never overwritten.
 * Throws on DB error — the caller MUST wrap this in its own try/catch.
 *
 * ── KİMLİĞİ MASKELENMİŞ KURULUMDA YAZMAZ (07.08.2026) ──────────────────────
 * Kapı fonksiyonun İÇİNDE, çağıranlarda değil: iki çağıran var
 * (/api/flespi/sync ve /api/flespi/ingest) ve birine kapı koyup diğerini
 * unutmak sızıntının tam kendisi olurdu. İleride üçüncü bir çağıran eklenirse
 * o da kendiliğinden korunur.
 *
 * Neden gerekli: galzura-demo GERÇEK cihazları okuyor ama plaka/şoför/VIN
 * takma. VIN'i tohumda boş bırakmak YETMEZ — cihaz `vehicle.vin` bildirdiği
 * için ilk sync turunda gerçek VIN buraya düşer ve maskeleme sessizce çöker.
 * VIN_BACKFILL_ENABLED maskelenmemiş kurulumda `true`, yani HAK61 ve
 * Sendigo'da davranış değişmedi (bkz. lib/tenant.ts).
 */
export async function maybeBackfillVin(
  vehicleId: string,
  vin: string
): Promise<void> {
  if (!VIN_BACKFILL_ENABLED) return;
  await supabaseAdmin
    .from("vehicles")
    .update({ vin })
    .eq("id", vehicleId)
    .is("vin", null);
}

// listEventDensity / EventDensityCell — 90 günlük Zendesk yoğunluk şeridinin
// veri kaynağıydı; şerit 27.07.2026'da iptal edilince tek tüketicisi kalmadı
// ve buradan kaldırıldı (git: f160074…c5c206f). fetchAllRows sayfalaması bu
// dosyada başka altı çağrıda YAŞIYOR — PostgREST 1000 satır tavanı kuralı
// yürürlükte, ham `.limit()` hâlâ yasak.
