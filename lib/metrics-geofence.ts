import type { TelemetryRow } from "@/lib/telemetry";
import type { Geofence, GeofenceRuleKind } from "@/lib/types";

/**
 * Geofence (region-violation) detection from raw device telemetry — the
 * "geofence detection" flespi's paid analytics tier computes server-side,
 * derived here from raw position + time against admin-defined circular zones.
 *
 * Per zone, a hysteretic two-state machine walks the track:
 *  - while OUTSIDE, distance ≤ radius − HYSTERESIS_BAND_M → ENTER;
 *  - while INSIDE, distance ≥ radius + HYSTERESIS_BAND_M → EXIT.
 * The band stops a vehicle hovering on the boundary from flapping enter/exit.
 * An inside episode shorter than MIN_DWELL_MS is dropped (a corner-clip, not a
 * real presence). A data gap (> GAP_MAX_MS) closes any open episode — we cannot
 * know whether the vehicle stayed — and marks the result uncertain.
 *
 * Violation per rule_kind: a 'forbidden' zone is violated by ENTERING it; an
 * 'allowed_only' zone is violated by LEAVING it (the vehicle must stay inside).
 * Pure & deterministic: same input → same output, no clock/IO.
 *
 * Thresholds are fixed but exported so they live in one place and can be tuned
 * (and asserted in tests).
 */

/** Boundary hysteresis: enter at radius−band, exit at radius+band (metres). */
export const HYSTERESIS_BAND_M = 25;
/** Minimum time inside a zone to count as a real entry (ms) — drops corner clips. */
export const MIN_DWELL_MS = 60 * 1000; // 60 s
/** Silences longer than this close an open episode (device offline) (ms). */
export const GAP_MAX_MS = 15 * 60 * 1000; // 15 dk

const EARTH_R_M = 6_371_000;

export type GeofenceEvent = {
  zoneId: string;
  zoneName: string;
  ruleKind: GeofenceRuleKind;
  /** When the vehicle entered the zone. */
  entryTime: string;
  /** When it left, or null if still inside at the end of the track. */
  exitTime: string | null;
  /** Time spent inside the zone (ms). For an ongoing episode, up to the last fix. */
  dwellMs: number;
  /** True if the episode had not ended by the last telemetry point. */
  ongoing: boolean;
  /** True if this episode breaks the zone's rule. */
  violation: boolean;
};

export type GeofenceResult = {
  events: GeofenceEvent[];
  violationCount: number;
  /** Telemetry points considered. 0 → no data. */
  points: number;
  /** Active zones evaluated. 0 → no zones defined. */
  zonesChecked: number;
  /** Intervals that were data gaps (dt > GAP_MAX_MS). */
  gapCount: number;
  /** True when a data gap was present — episodes may be approximate. */
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
 * Detect zone entry/exit events and violations over a telemetry series. Expects
 * `track` sorted by recorded_at ascending (as listVehicleTrack returns it) and
 * `zones` the active circular geofences to check.
 */
export function computeGeofenceEvents(
  track: TelemetryRow[],
  zones: Geofence[]
): GeofenceResult {
  const n = track.length;
  const circles = zones.filter((z) => z.type === "circle" && z.radius_m > 0);

  // gapCount is track-wide (independent of zones).
  let gapCount = 0;
  if (n >= 2) {
    let prev = new Date(track[0].recorded_at).getTime();
    for (let i = 1; i < n; i++) {
      const t = new Date(track[i].recorded_at).getTime();
      if (Number.isFinite(t) && Number.isFinite(prev) && t - prev > GAP_MAX_MS) {
        gapCount++;
      }
      prev = t;
    }
  }

  if (n < 2 || circles.length === 0) {
    return {
      events: [],
      violationCount: 0,
      points: n,
      zonesChecked: circles.length,
      gapCount,
      uncertain: gapCount > 0,
    };
  }

  const times = track.map((r) => new Date(r.recorded_at).getTime());
  const events: GeofenceEvent[] = [];

  for (const z of circles) {
    const enterAt = z.radius_m - HYSTERESIS_BAND_M; // tighter ring to enter
    const exitAt = z.radius_m + HYSTERESIS_BAND_M; // looser ring to exit
    let inside = false;
    let entryIdx = -1;

    const close = (exitIdx: number | null) => {
      if (entryIdx < 0) return;
      const endIdx = exitIdx ?? n - 1;
      const dwellMs = Math.max(0, times[endIdx] - times[entryIdx]);
      if (dwellMs >= MIN_DWELL_MS) {
        const ongoing = exitIdx === null;
        const violation =
          z.rule_kind === "forbidden"
            ? true // entering a forbidden zone is the violation
            : z.rule_kind === "allowed_only"
              ? !ongoing // leaving an allowed-only zone is the violation
              : false;
        events.push({
          zoneId: z.id,
          zoneName: z.name,
          ruleKind: z.rule_kind,
          entryTime: track[entryIdx].recorded_at,
          exitTime: exitIdx === null ? null : track[exitIdx].recorded_at,
          dwellMs,
          ongoing,
          violation,
        });
      }
      inside = false;
      entryIdx = -1;
    };

    for (let i = 0; i < n; i++) {
      // A data gap closes any open episode (we cannot confirm presence across it).
      if (i > 0 && inside && times[i] - times[i - 1] > GAP_MAX_MS) {
        close(i - 1);
      }
      const dist = haversineM(
        track[i].latitude,
        track[i].longitude,
        z.center_lat,
        z.center_lng
      );
      if (!inside) {
        if (dist <= enterAt) {
          inside = true;
          entryIdx = i;
        }
      } else if (dist >= exitAt) {
        close(i);
      }
    }
    close(null); // still inside at the end → ongoing episode
  }

  events.sort(
    (a, b) =>
      new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  );

  return {
    events,
    violationCount: events.filter((e) => e.violation).length,
    points: n,
    zonesChecked: circles.length,
    gapCount,
    uncertain: gapCount > 0,
  };
}
