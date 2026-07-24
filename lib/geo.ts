/**
 * Coğrafi yardımcılar — TEK KAYNAK (Modül 3).
 *
 * `metrics-geofence.ts` içindeki haversine dahili/private; depo-giriş tespiti
 * (panel) için buradan export edilen sürümü kullanılır. İkisi de aynı formül.
 */

const EARTH_R_M = 6_371_000;

/** İki lat/lng noktası arası büyük-daire mesafesi (metre). */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(aLat);
  const p2 = toRad(bLat);
  const dp = toRad(bLat - aLat);
  const dl = toRad(bLng - aLng);
  const s =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nokta, (merkez + yarıçap) dairesinin içinde mi? */
export function pointInCircleM(
  pLat: number,
  pLng: number,
  cLat: number,
  cLng: number,
  radiusM: number
): boolean {
  return haversineM(pLat, pLng, cLat, cLng) <= radiusM;
}
