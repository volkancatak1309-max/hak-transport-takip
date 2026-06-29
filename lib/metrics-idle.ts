import type { TelemetryRow } from "@/lib/telemetry";

/**
 * Idle time from raw device telemetry — the "idle time" flespi's paid analytics
 * tier computes server-side, derived here from raw ignition + speed + time.
 *
 * Idle = engine RUNNING but vehicle NOT MOVING. The ignition gate is the key
 * distinction: a parked vehicle (engine off, speed 0) is NOT idle; only an
 * engine-on, stationary vehicle is. Method:
 *  - an interval is "idle" when its EARLIER point has ignition_on === true AND a
 *    non-null speed below IDLE_SPEED_THRESHOLD_KMH (explicit null guard — never
 *    let `null < 3` count a no-speed sample as stopped);
 *  - consecutive idle intervals accumulate into a continuous "run";
 *  - a run shorter than MIN_IDLE_DURATION_MS is discarded (a traffic light is
 *    not idling); each surviving run is one "idle event";
 *  - a data gap (dt > MAX_GAP_MS) or any non-idle interval ends the run.
 * Pure & deterministic: same input → same output, no clock/IO.
 *
 * NOTE: unrelated to the "kpi_idle" KPI (count of shift-less / free vehicles).
 * That is a vehicle status tally, not engine-idle time, and is untouched here.
 *
 * Thresholds are fixed but exported so they live in one place and can be tuned
 * (and asserted in tests).
 */

/** Below this speed the vehicle counts as stopped (km/h). */
export const IDLE_SPEED_THRESHOLD_KMH = 3;
/** Continuous idle runs shorter than this are dropped (traffic light, ms). */
export const MIN_IDLE_DURATION_MS = 3 * 60 * 1000; // 3 dk
/** Silences longer than this are data gaps — not counted, and they end a run (ms). */
export const MAX_GAP_MS = 5 * 60 * 1000; // 5 dk

export type IdleResult = {
  /** Total qualifying idle time, milliseconds. */
  totalIdleMs: number;
  /** Number of continuous idle runs ≥ MIN_IDLE_DURATION_MS ("idle events"). */
  idleEvents: number;
  /** Telemetry points considered. 0 → no data to compute from (show "no data"). */
  points: number;
  /** Intervals dropped as data gaps (dt > MAX_GAP_MS). */
  gapCount: number;
  /** True when a data gap was skipped — the total may be approximate. */
  uncertain: boolean;
};

/**
 * Compute idle time over a telemetry series. Expects `track` sorted by
 * recorded_at ascending (as listVehicleTrack returns it); out-of-order or
 * duplicate timestamps (dt ≤ 0) are skipped defensively.
 */
export function computeIdleTime(track: TelemetryRow[]): IdleResult {
  let totalIdleMs = 0;
  let idleEvents = 0;
  let gapCount = 0;
  let runMs = 0; // current consecutive idle run

  // Close the current run: keep it only if it lasted long enough to be real idle.
  const flushRun = () => {
    if (runMs >= MIN_IDLE_DURATION_MS) {
      totalIdleMs += runMs;
      idleEvents++;
    }
    runMs = 0;
  };

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    const dt =
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();

    if (!Number.isFinite(dt) || dt <= 0) continue; // bad ordering / duplicate ts
    if (dt > MAX_GAP_MS) {
      // Device offline across this interval — unknowable; it ends any run.
      gapCount++;
      flushRun();
      continue;
    }

    const isIdle =
      a.ignition_on === true &&
      a.speed_kmh !== null &&
      a.speed_kmh < IDLE_SPEED_THRESHOLD_KMH;

    if (isIdle) {
      runMs += Math.min(dt, MAX_GAP_MS);
    } else {
      // Moving, engine off, or unknown speed — not idle; close the run.
      flushRun();
    }
  }
  flushRun(); // trailing run

  return {
    totalIdleMs,
    idleEvents,
    points: track.length,
    gapCount,
    uncertain: gapCount > 0,
  };
}
