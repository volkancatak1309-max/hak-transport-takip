import type { TelemetryRow } from "@/lib/telemetry";

/**
 * Trip & stop detection from raw device telemetry — the "trip/stop detection"
 * flespi's paid analytics tier computes server-side, derived here from raw
 * position + speed + time.
 *
 * This is GPS-DETECTED movement, entirely separate from the admin-created
 * "assignments" (manual seferler) — they are never read or touched here.
 *
 * Two-pass method:
 *  PASS 1 (stops): group consecutive "stationary" points (speed < MOVE_SPEED)
 *    into a cluster while they stay within STOP_RADIUS of the running centroid
 *    and no data gap (> MAX_GAP) splits them. A cluster lasting ≥ DWELL_MIN is a
 *    "stop" (location = centroid); shorter dwells are NOT stops (traffic light)
 *    and are absorbed into the surrounding trip.
 *  PASS 2 (trips): the movement between consecutive qualified stops (and before
 *    the first / after the last) is a "trip". Distance is the summed haversine
 *    chord, dropping jitter (< D_MIN_M), spikes (> SPIKE_SPEED_KMH), and never
 *    bridging a data gap. A segment with no real movement is not a trip.
 * Pure & deterministic: same input → same output, no clock/IO.
 *
 * Thresholds are fixed but exported so they live in one place and can be tuned
 * (and asserted in tests).
 */

/** Below this speed the vehicle counts as stopped (km/h). */
export const MOVE_SPEED_KMH = 3;
/** Minimum stationary dwell to count as a real stop (ms) — the main knob. */
export const DWELL_MIN_MS = 3 * 60 * 1000; // 3 dk
/** Points within this radius belong to the same stop (metres). */
export const STOP_RADIUS_M = 40;
/** Silences longer than this are data gaps — no chord/cluster bridged across (ms). */
export const MAX_GAP_MS = 15 * 60 * 1000; // 15 dk
/** Implied speed above this marks a GPS spike — chord dropped (km/h). */
export const SPIKE_SPEED_KMH = 200;

/** Chords shorter than this are jitter/drift, not travel (metres). Internal. */
const D_MIN_M = 10;
const EARTH_R_M = 6_371_000;

export type Trip = {
  startTime: string;
  endTime: string;
  durationMs: number;
  km: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
};

export type Stop = {
  startTime: string;
  endTime: string;
  durationMs: number;
  /** Centroid (mean) of the stop's points. */
  lat: number;
  lng: number;
};

export type TripsResult = {
  trips: Trip[];
  stops: Stop[];
  /** Sum of all trip distances, km. */
  totalTripKm: number;
  /** Telemetry points considered. 0 → no data (show "no data"). */
  points: number;
  /** Intervals that were data gaps (dt > MAX_GAP_MS). */
  gapCount: number;
  /** True when a data gap was present — segmentation may be approximate. */
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
 * Segment a telemetry series into GPS-detected trips and stops. Expects `track`
 * sorted by recorded_at ascending (as listVehicleTrack returns it).
 */
export function computeTripsAndStops(track: TelemetryRow[]): TripsResult {
  const n = track.length;
  if (n < 2) {
    return { trips: [], stops: [], totalTripKm: 0, points: n, gapCount: 0, uncertain: false };
  }

  const times = track.map((r) => new Date(r.recorded_at).getTime());

  let gapCount = 0;
  for (let i = 1; i < n; i++) {
    const dt = times[i] - times[i - 1];
    if (Number.isFinite(dt) && dt > MAX_GAP_MS) gapCount++;
  }

  // ---- Pass 1: qualified stops ----
  type Cluster = {
    startIdx: number;
    endIdx: number;
    sumLat: number;
    sumLng: number;
    count: number;
  };
  const rawStops: { startIdx: number; endIdx: number; lat: number; lng: number }[] = [];
  let cluster: Cluster | null = null;

  const flush = () => {
    if (!cluster) return;
    const c = cluster;
    cluster = null;
    if (times[c.endIdx] - times[c.startIdx] >= DWELL_MIN_MS) {
      rawStops.push({
        startIdx: c.startIdx,
        endIdx: c.endIdx,
        lat: c.sumLat / c.count,
        lng: c.sumLng / c.count,
      });
    }
  };

  for (let i = 0; i < n; i++) {
    const sp = track[i].speed_kmh;
    const stationary = sp !== null && sp < MOVE_SPEED_KMH;
    if (!stationary) {
      flush(); // moving / unknown speed ends a stationary cluster
      continue;
    }
    if (!cluster) {
      cluster = {
        startIdx: i,
        endIdx: i,
        sumLat: track[i].latitude,
        sumLng: track[i].longitude,
        count: 1,
      };
      continue;
    }
    const gapped = times[i] - times[cluster.endIdx] > MAX_GAP_MS;
    const cLat = cluster.sumLat / cluster.count;
    const cLng = cluster.sumLng / cluster.count;
    const crept = haversineM(cLat, cLng, track[i].latitude, track[i].longitude) > STOP_RADIUS_M;
    if (gapped || crept) {
      // A gap or moving out of the radius ends the cluster; start a fresh one.
      flush();
      cluster = {
        startIdx: i,
        endIdx: i,
        sumLat: track[i].latitude,
        sumLng: track[i].longitude,
        count: 1,
      };
    } else {
      cluster.endIdx = i;
      cluster.sumLat += track[i].latitude;
      cluster.sumLng += track[i].longitude;
      cluster.count += 1;
    }
  }
  flush();

  // ---- Pass 2: trips between qualified stops ----
  const trips: Trip[] = [];
  let totalMeters = 0;
  const segments: { from: number; to: number }[] = [];
  let prevEnd = 0;
  for (const st of rawStops) {
    segments.push({ from: prevEnd, to: st.startIdx });
    prevEnd = st.endIdx;
  }
  segments.push({ from: prevEnd, to: n - 1 });

  for (const seg of segments) {
    if (seg.to <= seg.from) continue; // no span → no trip
    let meters = 0;
    for (let i = seg.from; i < seg.to; i++) {
      const dt = times[i + 1] - times[i];
      if (!Number.isFinite(dt) || dt <= 0) continue; // bad ordering / duplicate
      if (dt > MAX_GAP_MS) continue; // data gap — don't bridge it
      const d = haversineM(
        track[i].latitude,
        track[i].longitude,
        track[i + 1].latitude,
        track[i + 1].longitude
      );
      if (!Number.isFinite(d) || d < D_MIN_M) continue; // jitter / drift
      if (d / 1000 / (dt / 3_600_000) > SPIKE_SPEED_KMH) continue; // GPS spike
      meters += d;
    }
    if (meters <= 0) continue; // no real movement → not a trip
    trips.push({
      startTime: track[seg.from].recorded_at,
      endTime: track[seg.to].recorded_at,
      durationMs: Math.max(0, times[seg.to] - times[seg.from]),
      km: meters / 1000,
      startLat: track[seg.from].latitude,
      startLng: track[seg.from].longitude,
      endLat: track[seg.to].latitude,
      endLng: track[seg.to].longitude,
    });
    totalMeters += meters;
  }

  return {
    trips,
    stops: rawStops.map((st) => ({
      startTime: track[st.startIdx].recorded_at,
      endTime: track[st.endIdx].recorded_at,
      durationMs: Math.max(0, times[st.endIdx] - times[st.startIdx]),
      lat: st.lat,
      lng: st.lng,
    })),
    totalTripKm: totalMeters / 1000,
    points: n,
    gapCount,
    uncertain: gapCount > 0,
  };
}
