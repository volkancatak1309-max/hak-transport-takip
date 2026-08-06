"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import Link from "next/link";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import { useLocale, useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";
import { FLEET_STYLE, fleetLabel } from "@/lib/vehicle-ui";
import { ACTIVE_FLEETS } from "@/lib/tenant";
import { formatRelative, formatTime } from "@/lib/format";
import {
  VEHICLE_FRESH_MS,
  type ActiveVehicle,
  type VehicleFleet,
} from "@/lib/types";

const AUSTRIA_CENTER: [number, number] = [47.5162, 14.5501];

// Fixes older than this stay OFF the auto-fit frame (markers still render).
const BOUNDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Vehicle (hardware-tracker) marker — a plate pill, visually distinct from the
// round driver pin. Pill color = FLEET (migration 023): bordo filo = claret,
// mavi filo = sky — working or idle, the fleet reads at a glance; ignition
// lives in the popup. Freshness dims but NEVER hides the fleet: stale (no fix
// within VEHICLE_FRESH_MS) keeps the fleet color at low saturation + opacity
// (pale bordo / pale mavi, not gray) via `.is-stale`, with the "son görülme"
// tooltip — the vehicle stays on the map, age AND fleet both readable at a
// glance. The mavi pill uses dark text: white on sky is ~3.2:1, under AA for
// 11px text (claret is dark enough for white). Layout/hover styling lives in
// globals.css (.hak-veh-pill); only the dynamic fleet colors are inline.
function makeVehicleIcon(
  plate: string,
  fleet: VehicleFleet,
  stale: boolean
): L.DivIcon {
  // FİLO KİMLİK TOKEN'I — accent DEĞİL (07.08.2026). Burası FLEET_STYLE'ı
  // atlayan İKİNCİ kaynaktı: renkler `var(--accent-*)` ve `#0c1626` olarak
  // sabit basılıyordu, dolayısıyla müşteriye göre ezilemiyordu. Artık
  // globals.css'teki --fleet-* ailesinden okunur; HAK61'de hesaplanan değer
  // birebir eskisidir (bordo→claret+beyaz, mavi→sky+#0c1626).
  const bg = `var(--fleet-${fleet})`;
  const fg = `var(--fleet-${fleet}-fg)`;
  return L.divIcon({
    className: `hak-veh-wrap veh-${fleet}${stale ? " is-stale" : ""}`,
    html:
      `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%">` +
      `<div class="hak-veh-pill" style="background:${bg};color:${fg}">` +
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

/**
 * List ↔ map hover sync. Driven imperatively so a hover NEVER re-renders the
 * markers (perf rule: 19 markers must not rebuild on hover). On `hoveredVehicleId`
 * change it toggles `.is-focused` / `hak-map-syncing` classes on the existing
 * marker DOM and, only when the focused marker is off-screen, softly `panTo`s to
 * it (zoom unchanged). `vehicles` is a dep so focus re-applies after a 30 s data
 * refresh swaps the marker elements (setIcon). Reduced-motion → instant pan.
 */
function HoverSync({
  hoveredVehicleId,
  markers,
  vehicles,
}: {
  hoveredVehicleId: string | null;
  markers: React.RefObject<Map<string, L.Marker>>;
  vehicles: ActiveVehicle[];
}) {
  const map = useMap();
  useEffect(() => {
    const reg = markers.current;
    if (!reg) return;
    const container = map.getContainer();
    let target: L.LatLng | null = null;
    reg.forEach((m, id) => {
      const focused = id === hoveredVehicleId;
      const el = m.getElement();
      if (el) el.classList.toggle("is-focused", focused);
      m.setZIndexOffset(focused ? 1000 : 0);
      if (focused) target = m.getLatLng();
    });
    if (hoveredVehicleId && target) {
      container.classList.add("hak-map-syncing");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // pad(-0.12) shrinks the viewport so near-edge markers also pan into clear
      // view. panTo keeps zoom; low easeLinearity = a gentle glide.
      if (!map.getBounds().pad(-0.12).contains(target)) {
        map.panTo(target, { animate: !reduce, duration: 0.6, easeLinearity: 0.2 });
      }
    } else {
      container.classList.remove("hak-map-syncing");
    }
  }, [hoveredVehicleId, map, markers, vehicles]);
  return null;
}

export const FleetMap = memo(function FleetMap({
  vehicles = [],
  hoveredVehicleId = null,
}: {
  vehicles?: ActiveVehicle[];
  /** Vehicle currently hovered/focused in the side list (or null). */
  hoveredVehicleId?: string | null;
}) {
  const t = useTranslations("map");
  // `vehicles` kökünde: fleetLabel içeride `fleet.<kod>` anahtarına iniyor.
  // Daha dar bir kökle (eski hâli "vehicles.fleet") anahtar iki kez eklenirdi.
  const tf = useTranslations("vehicles");
  const locale = useLocale();

  // Registry of live Leaflet markers by vehicle id — HoverSync reads it to focus
  // a marker without a React re-render.
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Harita YALNIZ araç plaka katmanını gösterir — şoför isim marker'ları/rota
  // çizgileri haritadan KALDIRILDI (isim baloncukları plaka etiketleriyle iç içe
  // geçiyordu). Şoförler + konum durumu artık yalnız yan panel listesinde
  // (LiveTrackingClient); harita ile liste ayrı katmanlar.
  // Age cap ONLY for the frame: weeks-dead trackers (sold vehicle, ripped-out
  // device) must not zoom the whole fleet view out — their markers still render,
  // just outside the initial frame. Without this, one far-away stale fix would
  // reset the viewport to fleet+outlier on every 30 s refresh.
  const points = useMemo(() => {
    const boundsCutoff = Date.now() - BOUNDS_MAX_AGE_MS;
    return vehicles
      .filter((v) => new Date(v.recorded_at).getTime() >= boundsCutoff)
      .map((v) => [v.latitude, v.longitude] as [number, number]);
  }, [vehicles]);

  // Vehicle layer (hardware GPS) — separate from the driver layer above. Every
  // device vehicle is here (no recency window); stale ones render as their pale
  // fleet tone with a "son görülme" tooltip instead of dropping off. Each marker
  // registers its Leaflet instance so HoverSync can focus it when the matching
  // list row is hovered (list → map only; marker hover no longer drives the list).
  const vehicleMarkers = useMemo(() => {
    const now = Date.now();
    return vehicles.map((v) => {
      const stale = now - new Date(v.recorded_at).getTime() >= VEHICLE_FRESH_MS;
      return (
        <Marker
          key={`veh-${v.vehicle_id}`}
          position={[v.latitude, v.longitude]}
          icon={makeVehicleIcon(v.plate, v.fleet, stale)}
          ref={(m) => {
            if (m) markersRef.current.set(v.vehicle_id, m);
            else markersRef.current.delete(v.vehicle_id);
          }}
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
                    göstermek soluk ikonla çelişir, uydurma olur: "—". */}
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
              {/* İki giriş aynı satırda, eşit görsel ağırlıkta. whitespace-nowrap
                  + justify-between: popup içeriğe göre büyür (Leaflet maxWidth 300)
                  ama satır kırılmaz, mobilde de taşmaz. */}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                <Link
                  href={`/admin/araclar/${v.vehicle_id}`}
                  className="whitespace-nowrap text-xs font-medium text-primary hover:underline"
                >
                  {t("view_detail")} →
                </Link>
                <Link
                  href={`/admin/araclar/${v.vehicle_id}/rota`}
                  className="whitespace-nowrap text-xs font-medium text-primary hover:underline"
                >
                  {t("route_history")} →
                </Link>
              </div>
            </div>
          </Popup>
        </Marker>
      );
    });
  }, [vehicles, t, locale]);

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
        <HoverSync
          hoveredVehicleId={hoveredVehicleId}
          markers={markersRef}
          vehicles={vehicles}
        />
        {vehicleMarkers}
      </MapContainer>
      {/* Filo lejantı — KULLANILAN filoların rengi + adı (migration 023 +
          lib/tenant.ts ACTIVE_FLEETS). 03.08.2026'ya kadar burada 'bordo' ve
          'mavi' SABİT basılıyordu: tek filolu Sendigo'da haritanın lejantı
          olmayan bir filoyu ilan ediyordu (Araçlar sayfasındaki aynı kusur
          31.07'de kapanmış, harita geride kalmıştı). Etiket de fleetLabel'dan
          gelir — env ile "Flotte" diyen müşteride lejant da onu yazar.

          Haritayı saran kapsayıcı relative (LiveTrackingClient); leaflet
          pane'lerinin üstünde
          (z-1000), tıklamayı harita alır. Yüzey glass-pop: bg-background koyu
          temada TRANSPARENT (bilinen Splash tuzağı) — açık harita üstünde küçük
          metin ancak yoğun dolguyla okunur. Örnekler DİKDÖRTGEN + açık kenarlı:
          yuvarlak sky nokta şoför pinleriyle karışırdı, kenarsız bordo dolgu ise
          koyu zeminde 1.3:1 ile kaybolurdu (WCAG 1.4.11). */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] space-y-1 rounded-[10px] glass-pop px-3 py-2 text-xs font-medium">
        {ACTIVE_FLEETS.map((f) => (
          <span key={f} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-3 w-5 shrink-0 rounded-[4px] border border-white/45 ${FLEET_STYLE[f as VehicleFleet].dot}`}
            />
            {fleetLabel(f, tf)}
          </span>
        ))}
        {/* Bayat işaretçi soluk filo tonunda (gri DEĞİL) — örnek, pildeki
            saturate filtresinin aynısıyla çizilir; opaklık kısılmaz ki koyu
            glass zemininde örnek kaybolmasın (1.4.11 dersi). Bu satır FİLO
            DEĞİL DURUM açıklamasıdır, o yüzden tek filoda da kalır; yalnız
            örnekleri kullanılan filo sayısınca çizilir. */}
        <span className="flex items-center gap-2">
          <span aria-hidden className="flex shrink-0 items-center gap-1" style={{ filter: "saturate(.4)" }}>
            {ACTIVE_FLEETS.map((f) => (
              <span
                key={f}
                className={`h-3 w-5 rounded-[4px] border border-white/45 ${FLEET_STYLE[f as VehicleFleet].dot}`}
              />
            ))}
          </span>
          {t("legend_stale", { min: VEHICLE_FRESH_MS / 60000 })}
        </span>
      </div>
    </>
  );
});
