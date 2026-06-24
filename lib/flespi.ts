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
  /** ISO string derived from the device RTC `timestamp`. */
  recorded_at: string;
  /** Raw epoch-seconds device timestamp (used for the polling cursor). */
  flespi_timestamp: number;
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

function normalize(
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

  return {
    flespi_device_id: deviceId,
    latitude: lat,
    longitude: lng,
    speed_kmh: num(pick(msg, "position.speed")),
    heading: heading === null ? null : Math.round(heading),
    ignition_on: ignition,
    recorded_at: new Date(ts * 1000).toISOString(),
    flespi_timestamp: ts,
  };
}

/**
 * Fetch and normalize messages for one device. When `sinceTs` (epoch seconds)
 * is given, only messages at/after it are requested (`data.from`), keeping each
 * poll small. Returns chronological, position-bearing points.
 */
export async function fetchDeviceMessages(
  deviceId: number,
  sinceTs?: number
): Promise<FlespiPoint[]> {
  // reverse:false → oldest-first, so the cursor advances forward and a capped
  // poll drains a backlog over successive ticks. [VARSAYIM] confirm ordering +
  // that `count` caps the result on the real device.
  const data: Record<string, unknown> = { reverse: false, count: MAX_PER_POLL };
  if (sinceTs && Number.isFinite(sinceTs)) data.from = sinceTs;

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
  for (const m of rows) {
    const p = normalize(deviceId, m);
    if (p) points.push(p);
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

  return points;
}
