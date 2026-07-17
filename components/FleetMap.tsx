"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import Link from "next/link";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import { useLocale, useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";
import { UserAvatar } from "@/components/UserAvatar";
import { FLEET_STYLE } from "@/lib/vehicle-ui";
import { formatRelative, formatTime } from "@/lib/format";
import {
  VEHICLE_FRESH_MS,
  type ActiveDriver,
  type ActiveVehicle,
  type VehicleFleet,
} from "@/lib/types";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
// Fixes older than this stay OFF the auto-fit frame (markers still render).
const BOUNDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function makeIcon(name: string, variant: "active" | "warn"): L.DivIcon {
  const mod = variant === "warn" ? " is-warn" : "";
  return L.divIcon({
    className: "hak-marker-wrap",
    html:
      `<div class="hak-pin-wrap">` +
      `<div class="hak-pin-label">${esc(name)}</div>` +
      `<div class="hak-pin${mod}"><span>${initials(name)}</span></div>` +
      `</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

// Vehicle (hardware-tracker) marker — a plate pill, visually distinct from the
// round driver pin. Pill color = FLEET (migration 023): bordo filo = claret,
// mavi filo = sky — working or idle, the fleet reads at a glance; ignition
// lives in the popup. Freshness still wins: stale (no fix within
// VEHICLE_FRESH_MS) renders faded gray — the vehicle stays on the map, its age
// readable at a glance. The mavi pill uses dark text: white on sky is ~3.2:1,
// under AA for 11px text (claret is dark enough for white).
function makeVehicleIcon(
  plate: string,
  fleet: VehicleFleet,
  stale: boolean
): L.DivIcon {
  const bordo = fleet === "bordo";
  const bg = stale
    ? "var(--muted)"
    : bordo
    ? "var(--accent-claret)"
    : "var(--accent-sky)";
  const fg = stale ? "var(--muted-foreground)" : bordo ? "#fff" : "#0c1626";
  const dim = stale ? "opacity:.55;filter:grayscale(1);" : "";
  return L.divIcon({
    className: "hak-veh-wrap",
    html:
      `<div style="display:flex;justify-content:center;align-items:center;${dim}">` +
      `<div style="display:inline-flex;align-items:center;gap:4px;background:${bg};` +
      `color:${fg};border:2px solid var(--card,#fff);border-radius:6px;` +
      `padding:1px 6px;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;` +
      `box-shadow:0 1px 4px rgba(0,0,0,.35)">` +
      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/>` +
      `<circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/></svg>` +
      `<span>${esc(plate)}</span></div></div>`,
    iconSize: [120, 26],
    iconAnchor: [60, 13],
    popupAnchor: [0, -13],
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

export function FleetMap({
  drivers,
  vehicles = [],
}: {
  drivers: ActiveDriver[];
  vehicles?: ActiveVehicle[];
}) {
  const t = useTranslations("map");
  const tf = useTranslations("vehicles.fleet");
  const locale = useLocale();
  const now = Date.now();

  // FitBounds spans both layers so vehicles are framed too, not just drivers.
  // Age cap ONLY for the frame: weeks-dead trackers (sold vehicle, ripped-out
  // device) must not zoom the whole fleet view out — their markers still render,
  // just outside the initial frame. Without this, one far-away stale fix would
  // reset the viewport to fleet+outlier on every 30 s refresh.
  const points = useMemo(() => {
    const boundsCutoff = Date.now() - BOUNDS_MAX_AGE_MS;
    return [
      ...drivers.map((d) => [d.latitude, d.longitude] as [number, number]),
      ...vehicles
        .filter((v) => new Date(v.recorded_at).getTime() >= boundsCutoff)
        .map((v) => [v.latitude, v.longitude] as [number, number]),
    ];
  }, [drivers, vehicles]);

  return (
    <>
    <MapContainer
      center={AUSTRIA_CENTER}
      zoom={7}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <VectorBaseLayer />
      <FitBounds points={points} />
      {drivers.map(
        (d) =>
          d.route.length > 1 && (
            <Polyline
              key={`route-${d.worker_id}`}
              positions={d.route}
              pathOptions={{ color: "var(--accent-sky)", weight: 3, opacity: 0.55 }}
            />
          )
      )}
      {drivers.map((d) => {
        const activeMs = now - new Date(d.shift_started_at).getTime();
        const minutesActive = Math.max(0, Math.floor(activeMs / 60000));
        const variant = activeMs > NINE_HOURS_MS ? "warn" : "active";
        return (
          <Marker
            key={d.worker_id}
            position={[d.latitude, d.longitude]}
            icon={makeIcon(d.name, variant)}
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
      {/* Vehicle layer (hardware GPS) — separate from the driver layer above.
          Every device vehicle is here (no recency window); stale ones render
          faded gray with a "son görülme" tooltip instead of dropping off. */}
      {vehicles.map((v) => {
        const stale = now - new Date(v.recorded_at).getTime() >= VEHICLE_FRESH_MS;
        return (
          <Marker
            key={`veh-${v.vehicle_id}`}
            position={[v.latitude, v.longitude]}
            icon={makeVehicleIcon(v.plate, v.fleet, stale)}
          >
            {stale && (
              <Tooltip direction="top" offset={[0, -14]}>
                {t("last_seen", { ago: formatRelative(v.recorded_at, locale) })}
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[180px] space-y-2">
                <div className="font-semibold text-sm leading-tight nums">{v.plate}</div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>
                    {t("vehicle_speed")}:{" "}
                    <span className="nums">
                      {v.speed_kmh != null ? `${Math.round(v.speed_kmh)} km/h` : "—"}
                    </span>
                  </div>
                  {/* Bayatken kontak durumu BİLİNMİYOR — son bilinen "açık"
                      göstermek gri ikonla çelişir, uydurma olur: "—". */}
                  <div>
                    {stale || v.ignition_on == null
                      ? "—"
                      : v.ignition_on
                      ? t("ignition_on")
                      : t("ignition_off")}
                  </div>
                  <div>
                    {stale
                      ? t("last_seen", { ago: formatRelative(v.recorded_at, locale) })
                      : t("last_update", { time: formatTime(v.recorded_at, locale) })}
                  </div>
                </div>
                <Link
                  href={`/admin/araclar/${v.vehicle_id}`}
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
    {/* Filo lejantı — iki filo rengi + adı (migration 023). Haritayı saran
        kapsayıcı relative (LiveTrackingClient); leaflet pane'lerinin üstünde
        (z-1000), tıklamayı harita alır. Yüzey glass-pop: bg-background koyu
        temada TRANSPARENT (bilinen Splash tuzağı) — açık harita üstünde küçük
        metin ancak yoğun dolguyla okunur. Örnekler DİKDÖRTGEN + açık kenarlı:
        yuvarlak sky nokta şoför pinleriyle karışırdı, kenarsız bordo dolgu ise
        koyu zeminde 1.3:1 ile kaybolurdu (WCAG 1.4.11). */}
    <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] space-y-1 rounded-[10px] glass-pop px-3 py-2 text-xs font-medium">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-3 w-5 shrink-0 rounded-[4px] border border-white/45 ${FLEET_STYLE.bordo.dot}`}
        />
        {tf("bordo")}
      </span>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-3 w-5 shrink-0 rounded-[4px] border border-white/45 ${FLEET_STYLE.mavi.dot}`}
        />
        {tf("mavi")}
      </span>
    </div>
    </>
  );
}
