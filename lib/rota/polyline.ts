/**
 * Kodlanmış çoklu çizgi (Encoded Polyline Algorithm Format, 5 hane).
 *
 * OSRM (`geometries=polyline`), VROOM (`options.g`) ve Google Routes aynı
 * biçimi kullanıyor; tek çözücü üçüne de yetiyor. SAF modül — istemci de
 * kullanıyor (harita çizimi), sunucu da (Google'ın parçalı rotalarını
 * birleştirmek için).
 *
 * Doğrulama: Google'ın belgelediği örnek "_p~iF~ps|U_ulLnnqC_mqNvxq`@" →
 * (38.5,-120.2) (40.7,-120.95) (43.252,-126.453) — scripts/verify-rota.mjs.
 */

export type LatLng = [number, number];

export function polylineCoz(kod: string, hane = 5): LatLng[] {
  const carpan = 10 ** hane;
  const noktalar: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < kod.length) {
    for (const eksen of [0, 1]) {
      let sonuc = 0;
      let kaydir = 0;
      let b: number;
      do {
        // Dizi biterse charCodeAt NaN döner ve döngü kendiliğinden kapanır.
        b = kod.charCodeAt(i++) - 63;
        sonuc |= (b & 0x1f) << kaydir;
        kaydir += 5;
      } while (b >= 0x20);
      const fark = sonuc & 1 ? ~(sonuc >> 1) : sonuc >> 1;
      if (eksen === 0) lat += fark;
      else lng += fark;
    }
    noktalar.push([lat / carpan, lng / carpan]);
  }
  return noktalar;
}

function sayiKodla(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function polylineKodla(noktalar: LatLng[], hane = 5): string {
  const carpan = 10 ** hane;
  let oncekiLat = 0;
  let oncekiLng = 0;
  let out = "";
  for (const [lat, lng] of noktalar) {
    const la = Math.round(lat * carpan);
    const ln = Math.round(lng * carpan);
    out += sayiKodla(la - oncekiLat) + sayiKodla(ln - oncekiLng);
    oncekiLat = la;
    oncekiLng = ln;
  }
  return out;
}

/** Parçalı rotaları tek çizgiye birleştirir — birleşim noktası ikilenmez. */
export function polylineBirlestir(parcalar: (string | null)[]): string | null {
  const hepsi: LatLng[] = [];
  for (const p of parcalar) {
    if (!p) return null; // bir parça eksikse yarım çizgi çizmektense hiç çizme
    const n = polylineCoz(p);
    if (hepsi.length > 0 && n.length > 0) {
      const [a, b] = hepsi[hepsi.length - 1];
      if (a === n[0][0] && b === n[0][1]) n.shift();
    }
    hepsi.push(...n);
  }
  return hepsi.length > 0 ? polylineKodla(hepsi) : null;
}
