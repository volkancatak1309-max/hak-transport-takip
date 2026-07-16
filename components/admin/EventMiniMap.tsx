"use client";

import { MapContainer, Marker } from "react-leaflet";
import L from "leaflet";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import "leaflet/dist/leaflet.css";

/**
 * Tek-nokta olay mini-haritası (REVEAL-GAP §3.6 — Reveal alarm detay penceresi:
 * mini-harita + pin + adres). DetailDrawer içinde olay konumunu gösterir.
 * OpenFreeMap liberty stili (VectorBaseLayer) korunur — ek bağımlılık yok.
 * Dinamik import ile SSR'sız yüklenmeli (Leaflet window'a ihtiyaç duyar).
 */
const PIN = L.divIcon({
  className: "hak-marker-wrap",
  html: `<div class="hak-route-pin" style="background:var(--status-critical)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export default function EventMiniMap({
  lat,
  lng,
  zoom = 14,
}: {
  lat: number;
  lng: number;
  zoom?: number;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={zoom}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      zoomControl={false}
      attributionControl={false}
      className="h-40 w-full overflow-hidden rounded-[12px]"
      style={{ background: "var(--muted)" }}
    >
      <VectorBaseLayer />
      <Marker position={[lat, lng]} icon={PIN} />
    </MapContainer>
  );
}
