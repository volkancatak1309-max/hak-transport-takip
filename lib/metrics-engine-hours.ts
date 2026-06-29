import type { TelemetryRow } from "@/lib/telemetry";

/**
 * Engine operating hours from raw device telemetry — the metric flespi's paid
 * analytics tier computes server-side, derived here from raw ignition + time.
 *
 * Method (state carry-forward / left Riemann sum): walk consecutive points; each
 * point's ignition state is held until the next point. For an interval whose
 * EARLIER point is ignition-ON, credit min(dt, MAX_ON_GAP_MS). Intervals longer
 * than MAX_GAP_MS are treated as data gaps (device offline — unknowable) and are
 * never credited. Pure & deterministic: same input → same output, no clock/IO.
 *
 * Thresholds are fixed but intentionally exported so they live in one place and
 * can be tuned (and asserted in tests).
 */

/** Max duration a single ON interval may contribute — caps over-counting when an
 *  ON sample precedes a long silence (the engine likely actually stopped). */
export const MAX_ON_GAP_MS = 15 * 60 * 1000; // 15 dk
/** Intervals longer than this are data gaps (device offline) — not counted. */
export const MAX_GAP_MS = 60 * 60 * 1000; // 60 dk

export type EngineHoursResult = {
  /** Total credited engine-ON time, in milliseconds. */
  ms: number;
  /** Convenience: ms / 3_600_000. */
  hours: number;
  /** True when the figure is approximate — a data gap was skipped or an ON
   *  interval was clamped to MAX_ON_GAP_MS. Drives the "~ estimated" hint. */
  uncertain: boolean;
  /** Number of intervals dropped as data gaps (dt > MAX_GAP_MS). */
  gapCount: number;
  /** Number of ON intervals capped at MAX_ON_GAP_MS (MAX_ON_GAP_MS < dt ≤ MAX_GAP_MS). */
  clampedCount: number;
  /** Telemetry points considered. 0 → no data to compute from (show "no data"). */
  points: number;
};

/**
 * Compute engine operating hours over a telemetry series. Expects `track` sorted
 * by recorded_at ascending (as listVehicleTrack returns it); out-of-order or
 * duplicate timestamps (dt ≤ 0) are skipped defensively so a bad row can never
 * inflate or corrupt the total.
 */
export function computeEngineHours(track: TelemetryRow[]): EngineHoursResult {
  let ms = 0;
  let gapCount = 0;
  let clampedCount = 0;

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    const dt =
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();

    if (!Number.isFinite(dt) || dt <= 0) continue; // bad ordering / duplicate ts
    if (dt > MAX_GAP_MS) {
      // Device was offline across this interval — its state is unknowable.
      gapCount++;
      continue;
    }
    if (a.ignition_on === true) {
      const credited = Math.min(dt, MAX_ON_GAP_MS);
      if (credited < dt) clampedCount++;
      ms += credited;
    }
  }

  return {
    ms,
    hours: ms / 3_600_000,
    uncertain: gapCount > 0 || clampedCount > 0,
    gapCount,
    clampedCount,
    points: track.length,
  };
}
