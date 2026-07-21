import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listVehicleTrack } from "@/lib/telemetry";
import { viennaDayKey } from "@/lib/format";

export type RoutePoint = {
  lat: number;
  lng: number;
  t: string;
  /** Device course 0..359, when the source carries it (device GPS). Phone-GPS
   *  (driver_locations) routes leave it undefined. */
  heading?: number | null;
};
export type LatLng = [number, number];

export type RouteDay = {
  date: string; // YYYY-MM-DD (Vienna)
  points: RoutePoint[];
  /** Road-snapped polyline (map-matched). Falls back to raw points if matching
   *  is unavailable. This is what the map draws & the marker travels along. */
  geometry: LatLng[];
  matched: boolean;
  plate: string | null;
  driverName: string | null;
  driverId: string | null;
  totalRaw: number; // point count before sampling (for the UI hint)
  /** When true the replay marker is a heading arrow (the source has course
   *  data, i.e. device GPS) instead of a plain pin. Driver routes leave unset. */
  directional?: boolean;
};

const OSRM_MATCH = "https://router.project-osrm.org/match/v1/driving/";
const MATCH_INPUT_MAX = 180; // coords sent to OSRM (it returns a dense geometry)
const MATCH_CHUNK = 90; // OSRM public demo coordinate cap per request

/** Downsample to a fixed cap, always keeping first & last. */
function cap(points: RoutePoint[], max: number): RoutePoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

async function matchChunk(chunk: RoutePoint[]): Promise<LatLng[] | null> {
  if (chunk.length < 2) return null;
  const coords = chunk.map((p) => `${p.lng},${p.lat}`).join(";");
  const radiuses = chunk.map(() => "25").join(";");
  const url = `${OSRM_MATCH}${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      matchings?: { geometry: { coordinates: [number, number][] } }[];
    };
    if (data.code !== "Ok" || !data.matchings?.length) return null;
    const out: LatLng[] = [];
    for (const m of data.matchings) {
      for (const c of m.geometry.coordinates) out.push([c[1], c[0]]);
    }
    return out.length ? out : null;
  } catch {
    return null; // timeout / network / parse → caller falls back to raw
  }
}

/**
 * Snap a GPS track to the road network via OSRM Match. Chunks long tracks to the
 * public server's coordinate cap and runs them in parallel. Any failed chunk
 * (or a track too short) falls back to the raw straight-line coordinates, so the
 * caller never errors and always gets a drawable polyline.
 */
async function buildMatchedGeometry(
  points: RoutePoint[]
): Promise<{ geometry: LatLng[]; matched: boolean }> {
  const raw: LatLng[] = points.map((p) => [p.lat, p.lng]);
  if (points.length < 3) return { geometry: raw, matched: false };

  const input = cap(points, MATCH_INPUT_MAX);
  const chunks: RoutePoint[][] = [];
  for (let i = 0; i < input.length; i += MATCH_CHUNK - 1) {
    chunks.push(input.slice(i, i + MATCH_CHUNK));
    if (i + MATCH_CHUNK >= input.length) break;
  }

  const results = await Promise.all(
    chunks.map((ch) => matchChunk(ch).then((m) => ({ m, ch })))
  );

  let any = false;
  const geometry: LatLng[] = [];
  for (const { m, ch } of results) {
    const seg: LatLng[] = m ?? ch.map((p) => [p.lat, p.lng] as LatLng);
    if (m) any = true;
    for (let j = 0; j < seg.length; j++) {
      if (geometry.length && j === 0) continue; // dedupe the chunk join
      geometry.push(seg[j]);
    }
  }
  return { geometry: geometry.length > 1 ? geometry : raw, matched: any };
}

const MAX_POINTS = 900; // keep replay smooth even on long days

/** Evenly downsample, always preserving the first & last point. */
function sample(points: RoutePoint[], max = MAX_POINTS): RoutePoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  // guarantee the true last point
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** UTC window that safely brackets a Vienna calendar day (±1 day for DST/offset). */
function dayWindow(date: string): { gte: string; lt: string } {
  const base = new Date(`${date}T00:00:00Z`);
  const gte = new Date(base);
  gte.setUTCDate(gte.getUTCDate() - 1);
  const lt = new Date(base);
  lt.setUTCDate(lt.getUTCDate() + 2);
  return { gte: gte.toISOString(), lt: lt.toISOString() };
}

/*
 * TELEFON GPS'İ KALDIRILDI (21.07.2026). Buradaki iki fonksiyon —
 * getWorkerRoute (şoförün telefon izleri) ve getVehicleRoute (aynı izlerin
 * araca göre gruplanmışı) — `driver_locations` okuyordu. Rota takibinin tek
 * kaynağı artık araç cihazıdır (FMC003 → device_telemetry); aşağıdaki
 * getVehicleDeviceRoute o hattı kullanır. `driver_locations` tablosu geçmiş
 * veri olarak DURUYOR, yalnız hiçbir yerde okunmuyor.
 */
/**
 * Route of a vehicle on a given day from its OWN hardware tracker
 * (device_telemetry) — the FMC003's 24/7 GPS, independent of any phone or open
 * shift. Mirrors getVehicleRoute's RouteDay shape so RouteReplay renders it
 * unchanged, but the line AND the marker heading come from the device, not from
 * driver_locations. Built on listVehicleTrack, the shared telemetry-series base.
 */
export async function getVehicleDeviceRoute(
  vehicleId: string,
  date: string
): Promise<RouteDay> {
  const { gte, lt } = dayWindow(date);
  const [{ data: vehicle }, track] = await Promise.all([
    supabaseAdmin.from("vehicles").select("plate").eq("id", vehicleId).maybeSingle(),
    listVehicleTrack(vehicleId, gte, lt),
  ]);
  const plate = (vehicle?.plate as string) ?? null;

  const rawPts: RoutePoint[] = track
    .filter((r) => viennaDayKey(r.recorded_at) === date)
    .map((r) => ({ lat: r.latitude, lng: r.longitude, t: r.recorded_at, heading: r.heading }));

  const points = sample(rawPts);
  const { geometry, matched } = await buildMatchedGeometry(points);
  // Show the heading arrow only if the device actually reported a course.
  const directional = rawPts.some((p) => p.heading !== null && p.heading !== undefined);

  return {
    date,
    points,
    geometry,
    matched,
    totalRaw: rawPts.length,
    plate,
    driverName: null, // vehicle-centric track — no driver label
    driverId: vehicleId, // replay reset key
    directional,
  };
}
