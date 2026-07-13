"use client";

/**
 * One-shot GPS fix for driver-panel events (+1 PAKET, FOTO ÇEK, SORUN BİLDİR).
 * Same options as components/LocationTracker.tsx (enableHighAccuracy, 30s
 * cached fix tolerated). NEVER rejects — a denied/failed/missing GPS resolves
 * to nulls so the tap is recorded regardless (location is best-effort evidence,
 * not a precondition).
 */
export type GeoFix = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
};

export function getGeoFix(timeoutMs = 6_000): Promise<GeoFix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({ lat: null, lng: null, accuracy: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      () => resolve({ lat: null, lng: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}
