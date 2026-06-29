"use client";

import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

const PIN = L.divIcon({
  className: "hak-marker-wrap",
  html: `<div class="hak-route-pin" style="background:var(--color-brand)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** Click anywhere to set the zone centre. */
function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Map for picking a circular geofence centre + previewing its radius. Click to
 * move the centre; the circle redraws live from `radius`. Re-mount (via a key)
 * to recentre on a different zone — MapContainer ignores `center` after mount.
 */
export function GeofencePickerMap({
  center,
  radius,
  onPick,
}: {
  center: [number, number] | null;
  radius: number;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={center ?? AUSTRIA_CENTER}
      zoom={center ? 13 : 7}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPick onPick={onPick} />
      {center && <Marker position={center} icon={PIN} />}
      {center && radius > 0 && (
        <Circle
          center={center}
          radius={radius}
          pathOptions={{ color: "var(--color-brand)", weight: 2, fillOpacity: 0.12 }}
        />
      )}
    </MapContainer>
  );
}
