import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { FlespiDtcSnapshot, FlespiEvent, FlespiPoint } from "@/lib/flespi";
import type { ActiveVehicle } from "@/lib/types";

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

  const { data, error } = await supabaseAdmin
    .from("device_telemetry")
    .upsert(rows, {
      onConflict: "vehicle_id,recorded_at",
      ignoreDuplicates: true,
    })
    .select("id");

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
  const rows = (data ?? []) as VehicleEventRow[];
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
 * has never reported (no row in device_telemetry). Unlike
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
 * Latest position per vehicle within a recency window, joined with the plate —
 * the live-map vehicle layer. Stale/offline vehicles (no ping in the window)
 * drop off, mirroring how the driver layer hides old pings. Degrades to an empty
 * list if the telemetry table doesn't exist yet (migrations not run).
 */
export async function listLatestVehiclePositions(
  windowMs: number
): Promise<ActiveVehicle[]> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select(
      "vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at"
    )
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  const rows = (data ?? []) as TelemetryRow[];
  if (rows.length === 0) return [];

  // Rows are newest-first, so the first seen per vehicle is its latest.
  const latest = new Map<string, TelemetryRow>();
  for (const r of rows) {
    if (!latest.has(r.vehicle_id)) latest.set(r.vehicle_id, r);
  }

  const ids = [...latest.keys()];
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .in("id", ids);
  const plates = new Map(
    ((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate])
  );

  const out: ActiveVehicle[] = [];
  for (const [id, r] of latest) {
    const plate = plates.get(id);
    if (!plate) continue; // vehicle row vanished — skip orphan telemetry
    out.push({
      vehicle_id: id,
      plate,
      latitude: r.latitude,
      longitude: r.longitude,
      speed_kmh: r.speed_kmh,
      heading: r.heading,
      ignition_on: r.ignition_on,
      recorded_at: r.recorded_at,
    });
  }
  return out;
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
    .select("id, code, standard, first_seen, last_seen")
    .eq("vehicle_id", vehicleId)
    .is("cleared_at", null)
    .order("last_seen", { ascending: false });
  return (data ?? []) as VehicleDtcRow[];
}

/**
 * One-time VIN backfill: set vehicles.vin from a device-reported VIN, but ONLY
 * when it is currently NULL, so a manually-entered value is never overwritten.
 * Throws on DB error — the caller MUST wrap this in its own try/catch.
 */
export async function maybeBackfillVin(
  vehicleId: string,
  vin: string
): Promise<void> {
  await supabaseAdmin
    .from("vehicles")
    .update({ vin })
    .eq("id", vehicleId)
    .is("vin", null);
}
