"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";
import { UserAvatar } from "@/components/UserAvatar";
import { formatTime } from "@/lib/format";
import type { ActiveDriver } from "@/lib/types";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function makeIcon(name: string): L.DivIcon {
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-pin"><span>${initials(name)}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [60, 60], maxZoom: 14 });
  }, [points, map]);
  return null;
}

export function FleetMap({ drivers }: { drivers: ActiveDriver[] }) {
  const t = useTranslations("map");
  const locale = useLocale();
  const now = Date.now();

  const points = useMemo(
    () => drivers.map((d) => [d.latitude, d.longitude] as [number, number]),
    [drivers]
  );

  return (
    <MapContainer
      center={AUSTRIA_CENTER}
      zoom={7}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {drivers.map(
        (d) =>
          d.route.length > 1 && (
            <Polyline
              key={`route-${d.worker_id}`}
              positions={d.route}
              pathOptions={{ color: "var(--color-brand)", weight: 3, opacity: 0.6 }}
            />
          )
      )}
      {drivers.map((d) => {
        const minutesActive = Math.max(
          0,
          Math.floor((now - new Date(d.shift_started_at).getTime()) / 60000)
        );
        return (
          <Marker
            key={d.worker_id}
            position={[d.latitude, d.longitude]}
            icon={makeIcon(d.name)}
          >
            <Popup>
              <div className="min-w-[180px] space-y-2">
                <div className="flex items-center gap-2">
                  <UserAvatar name={d.name} size="sm" />
                  <div>
                    <div className="font-semibold text-sm leading-tight">{d.name}</div>
                    <div className="text-xs text-muted-foreground nums">
                      {d.plate ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>{t("active_since", { minutes: minutesActive })}</div>
                  <div>{t("last_update", { time: formatTime(d.recorded_at, locale) })}</div>
                </div>
                <Link
                  href={`/admin/workers/${d.worker_id}`}
                  className="inline-block text-xs font-medium text-primary hover:underline"
                >
                  {t("view_detail")} →
                </Link>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
