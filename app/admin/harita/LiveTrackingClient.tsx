"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MapPinned, ChevronRight, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { HelpTip } from "@/components/help/HelpTip";
import { SubTabs } from "@/components/ui-v2";
import { formatRelative, formatTime, formatDurationShort } from "@/lib/format";
import { FLEET_STYLE } from "@/lib/vehicle-ui";
import { cn } from "@/lib/utils";
import {
  VEHICLE_FRESH_MS,
  type ActiveDriver,
  type ActiveVehicle,
  type VehicleFleet,
} from "@/lib/types";

/** Filo kimlik rengi (CSS var) — vurgulanan satırın sol aksan çubuğu için. */
const FLEET_VAR: Record<VehicleFleet, string> = {
  bordo: "var(--accent-claret)",
  mavi: "var(--accent-sky)",
};

const FleetMap = dynamic(
  () => import("@/components/FleetMap").then((m) => m.FleetMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  }
);

const REFRESH_MS = 30_000;
const NINE_HOURS_MS = 9 * 60 * 60 * 1000;

type Summary = {
  activeShifts: number;
  longestMs: number;
  overLimit: number;
};

export function LiveTrackingClient({
  drivers,
  vehicles,
  summary,
  serverNow,
}: {
  drivers: ActiveDriver[];
  vehicles: ActiveVehicle[];
  summary: Summary;
  /** Server render clock — the initial `now` so SSR HTML and hydration compute
   *  identical freshness/durations (no boundary-crossing hydration mismatch). */
  serverNow: number;
}) {
  const t = useTranslations("map");
  const tf = useTranslations("vehicles.fleet");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  // Reveal canlı-harita panelinin sekmeleri (kişi / araç ikonları). Araçlar
  // haritada görünüyordu ama listelenmiyordu — Reveal paneli ikisini de listeler.
  const [panelTab, setPanelTab] = useState<"drivers" | "vehicles">("drivers");

  // Liste → harita hover senkronu (TEK YÖN). Liste satırına hover/focus o aracın
  // işaretçisini haritada öne çıkarır (HoverSync `.is-focused` + gerekirse panTo).
  // TERS YÖN KALDIRILDI: marker'a hover artık listeyi ne vurgular ne kaydırır —
  // sayfa sürekli oynuyordu (Volkan geri bildirimi). `hovered` = vurgulu araç id.
  const [hovered, setHovered] = useState<string | null>(null);

  // Soft auto-refresh of server data + a 1s tick for live durations.
  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router]);

  // Tazelik: son VEHICLE_FRESH_MS içinde veri = canlı; daha eskisi bayat ama
  // listeden/haritadan DÜŞMEZ — bayatlar altta, soluk, "son görülme" ile.
  const isFresh = (v: ActiveVehicle) =>
    now - new Date(v.recorded_at).getTime() < VEHICLE_FRESH_MS;
  const liveCount = vehicles.filter(isFresh).length;
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const fa = isFresh(a) ? 0 : 1;
    const fb = isFresh(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
      {/* Başlık bloğu — klon A2 ölçüsü */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight">{t("live_title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <HelpTip tkey="map" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi_active")} value={String(summary.activeShifts)} accent="sky" live={summary.activeShifts > 0} />
        <Kpi
          label={t("kpi_on_map")}
          value={String(vehicles.length)}
          sub={t("kpi_live_count", { count: liveCount })}
        />
        <Kpi
          label={t("kpi_longest")}
          value={summary.longestMs > 0 ? formatDurationShort(summary.longestMs, locale) : "—"}
        />
        <Kpi
          label={tAdmin("overLimit")}
          value={String(summary.overLimit)}
          accent={summary.overLimit > 0 ? "gold" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        {/* Map */}
        <section className="glass overflow-hidden rounded-[16px]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <MapPinned className="size-[18px] text-accent-claret-text" />
              <span className="text-sm font-medium">{t("title")}</span>
              <HelpTip tkey="map" />
            </div>
            <span className="nums text-xs text-text-tertiary">
              {drivers.length + vehicles.length}
            </span>
          </div>
          <div className="relative h-[58vh] min-h-[420px] w-full">
            {/* Harita YALNIZ araç plaka katmanı — şoför isim marker'ları
                kaldırıldı. Şoförler + konum durumu aşağıdaki yan panelde. */}
            <FleetMap
              vehicles={vehicles}
              hoveredVehicleId={hovered}
            />
            {drivers.length === 0 && vehicles.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
                <span className="rounded-[10px] border border-border bg-background/90 px-4 py-2 text-sm text-muted-foreground elevate">
                  {t("no_active")}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Yan panel — Reveal canlı-harita paneli: sekme şeridi + liste */}
        <section className="glass flex flex-col overflow-hidden rounded-[16px]">
          <SubTabs
            className="px-4 pt-2"
            tabs={[
              { key: "drivers", label: `${t("tab_drivers")} (${drivers.length})` },
              { key: "vehicles", label: `${t("tab_vehicles")} (${vehicles.length})` },
            ]}
            value={panelTab}
            onChange={(k) => setPanelTab(k as "drivers" | "vehicles")}
          />

          {panelTab === "vehicles" ? (
            vehicles.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t("no_vehicles")}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {sortedVehicles.map((v) => {
                  const fresh = isFresh(v);
                  const isHi = hovered === v.vehicle_id;
                  return (
                    <li key={v.vehicle_id}>
                      <Link
                        href={`/admin/araclar/${v.vehicle_id}`}
                        onMouseEnter={() => setHovered(v.vehicle_id)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(v.vehicle_id)}
                        onBlur={() => setHovered(null)}
                        className={cn(
                          "group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2",
                          isHi && "bg-surface-2",
                          !fresh && (isHi ? "opacity-100" : "opacity-60 hover:opacity-100")
                        )}
                        style={isHi ? { boxShadow: `inset 3px 0 0 ${FLEET_VAR[v.fleet]}` } : undefined}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-muted-foreground">
                          <Truck className="size-[18px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="nums truncate text-sm font-semibold uppercase tracking-wide">
                              {v.plate}
                            </span>
                            {/* Filo rozeti (migration 023) — metinli, /admin/araclar
                                ile aynı desen; renk tek kanal olmasın (WCAG 1.4.1).
                                Kontak noktası sky anlamını korur (klon spec G4),
                                filo kimliği bu çipte. */}
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                FLEET_STYLE[v.fleet].chip
                              )}
                            >
                              {tf(v.fleet)}
                            </span>
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                fresh && v.ignition_on ? "bg-accent-sky" : "bg-text-tertiary"
                              )}
                              aria-hidden
                            />
                            <span className="truncate text-xs text-text-tertiary">
                              {/* Bayatken kontak durumu bilinmiyor — gri noktayla
                                  çelişen son-bilinen "açık" yerine "—". */}
                              {fresh
                                ? v.ignition_on
                                  ? t("ignition_on")
                                  : t("ignition_off")
                                : "—"}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs">
                            <span className="nums text-muted-foreground">
                              {v.speed_kmh != null ? `${Math.round(v.speed_kmh)} km/h` : "—"}
                            </span>
                            <span className="text-text-tertiary">·</span>
                            <span className="nums text-text-tertiary">
                              {fresh
                                ? t("last_update", { time: formatTime(v.recorded_at, locale) })
                                : t("last_seen", { ago: formatRelative(v.recorded_at, locale) })}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-text-tertiary transition-colors group-hover:text-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )
          ) : drivers.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {t("no_active")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {drivers.map((d) => {
                const activeMs = Math.max(0, now - new Date(d.shift_started_at).getTime());
                const over = activeMs > NINE_HOURS_MS;
                return (
                  <li key={d.worker_id}>
                    <Link
                      href={`/admin/workers/${d.worker_id}`}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <div className="relative">
                        <UserAvatar name={d.name} size="sm" />
                        {/* Konum durumu noktası: canlı = yeşil nabız, son bilinen =
                            amber, konum bekleniyor = gri. Şoför her durumda listede. */}
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
                            d.locStatus === "live"
                              ? "live-dot"
                              : d.locStatus === "stale"
                                ? "bg-accent-gold"
                                : "bg-text-tertiary"
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{d.name}</span>
                          <span className="nums text-xs text-text-tertiary">{d.plate ?? "—"}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs">
                          <span className={over ? "nums text-accent-gold" : "nums text-muted-foreground"}>
                            {formatDurationShort(activeMs, locale)}
                          </span>
                          <span className="text-text-tertiary">·</span>
                          {d.locStatus === "waiting" ? (
                            <span className="text-text-tertiary">{t("awaiting_location")}</span>
                          ) : (
                            <span className="nums text-text-tertiary">
                              {t(d.locStatus === "live" ? "last_update" : "last_known", {
                                time: formatTime(d.recorded_at, locale),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-text-tertiary transition-colors group-hover:text-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
  live,
}: {
  label: string;
  value: string;
  /** Small freshness breakdown next to the value, e.g. "16 canlı". */
  sub?: string;
  accent?: "sky" | "gold";
  live?: boolean;
}) {
  const valueColor =
    accent === "sky"
      ? "text-accent-sky"
      : accent === "gold"
      ? "text-accent-gold"
      : "text-foreground";
  return (
    <div className="glass card-kpi rounded-[16px] px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {live && <span className="live-dot" />}
        <span className="text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`nums text-[28px] font-semibold leading-none ${valueColor}`}>
          {value}
        </span>
        {sub && (
          <span className="nums text-[12px] font-medium text-text-tertiary">{sub}</span>
        )}
      </div>
    </div>
  );
}
