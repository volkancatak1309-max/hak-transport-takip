import type { TelemetryRow } from "@/lib/telemetry";

/**
 * GPS-derived distance travelled from raw position telemetry — the "mileage"
 * flespi's paid analytics tier computes server-side, derived here from raw
 * lat/lng + time. This is SEPARATE from the manually-entered odometer km
 * (shifts.start_km/end_km, fuel_expenses.odometer_km) and never mixes with it.
 *
 * Method: sum the haversine chord between consecutive points, with three guards
 * so a parked or glitching tracker can't fabricate kilometres:
 *  - drop chords shorter than D_MIN_M (park drift / GPS jitter);
 *  - drop segments whose implied speed exceeds V_MAX_KMH (GPS spike / teleport);
 *  - never bridge a silence longer than GAP_MAX_MS (device offline — we cannot
 *    know where it went, so we under-count rather than invent a straight line).
 * Pure & deterministic: same input → same output, no clock/IO.
 *
 * Thresholds are fixed but exported so they live in one place and can be tuned
 * (and asserted in tests).
 */

/** Chords shorter than this are treated as drift/jitter, not travel (metres). */
export const D_MIN_M = 10;
/** Implied speed above this marks a GPS spike/teleport — segment dropped (km/h). */
export const V_MAX_KMH = 160;
/** Silences longer than this are data gaps — no chord drawn across them (ms). */
export const GAP_MAX_MS = 10 * 60 * 1000; // 10 dk

const EARTH_R_M = 6_371_000;

export type DistanceResult = {
  /** Total travelled distance, kilometres (meters / 1000). */
  km: number;
  /** Total travelled distance, metres. */
  meters: number;
  /** Telemetry points considered. 0 → no data to compute from (show "no data"). */
  points: number;
  /** Segments dropped as data gaps (dt > GAP_MAX_MS). */
  gapCount: number;
  /** Segments dropped as GPS spikes (implied speed > V_MAX_KMH). */
  spikeCount: number;
  /** Segments dropped as drift/jitter (chord < D_MIN_M). */
  jitterCount: number;
  /** True when a data gap was skipped — the total may UNDER-count real travel. */
  uncertain: boolean;
};

/** Great-circle distance between two lat/lng points, in metres. */
function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const dφ = toRad(bLat - aLat);
  const dλ = toRad(bLng - aLng);
  const s =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Compute GPS distance over a telemetry series. Expects `track` sorted by
 * recorded_at ascending (as listVehicleTrack returns it); out-of-order or
 * duplicate timestamps (dt ≤ 0) are skipped defensively.
 */
export function computeDistanceKm(track: TelemetryRow[]): DistanceResult {
  let meters = 0;
  let gapCount = 0;
  let spikeCount = 0;
  let jitterCount = 0;

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    const dt =
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();

    if (!Number.isFinite(dt) || dt <= 0) continue; // bad ordering / duplicate ts
    if (dt > GAP_MAX_MS) {
      // Device offline across this interval — don't fabricate a straight line.
      gapCount++;
      continue;
    }

    const d = haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
    if (!Number.isFinite(d)) continue;
    if (d < D_MIN_M) {
      jitterCount++; // parked drift / GPS noise — not real movement
      continue;
    }
    const impliedKmh = d / 1000 / (dt / 3_600_000);
    if (impliedKmh > V_MAX_KMH) {
      spikeCount++; // implausible jump — GPS spike/teleport
      continue;
    }
    meters += d;
  }

  return {
    km: meters / 1000,
    meters,
    points: track.length,
    gapCount,
    spikeCount,
    jitterCount,
    uncertain: gapCount > 0,
  };
}
