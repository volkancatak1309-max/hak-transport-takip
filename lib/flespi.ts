import "server-only";

/**
 * flespi.io REST client for pulling Teltonika device messages.
 *
 * flespi normalizes raw Teltonika protocol into messages exposed at
 *   GET https://flespi.io/gw/devices/{id}/messages
 * authenticated with the header `Authorization: FlespiToken <token>`.
 *
 * [VARSAYIM] The exact field names below follow flespi's documented Teltonika
 * normalization (position.latitude/longitude/speed/direction, timestamp,
 * engine.ignition.status). The REST response usually carries FLATTENED dotted
 * keys (e.g. "position.latitude"); some setups nest them ({"position": {...}}).
 * `pick()` handles both. Confirm against the real test device (test-arac-1) and
 * adjust the field names here if the payload differs — this is the single place
 * that knows flespi's wire shape.
 */

const FLESPI_BASE = "https://flespi.io";

// Tolerate small device-clock skew; reject anything further in the future.
const FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 min
// 2000-01-01 epoch seconds — anything older is a bogus RTC, not a real fix.
const YEAR_2000_TS = 946684800;
// Hard cap on messages pulled per device per poll, so a backlog after cron
// downtime drains over several ticks instead of one unbounded request.
const MAX_PER_POLL = 1000;

export type FlespiPoint = {
  flespi_device_id: number;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition_on: boolean | null;
  /** OBD/CAN fuel level in percent (0..100), or null if the device omits it. */
  fuel_level_pct: number | null;
  /**
   * can.fuel.volume — depodaki yakıt HACMİ (litre), HAM. 27.07.2026'da eklendi:
   * filodaki 6 VW Crafter yüzdeyi HİÇ göndermiyor, yalnız hacmi gönderiyor ve
   * o araçlarda sinyal temiz. Dönüştürme YOK — litre litre olarak saklanır;
   * tank_capacity_l ile yüzdeye çevirmek YASAK, çünkü hem yüzde hem hacim
   * gönderen araçlarda hacim çöp (bkz. db/migrations/039_fuel_volume.sql).
   */
  fuel_volume_l: number | null;
  /** OBD/CAN total vehicle odometer, or null if the device omits it. */
  odometer_km: number | null;
  // Extended CAN/OBD (migration 021). Present only while the engine ECU is on the
  // CAN bus (~45% of DO-992GO messages), so ANY of these may be null on a fix.
  engine_rpm: number | null;
  engine_load_pct: number | null;
  coolant_temp_c: number | null;
  fuel_consumption: number | null;
  power_voltage: number | null;
  battery_voltage: number | null;
  gsm_signal: number | null;
  altitude_m: number | null;
  satellites: number | null;
  /** can.dtc.number — count of active fault codes on this frame, or null. */
  dtc_number: number | null;
  /** Device-reported VIN (vehicle.vin), or null. Backfilled onto the vehicle. */
  vin: string | null;
  /** ISO string derived from the device RTC `timestamp`. */
  recorded_at: string;
  /** Raw epoch-seconds device timestamp (used for the polling cursor). */
  flespi_timestamp: number;
};

/** One authoritative snapshot of a device's active DTC list (arıza kodları). */
export type FlespiDtcSnapshot = {
  /**
   * true only when the message carries an AUTHORITATIVE active-code snapshot:
   * either the full `can.dtc` list, or an explicit `can.dtc.number === 0`
   * ("no active faults"). Frames that merely omit can.dtc are NOT snapshots and
   * must not clear existing codes — the device only resends the list on change.
   */
  present: boolean;
  codes: { code: string; standard: string | null }[];
  /** ISO string derived from the device RTC `timestamp`. */
  occurred_at: string;
};

/**
 * Tek mesajdan çıkarılan rölanti (idle) okuması — idle_episodes durum makinesinin
 * girdisi (migration 024). `idle` = cihazın idle.status bayrağı (mesajda yoksa
 * null); açık epizod ignition kapanması / hareket ile de kapatılabildiği için
 * ignition_on ve speed_kmh da taşınır.
 */
export type IdleReading = {
  /** Epoch saniye — araç başına kronolojik sıralama + cursor için. */
  ts: number;
  idle: boolean | null;
  ignition_on: boolean | null;
  speed_kmh: number | null;
  latitude: number | null;
  longitude: number | null;
  occurred_at: string;
};

/** Cihazın bildirdiği tek bir sürüş/güvenlik olayı (vehicle_events satırı). */
export type FlespiEvent = {
  /** Kanonik tür: harsh_braking | harsh_acceleration | harsh_cornering |
   *  overspeeding | crash | towing | unplug | idling | jamming */
  event_type: string;
  /** Olaya eşlik eden ham detay (çarpma yönü, viraj açısı, hız), yoksa null. */
  event_value: Record<string, unknown> | null;
  /** Olay anındaki konum — mesajda konum yoksa null (olay yine de kaydedilir). */
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  /** ISO string derived from the device RTC `timestamp`. */
  occurred_at: string;
};

function token(): string {
  const t = process.env.FLESPI_TOKEN;
  if (!t) {
    throw new Error(
      "FLESPI_TOKEN eksik. flespi REST erişimi için .env.local içine eklenmeli."
    );
  }
  return t;
}

/** Read a possibly-flattened ("a.b.c") or nested key from a flespi message. */
function pick(msg: Record<string, unknown>, dotted: string): unknown {
  if (dotted in msg) return msg[dotted];
  let cur: unknown = msg;
  for (const part of dotted.split(".")) {
    if (
      cur &&
      typeof cur === "object" &&
      part in (cur as Record<string, unknown>)
    ) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}

/**
 * Convert one raw flespi message (flattened or nested dotted keys) into a
 * FlespiPoint, or null if it lacks a usable position/timestamp or carries a
 * bogus RTC clock. Shared by both ingest paths: the REST pull (fetchDeviceMessages)
 * and the HTTP-stream push (/api/flespi/ingest). `deviceId` is stamped onto the
 * point as flespi_device_id (the stream path passes the vehicle's device id, or
 * the numeric IMEI when none is set).
 */
export function normalize(
  deviceId: number,
  msg: Record<string, unknown>
): FlespiPoint | null {
  const lat = num(pick(msg, "position.latitude"));
  const lng = num(pick(msg, "position.longitude"));
  const ts = num(pick(msg, "timestamp"));
  if (lat === null || lng === null || ts === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // Reject impossible RTC timestamps. Teltonika devices intermittently report a
  // bad clock on cold start (before a GPS fix). A FUTURE value would poison the
  // polling cursor (next poll's `from` jumps ahead → every correctly-timed
  // message is skipped until wall-clock catches up); a pre-2000 value (e.g. ts
  // sent in ms not s, or 1970) would force an unbounded backfill from `from`.
  const tsMs = ts * 1000;
  if (tsMs > Date.now() + FUTURE_SKEW_MS) return null;
  if (ts < YEAR_2000_TS) return null;

  // Ignition: prefer the normalized engine flag, fall back to the raw digital
  // input 1 that Teltonika commonly wires to ignition.
  const ignition =
    bool(pick(msg, "engine.ignition.status")) ?? bool(pick(msg, "din.1"));
  const heading = num(pick(msg, "position.direction"));

  // [VARSAYIM — gerçek FMC003 gelince flespi panelinden teyit edilecek]
  // FMC003 OBD/CAN telemetrisi (yakıt seviyesi, aracın toplam km'si) flespi
  // tarafında modele/plugin'e göre farklı adlarla gelebilir. Aday alan adlarını
  // sırayla dene, ilk DOLU değeri al; hiçbiri yoksa null bırak (kaydı reddetme).
  // odometer_km cihazın raporladığı değerdir — birimin km olduğu gerçek cihazda
  // doğrulanmalı (bazı kurulumlar metre gönderir).
  // 27.07.2026 flespi doğrulaması: filoda GÖRÜLEN yakıt parametreleri yalnız
  // üç tane — can.fuel.level (yüzde, 23 araç), can.fuel.volume (litre, 17 araç),
  // can.fuel.consumption. `obd.fuel.level` ve `fuel.level` hiç görülmedi ama
  // aday olarak duruyor (başka cihaz tipi eklenirse kırılmasın).
  const fuelLevel =
    num(pick(msg, "can.fuel.level")) ??
    num(pick(msg, "obd.fuel.level")) ??
    num(pick(msg, "fuel.level"));
  // HACİM — ayrı alan, dönüştürülmeden. Yüzdenin yerine GEÇMEZ; ikisi birden
  // gelen araçta ikisi de yazılır, hangisinin kullanılacağına rapor karar verir.
  const fuelVolume =
    num(pick(msg, "can.fuel.volume")) ?? num(pick(msg, "obd.fuel.volume"));
  const odometer =
    num(pick(msg, "can.vehicle.mileage")) ??
    num(pick(msg, "obd.mileage")) ??
    num(pick(msg, "vehicle.mileage.total")) ??
    num(pick(msg, "obd.distance.total"));

  // Extended CAN/OBD (migration 021) — real field names confirmed on DO-992GO.
  // roundInt() keeps values destined for INT columns clean if a device ever
  // sends a fractional reading; the rest stay double precision.
  const roundInt = (n: number | null) => (n === null ? null : Math.round(n));
  const vinRaw = pick(msg, "vehicle.vin");
  const vin =
    typeof vinRaw === "string" && vinRaw.trim() ? vinRaw.trim() : null;

  return {
    flespi_device_id: deviceId,
    latitude: lat,
    longitude: lng,
    speed_kmh: num(pick(msg, "position.speed")),
    heading: heading === null ? null : Math.round(heading),
    ignition_on: ignition,
    fuel_level_pct: fuelLevel,
    fuel_volume_l: fuelVolume,
    odometer_km: odometer,
    engine_rpm: roundInt(num(pick(msg, "can.engine.rpm"))),
    engine_load_pct: num(pick(msg, "can.engine.load.level")),
    coolant_temp_c: num(pick(msg, "can.engine.coolant.temperature")),
    fuel_consumption: num(pick(msg, "can.fuel.consumption")),
    power_voltage: num(pick(msg, "external.powersource.voltage")),
    battery_voltage: num(pick(msg, "battery.voltage")),
    gsm_signal: roundInt(num(pick(msg, "gsm.signal.level"))),
    altitude_m: num(pick(msg, "position.altitude")),
    satellites: roundInt(num(pick(msg, "position.satellites"))),
    dtc_number: roundInt(num(pick(msg, "can.dtc.number"))),
    vin,
    recorded_at: new Date(ts * 1000).toISOString(),
    flespi_timestamp: ts,
  };
}

/**
 * Extract the device's active-DTC snapshot from one message, or null if the
 * message carries no authoritative snapshot. The device sends the full list
 * `can.dtc = [{code, standard}, ...]` only when the set CHANGES; `can.dtc.number`
 * (the count) rides every CAN frame. So a snapshot exists when EITHER the list is
 * present OR the count is explicitly 0. A frame that merely lacks can.dtc is NOT
 * a snapshot (returns null) and must never clear standing codes. Uses the same
 * RTC guards as normalize(). Independent of the GPS/point path.
 */
export function extractDtc(msg: Record<string, unknown>): FlespiDtcSnapshot | null {
  const ts = num(pick(msg, "timestamp"));
  if (ts === null) return null;
  const tsMs = ts * 1000;
  if (tsMs > Date.now() + FUTURE_SKEW_MS) return null;
  if (ts < YEAR_2000_TS) return null;
  const occurred_at = new Date(tsMs).toISOString();

  const raw = pick(msg, "can.dtc");
  const codes = parseDtcList(raw);
  if (codes !== null) {
    return { present: true, codes, occurred_at };
  }

  // Explicit "no active faults" snapshot: count present and zero → clear all.
  if (num(pick(msg, "can.dtc.number")) === 0) {
    return { present: true, codes: [], occurred_at };
  }
  return null;
}

/**
 * Ham can.dtc değerini kod listesine çevirir; değer dizi değilse null.
 * Gerçek cihazda (DO-992GO) doğrulanan şekil: [{code:'P0100',standard:'OBDII'},…]
 * — düz string dizisi de tolere edilir. extractDtc (mesaj yolu) ile
 * fetchLastKnownDtc (telemetry ucu / bekçi yolu) tarafından paylaşılır.
 */
function parseDtcList(
  raw: unknown
): { code: string; standard: string | null }[] | null {
  if (!Array.isArray(raw)) return null;
  const codes: { code: string; standard: string | null }[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const code = rec.code;
      if (typeof code === "string" && code.trim()) {
        codes.push({
          code: code.trim(),
          standard: typeof rec.standard === "string" ? rec.standard : null,
        });
      }
    } else if (typeof item === "string" && item.trim()) {
      codes.push({ code: item.trim(), standard: null });
    }
  }
  return codes;
}

/**
 * Cihazın flespi'de saklı SON BİLİNEN can.dtc listesi (telemetry ucu) —
 * DTC bekçisinin (öz-iyileşme) veri kaynağı. Mesaj akışından farkı: cihaz tam
 * listeyi yalnız liste DEĞİŞİNCE gönderir; deploy/kesinti penceresine denk
 * gelen snapshot mesaj yolundan kaçar ama flespi telemetry'de son değer olarak
 * durur. Bu fonksiyon o değeri normal FlespiDtcSnapshot şekline çevirir
 * (extractDtc ile aynı RTC korumaları), yoksa/geçersizse null döner.
 */
export async function fetchLastKnownDtc(
  deviceId: number
): Promise<FlespiDtcSnapshot | null> {
  const url = `${FLESPI_BASE}/gw/devices/${deviceId}/telemetry/can.dtc`;
  const res = await fetch(url, {
    headers: { Authorization: `FlespiToken ${token()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `flespi device ${deviceId} telemetry HTTP ${res.status}: ${body.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    result?: { telemetry?: Record<string, { value?: unknown; ts?: unknown }> }[];
  };
  const entry = json.result?.[0]?.telemetry?.["can.dtc"];
  const ts = num(entry?.ts);
  if (!entry || ts === null) return null;
  // extractDtc ile aynı RTC korumaları.
  if (ts * 1000 > Date.now() + FUTURE_SKEW_MS) return null;
  if (ts < YEAR_2000_TS) return null;

  const codes = parseDtcList(entry.value);
  if (codes === null) return null;
  return {
    present: true,
    codes,
    occurred_at: new Date(ts * 1000).toISOString(),
  };
}

/**
 * Cihaz mesajındaki olay parametrelerini FlespiEvent listesine çevirir.
 * Konum zorunlu DEĞİL (çarpma/söküm konum fix'i olmadan da gelebilir);
 * yalnızca timestamp geçerliliği aranır (normalize() ile aynı RTC korumaları).
 * Mevcut GPS akışından tamamen bağımsızdır — normalize()'a dokunmaz.
 *
 * Parametre adları flespi dokümanından birebir alındı
 * (https://flespi.com/protocols/teltonika + /devices/teltonika-fmc920):
 *   crash.event (AVL 247) · crash.event.enum · crash.direction.enum (AVL 1430)
 *   harsh.acceleration.event / harsh.braking.event / harsh.cornering.event (AVL 253)
 *   harsh.cornering.angle (AVL 254) · overspeeding.status + overspeeding.speed
 *   geofence.overspeeding.status (AVL 157/248) · idle.status (AVL 177/243/251)
 *   gsm.jamming.alarm.status (AVL 249)
 * [VARSAYIM] towing ve unplug için flespi dokümanında parametre adı BULUNAMADI;
 * aşağıdaki aday adlar gerçek cihaz mesajıyla teyit edilene kadar tahminidir.
 */
export function extractEvents(msg: Record<string, unknown>): FlespiEvent[] {
  const ts = num(pick(msg, "timestamp"));
  if (ts === null) return [];
  const tsMs = ts * 1000;
  if (tsMs > Date.now() + FUTURE_SKEW_MS) return [];
  if (ts < YEAR_2000_TS) return [];

  const lat = num(pick(msg, "position.latitude"));
  const lng = num(pick(msg, "position.longitude"));
  const posOk =
    lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const base = {
    latitude: posOk ? lat : null,
    longitude: posOk ? lng : null,
    speed_kmh: num(pick(msg, "position.speed")),
    occurred_at: new Date(tsMs).toISOString(),
  };

  // truthy bayrak: true / 1 / "1" / "true" → olay var say.
  const flag = (dotted: string) => bool(pick(msg, dotted)) === true;

  const events: FlespiEvent[] = [];

  if (flag("crash.event")) {
    const value: Record<string, unknown> = {};
    const reason = pick(msg, "crash.event.enum");
    const direction = pick(msg, "crash.direction.enum");
    if (reason !== undefined && reason !== null) value.reason = reason;
    if (direction !== undefined && direction !== null) value.direction = direction;
    events.push({
      event_type: "crash",
      event_value: Object.keys(value).length > 0 ? value : null,
      ...base,
    });
  }
  if (flag("harsh.acceleration.event")) {
    events.push({ event_type: "harsh_acceleration", event_value: null, ...base });
  }
  if (flag("harsh.braking.event")) {
    events.push({ event_type: "harsh_braking", event_value: null, ...base });
  }
  if (flag("harsh.cornering.event")) {
    const angle = num(pick(msg, "harsh.cornering.angle"));
    events.push({
      event_type: "harsh_cornering",
      event_value: angle === null ? null : { angle },
      ...base,
    });
  }
  if (flag("overspeeding.status") || flag("geofence.overspeeding.status")) {
    const speed = num(pick(msg, "overspeeding.speed"));
    events.push({
      event_type: "overspeeding",
      event_value: speed === null ? null : { speed },
      ...base,
    });
  }
  // NOT: idling ARTIK burada üretilmez. Cihazın idle.status bayrağı "şu an
  // rölantide" durumudur ve rölanti sürdükçe her periyodik kayıtta tekrar gelir →
  // eski model 25 dk'lık tek rölantiyi 5 ayrı ping-olayına bölüyordu, süre yoktu.
  // Yeni model (migration 024): idle.status geçişleri extractIdle + saveIdleEpisodes
  // ile bir EPİZODA (başlangıç→bitiş→süre) toplanır. Diğer olay tipleri değişmedi.
  if (flag("gsm.jamming.alarm.status")) {
    events.push({ event_type: "jamming", event_value: null, ...base });
  }
  // [VARSAYIM] Dokümanda bulunamayan aday adlar — gerçek cihazla teyit edilecek.
  if (flag("towing.event") || flag("towing.status") || flag("towing.detection.status")) {
    events.push({ event_type: "towing", event_value: null, ...base });
  }
  if (flag("unplug.event") || flag("unplug.status") || flag("battery.unplug.status")) {
    events.push({ event_type: "unplug", event_value: null, ...base });
  }

  return events;
}

/**
 * Tek mesajdan rölanti durum-makinesi okuması çıkarır (migration 024). Yalnızca
 * DURUMU DEĞİŞTİREBİLECEK mesajları döndürür — geri kalan GPS frame'leri null:
 *   - idle.status açıkça true/false → epizod aç/sürdür veya kapat
 *   - idle.status yok ama ignition=false → açık epizodu 'ignition_off' ile kapat
 *   - idle.status yok ama hız ≥ eşik → açık epizodu 'moving' ile kapat
 *   - hiçbiri (rölanti bayrağı yok, motor açık, duruyor) → null (no-op frame)
 * idle.status doğrudan cihazın kararı olduğu için (eşik cihazda), true iken
 * hız/ignition çelişkisine BAKMAYIZ. normalize() ile aynı RTC korumaları.
 */
export function extractIdle(msg: Record<string, unknown>): IdleReading | null {
  const ts = num(pick(msg, "timestamp"));
  if (ts === null) return null;
  const tsMs = ts * 1000;
  if (tsMs > Date.now() + FUTURE_SKEW_MS) return null;
  if (ts < YEAR_2000_TS) return null;

  const idleRaw = pick(msg, "idle.status");
  const idle = idleRaw === undefined ? null : bool(idleRaw);
  const ignition =
    bool(pick(msg, "engine.ignition.status")) ?? bool(pick(msg, "din.1"));
  const speed = num(pick(msg, "position.speed"));

  // Aksiyon üretmeyecek frame'i erken ele (hacmi düşür): rölanti bayrağı yok,
  // motor kapalı DEĞİL ve hareket sinyali yok.
  const canClose = ignition === false || (speed !== null && speed >= 3);
  if (idle === null && !canClose) return null;

  const lat = num(pick(msg, "position.latitude"));
  const lng = num(pick(msg, "position.longitude"));
  const posOk =
    lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  return {
    ts,
    idle,
    ignition_on: ignition,
    speed_kmh: speed,
    latitude: posOk ? lat : null,
    longitude: posOk ? lng : null,
    occurred_at: new Date(tsMs).toISOString(),
  };
}

/**
 * Fetch and normalize messages for one device. When `sinceTs` (epoch seconds)
 * is given, only messages at/after it are requested (`data.from`), keeping each
 * poll small. Returns chronological, position-bearing points plus any device
 * events + idle readings found in the same messages (both may exist without a
 * position fix).
 */
export async function fetchDeviceMessages(
  deviceId: number,
  sinceTs?: number,
  untilTs?: number
): Promise<{
  points: FlespiPoint[];
  events: FlespiEvent[];
  dtc: FlespiDtcSnapshot[];
  idle: IdleReading[];
}> {
  // reverse:false → oldest-first, so the cursor advances forward and a capped
  // poll drains a backlog over successive ticks. [VARSAYIM] confirm ordering +
  // that `count` caps the result on the real device.
  const data: Record<string, unknown> = { reverse: false, count: MAX_PER_POLL };
  if (sinceTs && Number.isFinite(sinceTs)) data.from = sinceTs;
  // ÜST SINIR — YALNIZ GEÇMİŞ DOLGUSU İÇİN (07.08.2026, lib/backfill.ts).
  // Canlı senkron bu argümanı HİÇ vermez; verilmediğinde `data` nesnesi
  // eskisiyle bayt bayt aynı kalır, dolayısıyla üretilen URL de aynıdır.
  // Dolgu ise pencereyi kapatmak zorunda: `to` olmadan sayfalama son sayfada
  // canlı akışa taşar ve nerede duracağını bilemezdi.
  if (untilTs && Number.isFinite(untilTs)) data.to = untilTs;

  const url =
    `${FLESPI_BASE}/gw/devices/${deviceId}/messages` +
    `?data=${encodeURIComponent(JSON.stringify(data))}`;

  const res = await fetch(url, {
    headers: { Authorization: `FlespiToken ${token()}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `flespi device ${deviceId} messages HTTP ${res.status}: ${body.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as { result?: Record<string, unknown>[] };
  const rows = json.result ?? [];

  const points: FlespiPoint[] = [];
  const events: FlespiEvent[] = [];
  const dtc: FlespiDtcSnapshot[] = [];
  const idle: IdleReading[] = [];
  for (const m of rows) {
    const p = normalize(deviceId, m);
    if (p) points.push(p);
    events.push(...extractEvents(m));
    const d = extractDtc(m);
    if (d) dtc.push(d);
    const ir = extractIdle(m);
    if (ir) idle.push(ir);
  }

  // Surface a field-name mismatch instead of a silent "0 saved": if flespi
  // returned messages but NONE carried the position/timestamp keys we expect,
  // log a sample of the actual keys so the mapping in `pick()` can be fixed.
  if (points.length === 0 && rows.length > 0) {
    console.warn(
      `[flespi] device ${deviceId}: ${rows.length} mesaj alındı ama hiçbiri ` +
        `konuma çözülmedi — beklenen alan adları (position.latitude / timestamp ` +
        `vb.) eşleşmiyor olabilir. Örnek anahtarlar: ` +
        Object.keys(rows[0]).slice(0, 30).join(", ")
    );
  }

  return { points, events, dtc, idle };
}
