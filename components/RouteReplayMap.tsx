"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { RoutePoint } from "@/lib/route-history";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];
type LL = [number, number];

function endpointIcon(kind: "start" | "end"): L.DivIcon {
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-route-endpoint hak-route-${kind}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}
const START_ICON = endpointIcon("start");
const END_ICON = endpointIcon("end");
const MOVE_ICON = L.divIcon({
  className: "hak-marker-wrap",
  html: `<div class="hak-replay-pin"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function FitOnce({ points }: { points: LL[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [50, 50], maxZoom: 15 });
  }, [points, map]);
  return null;
}

/** Linear interpolate the marker position for smooth motion between samples. */
function positionAt(latlngs: LL[], progress: number): LL {
  if (latlngs.length === 0) return AUSTRIA_CENTER;
  if (latlngs.length === 1) return latlngs[0];
  const f = Math.max(0, Math.min(1, progress)) * (latlngs.length - 1);
  const i = Math.floor(f);
  const frac = f - i;
  if (i >= latlngs.length - 1) return latlngs[latlngs.length - 1];
  const a = latlngs[i];
  const b = latlngs[i + 1];
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

export function RouteReplayMap({
  points,
  progress,
}: {
  points: RoutePoint[];
  progress: number;
}) {
  const latlngs = useMemo<LL[]>(() => points.map((p) => [p.lat, p.lng]), [points]);

  const cur = positionAt(latlngs, progress);
  const idx = Math.floor(Math.max(0, Math.min(1, progress)) * (latlngs.length - 1));
  const traveled = useMemo<LL[]>(() => {
    if (latlngs.length === 0) return [];
    return [...latlngs.slice(0, idx + 1), cur];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latlngs, idx, cur[0], cur[1]]);

  const start = latlngs[0];
  const end = latlngs[latlngs.length - 1];

  return (
    <MapContainer
      center={start ?? AUSTRIA_CENTER}
      zoom={start ? 13 : 7}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnce points={latlngs} />

      {/* Remaining route — faint */}
      {latlngs.length > 1 && (
        <Polyline
          positions={latlngs}
          pathOptions={{ color: "var(--accent-sky)", weight: 4, opacity: 0.22 }}
        />
      )}
      {/* Traveled route — highlighted sky */}
      {traveled.length > 1 && (
        <Polyline
          positions={traveled}
          pathOptions={{ color: "var(--accent-sky)", weight: 5, opacity: 0.95 }}
        />
      )}

      {start && <Marker position={start} icon={START_ICON} />}
      {end && latlngs.length > 1 && <Marker position={end} icon={END_ICON} />}
      {latlngs.length > 0 && <Marker position={cur} icon={MOVE_ICON} zIndexOffset={1000} />}
    </MapContainer>
  );
}
