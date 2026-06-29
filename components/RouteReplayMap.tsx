"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/route-history";

const AUSTRIA_CENTER: LatLng = [47.5162, 14.5501];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

/** Moving vehicle marker with the driver's name label above it. */
function moveIcon(name: string | null): L.DivIcon {
  const label = name
    ? `<div class="hak-replay-label">${esc(name)}</div>`
    : "";
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-replay-wrap">${label}<div class="hak-replay-pin"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Compass bearing (deg, clockwise from north) from point a to point b. */
function bearingBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a[0]);
  const φ2 = toRad(b[0]);
  const Δλ = toRad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Directional marker: an arrow rotated to `bearing`, optional name label above. */
function arrowIcon(name: string | null, bearing: number): L.DivIcon {
  const label = name ? `<div class="hak-replay-label">${esc(name)}</div>` : "";
  const arrow =
    `<div class="hak-replay-arrow" style="transform: rotate(${bearing}deg); transform-origin: center;">` +
    `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="M12 2 L19 21 L12 16 L5 21 Z" fill="var(--accent-sky)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg></div>`;
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-replay-wrap">${label}${arrow}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FitOnce({ points }: { points: LatLng[] }) {
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

/** Linear interpolate along the polyline for smooth motion between vertices. */
function positionAt(latlngs: LatLng[], progress: number): LatLng {
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
  geometry,
  progress,
  driverName,
  directional,
  heading,
}: {
  geometry: LatLng[];
  progress: number;
  driverName: string | null;
  /** When true the marker is a rotated heading arrow instead of a plain pin. */
  directional?: boolean;
  /** Device course at the current instant; falls back to the path tangent. */
  heading?: number | null;
}) {
  const latlngs = geometry;

  const cur = positionAt(latlngs, progress);
  const idx = Math.floor(Math.max(0, Math.min(1, progress)) * (latlngs.length - 1));

  // Direction the marker faces: device heading when present, otherwise the
  // tangent of the path it is travelling (so the arrow always matches motion).
  const tangent =
    latlngs.length > 1
      ? bearingBetween(
          latlngs[Math.min(idx, latlngs.length - 2)],
          latlngs[Math.min(idx + 1, latlngs.length - 1)]
        )
      : 0;
  // Round to 3° so the divIcon only rebuilds on a visible turn, not every frame.
  const roundedBearing = directional
    ? Math.round((heading ?? tangent) / 3) * 3
    : 0;
  const icon = useMemo(
    () =>
      directional ? arrowIcon(driverName, roundedBearing) : moveIcon(driverName),
    [directional, driverName, roundedBearing]
  );
  const traveled = useMemo<LatLng[]>(() => {
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
      {latlngs.length > 0 && <Marker position={cur} icon={icon} zIndexOffset={1000} />}
    </MapContainer>
  );
}
