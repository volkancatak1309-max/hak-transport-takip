"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type RoutePoint = { lat: number; lng: number; recorded_at: string };

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

function endpointIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-route-pin" style="background:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const START_ICON = endpointIcon("oklch(0.6 0.15 145)"); // green
const END_ICON = endpointIcon("var(--color-brand)"); // orange

function FitRoute({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [points, map]);
  return null;
}

export function RouteMap({ points }: { points: RoutePoint[] }) {
  const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
  const start = latlngs[0];
  const end = latlngs[latlngs.length - 1];

  return (
    <MapContainer
      center={start ?? AUSTRIA_CENTER}
      zoom={start ? 14 : 7}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitRoute points={latlngs} />
      {latlngs.length > 1 && (
        <Polyline
          positions={latlngs}
          pathOptions={{ color: "var(--color-brand)", weight: 4, opacity: 0.8 }}
        />
      )}
      {start && <Marker position={start} icon={START_ICON} />}
      {end && latlngs.length > 1 && <Marker position={end} icon={END_ICON} />}
    </MapContainer>
  );
}
