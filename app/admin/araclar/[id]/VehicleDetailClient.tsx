"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  UserRound,
  Gauge,
  Clock,
  Package,
  Truck,
  FileText,
  History,
  MapPinned,
  Radio,
  Compass,
  Navigation,
  MapPin,
  Timer,
  Route,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { HelpTip } from "@/components/help/HelpTip";
import { KmEditButton } from "@/components/KmEditButton";
import { STATUS_STYLE } from "@/lib/vehicle-ui";
import { formatDate, formatTime, formatRelative, formatHoursMinutes } from "@/lib/format";
import type { VehicleDetail } from "@/lib/vehicles";
import type { TelemetryRow } from "@/lib/telemetry";
import type { EngineHoursResult } from "@/lib/metrics-engine-hours";
import type { DistanceResult } from "@/lib/metrics-distance";
import { cn } from "@/lib/utils";

export function VehicleDetailClient({
  detail,
  telemetry,
  engineHours,
  distance,
}: {
  detail: VehicleDetail;
  telemetry: TelemetryRow | null;
  engineHours: EngineHoursResult;
  distance: DistanceResult;
}) {
  const t = useTranslations("vehicles");
  const td = useTranslations("vehicles.detail");
  const tm = useTranslations("map");
  const locale = useLocale();
  const { vehicle: v, today, recent } = detail;
  const st = STATUS_STYLE[v.live_status];
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const km = (n: number | null) => (n === null ? "—" : n.toLocaleString(nf));

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-4 py-6 sm:px-6">
      <Link
        href="/admin/araclar"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {td("back")}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-muted-foreground">
          <Truck className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="nums text-xl font-semibold uppercase tracking-wide">{v.plate}</h2>
          <p className="text-sm text-muted-foreground">
            {[v.make, v.model, v.year].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
            st.chip
          )}
        >
          {st.live ? <span className="live-dot" /> : <span className={cn("size-1.5 rounded-full", st.dot)} />}
          {t(`status.${st.labelKey}`)}
        </span>
        <HelpTip tkey="veh_status" className="ml-1" />
      </div>

      {/* Live telemetry — device (FMC920) hardware GPS. Single most-recent fix;
          the live-map vehicle popup deep-links here, so this surfaces what it
          promises. No recency window: shows the last known fix with its age. */}
      <Section title={tm("live_location")} icon={Radio}>
        {telemetry ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <TeleField label={tm("ignition")} icon={Gauge}>
                <Badge
                  variant="secondary"
                  className={cn(
                    telemetry.ignition_on === true
                      ? "bg-accent-green/15 text-accent-green"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      telemetry.ignition_on === true
                        ? "bg-accent-green"
                        : "bg-muted-foreground"
                    )}
                  />
                  {telemetry.ignition_on === true
                    ? tm("ignition_on")
                    : telemetry.ignition_on === false
                      ? tm("ignition_off")
                      : "—"}
                </Badge>
              </TeleField>

              <TeleField label={tm("vehicle_speed")} icon={Gauge}>
                {telemetry.speed_kmh !== null
                  ? `${Math.round(telemetry.speed_kmh)} km/h`
                  : "—"}
              </TeleField>

              <TeleField label={tm("heading")} icon={Compass}>
                {telemetry.heading !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Navigation
                      className="size-3.5 shrink-0 text-accent-sky"
                      style={{ transform: `rotate(${telemetry.heading}deg)` }}
                      aria-hidden
                    />
                    {tm(`compass.${compassKey(telemetry.heading)}`)} ·{" "}
                    {telemetry.heading}°
                  </span>
                ) : (
                  "—"
                )}
              </TeleField>

              <TeleField label={tm("coordinates")} icon={MapPin}>
                {telemetry.latitude.toFixed(5)}, {telemetry.longitude.toFixed(5)}
              </TeleField>
            </dl>

            {/* Today's device-GPS metrics — engine runtime (computeEngineHours)
                and distance (computeDistanceKm), both from raw telemetry. These
                are NOT flespi analytics and NOT the manual odometer km shown in
                the "Bugün" card. "Veri yok" when the device sent nothing today;
                "~ tahmini" when a gap/clamp made the figure approximate. */}
            <div className="space-y-2.5 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
                  <Timer className="size-3.5" />
                  {tm("engine_hours_today")}
                </span>
                {engineHours.points === 0 ? (
                  <span className="text-sm text-text-tertiary">{tm("no_data")}</span>
                ) : (
                  <span className="nums inline-flex items-center gap-1.5 text-base font-semibold">
                    {formatHoursMinutes(engineHours.ms, locale)}
                    {engineHours.uncertain && (
                      <span
                        title={tm("estimated_hint")}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary"
                      >
                        ~ {tm("estimated")}
                      </span>
                    )}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
                  <Route className="size-3.5" />
                  {tm("gps_distance_today")}
                </span>
                {distance.points === 0 ? (
                  <span className="text-sm text-text-tertiary">{tm("no_data")}</span>
                ) : (
                  <span className="nums inline-flex items-center gap-1.5 text-base font-semibold">
                    {distance.km.toLocaleString(nf, { maximumFractionDigits: 1 })} km
                    {distance.uncertain && (
                      <span
                        title={tm("estimated_hint")}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary"
                      >
                        ~ {tm("estimated")}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <Clock className="size-3.5 shrink-0" />
              <LastSeen iso={telemetry.recorded_at} locale={locale} />
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-tertiary">{tm("no_device_data")}</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Current driver */}
        <Section title={td("current_driver")} icon={UserRound}>
          {v.driver_name ? (
            <div className="flex items-center gap-3">
              <UserAvatar name={v.driver_name} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{v.driver_name}</div>
                <div className="text-xs text-text-tertiary">
                  {v.driver_is_live ? t(`status.${st.labelKey}`) : t("assigned_label")}
                </div>
              </div>
              {v.driver_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  render={<Link href={`/admin/workers/${v.driver_id}`} />}
                >
                  {td("driver")}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">{td("no_active_driver")}</p>
          )}
        </Section>

        {/* Today */}
        <Section title={td("today")} icon={Gauge}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label={td("today_km")} value={today.km === null ? "—" : `${km(today.km)} km`} big />
            <Field
              label={td("start_end_km")}
              value={`${km(today.startKm)} → ${km(today.endKm)}`}
            />
            <Field
              label={td("times")}
              value={`${today.firstStart ? formatTime(today.firstStart, locale) : "—"} → ${
                today.lastEnd ? formatTime(today.lastEnd, locale) : "—"
              }`}
              icon={Clock}
            />
            <Field
              label={td("packages")}
              value={`${today.startPackages ?? "—"} → ${today.endPackages ?? "—"}`}
              icon={Package}
            />
          </dl>
        </Section>

        {/* Vehicle info */}
        <Section title={td("vehicle_info")} icon={Truck}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label={td("make_model")} value={[v.make, v.model].filter(Boolean).join(" ") || "—"} />
            <Field label={td("year")} value={v.year ? String(v.year) : "—"} />
            <Field label={td("plate")} value={v.plate} />
            <Field label={td("base_status")} value={t(`status.${st.labelKey}`)} />
          </dl>
        </Section>

        {/* Documents & inspection (placeholders) */}
        <Section title={td("documents")} icon={FileText} help="veh_inspection">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field
              label={td("inspection_due")}
              value={v.inspection_due ? formatDate(v.inspection_due, locale) : td("not_set")}
              muted={!v.inspection_due}
            />
            <Field
              label={td("insurance_due")}
              value={v.insurance_due ? formatDate(v.insurance_due, locale) : td("not_set")}
              muted={!v.insurance_due}
            />
          </dl>
        </Section>
      </div>

      {/* Route history / replay */}
      <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-card px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPinned className="size-4 text-accent-sky" />
          {td("route_history")}
          <HelpTip tkey="veh_route" />
        </div>
        <Button variant="outline" size="sm" render={<Link href={`/admin/araclar/${v.id}/rota`} />}>
          <History className="size-4" />
          {td("route_history")}
        </Button>
      </div>

      {/* Recent movements */}
      <Section title={td("recent")} icon={History}>
        {recent.length === 0 ? (
          <p className="text-sm text-text-tertiary">{td("no_recent")}</p>
        ) : (
          <ul className="-mx-1 divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{formatDate(r.date, locale)}</span>
                    {!r.ended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-sky/15 px-2 py-0.5 text-[10px] font-medium text-accent-sky">
                        <span className="live-dot" /> {td("active_now")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-tertiary">
                    <UserRound className="size-3.5" />
                    <span className="truncate">{r.driver_name ?? "—"}</span>
                  </div>
                </div>
                <div className="nums shrink-0 text-right text-sm">
                  {r.km !== null ? `${km(r.km)} km` : "—"}
                </div>
                <KmEditButton entryId={r.id} startKm={r.start_km} endKm={r.end_km} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  help,
  children,
}: {
  title: string;
  icon: typeof Truck;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Icon className="size-[18px] text-text-tertiary" />
        {title}
        {help && <HelpTip tkey={help} />}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  icon: Icon,
  big,
  muted,
}: {
  label: string;
  value: string;
  icon?: typeof Truck;
  big?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd
        className={cn(
          "nums mt-1 truncate",
          big ? "text-lg font-semibold" : "text-sm",
          muted && "text-text-tertiary"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Like Field, but the value is arbitrary JSX (badge, icon, etc.). */
function TeleField({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: typeof Truck;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd className="nums mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

const COMPASS_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
/** Map a 0..359 heading to one of 8 compass points (i18n key suffix). */
function compassKey(heading: number): (typeof COMPASS_KEYS)[number] {
  const idx = Math.round((((heading % 360) + 360) % 360) / 45) % 8;
  return COMPASS_KEYS[idx];
}

/**
 * "Son güncelleme: 5 dakika önce". Renders the absolute time on the server and
 * first paint (deterministic — no hydration drift), then upgrades to a relative,
 * self-refreshing label after mount.
 */
function LastSeen({ iso, locale }: { iso: string; locale: string }) {
  const tm = useTranslations("map");
  const [time, setTime] = useState<string>(() => formatTime(iso, locale));
  useEffect(() => {
    const tick = () => setTime(formatRelative(iso, locale));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [iso, locale]);
  return <>{tm("last_update", { time })}</>;
}
