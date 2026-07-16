"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  Fuel,
  Timer,
  Route,
  Hourglass,
  Milestone,
  Hexagon,
  AlertTriangle,
  Siren,
  ExternalLink,
  Thermometer,
  Zap,
  BatteryCharging,
  Signal,
  Activity,
  Barcode,
  ChevronDown,
  CheckCircle2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { HelpTip } from "@/components/help/HelpTip";
import { PenaltiesSection } from "./PenaltiesSection";
import { STATUS_STYLE } from "@/lib/vehicle-ui";
import { formatDate, formatTime, formatRelative, formatHoursMinutes } from "@/lib/format";
import type { VehicleDetail } from "@/lib/vehicles";
import type { TelemetryRow, VehicleEventRow, VehicleDtcRow } from "@/lib/telemetry";
import type { DtcText } from "@/lib/dtc-codes";
import { EVENT_ICON_STYLE, eventSeverity } from "@/lib/event-ui";
import type { EngineHoursResult } from "@/lib/metrics-engine-hours";
import type { DistanceResult } from "@/lib/metrics-distance";
import type { IdleResult } from "@/lib/metrics-idle";
import type { GeofenceResult } from "@/lib/metrics-geofence";
import { cn } from "@/lib/utils";

export function VehicleDetailClient({
  detail,
  telemetry,
  engineHours,
  distance,
  idle,
  geofence,
  events,
  dtc,
}: {
  detail: VehicleDetail;
  telemetry: TelemetryRow | null;
  engineHours: EngineHoursResult;
  distance: DistanceResult;
  idle: IdleResult;
  geofence: GeofenceResult;
  events: VehicleEventRow[];
  dtc: (VehicleDtcRow & { info: DtcText | null })[];
}) {
  const t = useTranslations("vehicles");
  const td = useTranslations("vehicles.detail");
  const tm = useTranslations("map");
  const ta = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const { vehicle: v, today } = detail;
  const st = STATUS_STYLE[v.live_status];
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const km = (n: number | null) => (n === null ? "—" : n.toLocaleString(nf));
  // Açık DTC detay paneli (accordion — aynı anda tek arıza açık).
  const [openDtc, setOpenDtc] = useState<string | null>(null);

  // Soft auto-refresh of the server-rendered data — same pattern as the live map
  // (LiveTrackingClient). Only refreshes while the tab is visible so a
  // backgrounded page doesn't poll needlessly. Independent of the LastSeen
  // relative-time interval, which is left untouched.
  useEffect(() => {
    const REFRESH_MS = 30_000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 px-4 py-6 sm:px-6">
      <Link
        href="/admin/araclar"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {td("back")}
      </Link>

      {/* Header */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-[16px] p-5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-muted-foreground">
          <Truck className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="nums text-xl font-semibold uppercase tracking-wide">{v.plate}</h2>
          <p className="text-sm text-muted-foreground">
            {[v.make, v.model, v.year].filter(Boolean).join(" · ") || "—"}
          </p>
          {v.vin && (
            <p className="nums mt-0.5 flex items-center gap-1 text-xs text-text-tertiary">
              <Barcode className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {tm("vin")}: {v.vin}
              </span>
            </p>
          )}
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

      {/* Live telemetry — device (FMC003) hardware GPS. Single most-recent fix;
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

              {/* FMC003 OBD/CAN — fuel level + vehicle odometer. Devices that
                  don't report OBD/CAN leave these null, so "—" until reported. */}
              <TeleField label={tm("fuel_level")} icon={Fuel}>
                {telemetry.fuel_level_pct !== null
                  ? `%${Math.round(telemetry.fuel_level_pct)}`
                  : "—"}
              </TeleField>

              <TeleField label={tm("vehicle_km")} icon={Milestone}>
                {telemetry.odometer_km !== null
                  ? `${Math.round(telemetry.odometer_km).toLocaleString(nf)} km`
                  : "—"}
              </TeleField>

              {/* Extended CAN/OBD (migration 021). These ride only engine-ECU
                  frames, so latestVehicleTelemetry back-fills each from the last
                  frame that reported it; still "—" until the device ever sends it. */}
              <TeleField label={tm("engine_rpm")} icon={Gauge}>
                {telemetry.engine_rpm !== null
                  ? telemetry.engine_rpm.toLocaleString(nf)
                  : "—"}
              </TeleField>

              <TeleField label={tm("coolant_temp")} icon={Thermometer}>
                {telemetry.coolant_temp_c !== null
                  ? `${Math.round(telemetry.coolant_temp_c)} °C`
                  : "—"}
              </TeleField>

              <TeleField label={tm("engine_load")} icon={Activity}>
                {telemetry.engine_load_pct !== null
                  ? `%${Math.round(telemetry.engine_load_pct)}`
                  : "—"}
              </TeleField>

              <TeleField label={tm("fuel_consumption")} icon={Fuel}>
                {telemetry.fuel_consumption !== null
                  ? telemetry.fuel_consumption.toLocaleString(nf, {
                      maximumFractionDigits: 1,
                    })
                  : "—"}
              </TeleField>

              <TeleField label={tm("power_voltage")} icon={Zap}>
                {telemetry.power_voltage !== null
                  ? `${telemetry.power_voltage.toFixed(1)} V`
                  : "—"}
              </TeleField>

              <TeleField label={tm("battery_voltage")} icon={BatteryCharging}>
                {telemetry.battery_voltage !== null
                  ? `${telemetry.battery_voltage.toFixed(2)} V`
                  : "—"}
              </TeleField>

              <TeleField label={tm("gsm_signal")} icon={Signal}>
                {telemetry.gsm_signal !== null
                  ? `%${Math.round(telemetry.gsm_signal)}`
                  : "—"}
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

              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
                  <Hourglass className="size-3.5" />
                  {tm("idle_today")}
                </span>
                {idle.points === 0 ? (
                  <span className="text-sm text-text-tertiary">{tm("no_data")}</span>
                ) : (
                  <span className="nums inline-flex items-center gap-1.5 text-base font-semibold">
                    {formatHoursMinutes(idle.totalIdleMs, locale)}
                    {idle.idleEvents > 0 && (
                      <span className="text-xs font-normal text-text-tertiary">
                        · {tm("idle_events", { count: idle.idleEvents })}
                      </span>
                    )}
                    {idle.uncertain && (
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

      {/* Mevcut Araç Hataları (vehicle_dtc, migrations 021+022). Sözlük eşleşmesi
          SUNUCUDA yapıldı (page.tsx → lookupDtc); buraya yalnız aktif kodların
          yerelleştirilmiş info'su iner. info === null → üretici-spesifik kod,
          tek fallback metni gösterilir (tanım asla uydurulmaz). */}
      {/* id="dtc" + scroll-mt: Yönetici'deki filo arıza kartı buraya derin
          link veriyor (/admin/araclar/{id}#dtc) — sticky başlığın altında kalmasın. */}
      <section id="dtc" className="glass scroll-mt-24 rounded-[16px] p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Wrench className="size-[18px] text-text-tertiary" />
          {tm("dtc_title")}
          {dtc.length > 0 && (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                dtc.length >= 3
                  ? "bg-destructive/15 text-destructive"
                  : "bg-accent-gold/15 text-accent-gold"
              )}
            >
              <AlertTriangle className="size-3" aria-hidden />
              {tm("dtc_active", { count: dtc.length })}
            </span>
          )}
        </h3>

        {dtc.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-accent-green">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            {tm("dtc_none")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {dtc.map((d) => (
              <DtcFaultRow
                key={d.id}
                fault={d}
                open={openDtc === d.id}
                onToggle={() => setOpenDtc(openDtc === d.id ? null : d.id)}
                currentOdometerKm={telemetry?.odometer_km ?? null}
                locale={locale}
                nf={nf}
              />
            ))}
          </ul>
        )}
      </section>

      {/* GPS geofence events — entry/exit against admin-defined zones
          (computeGeofenceEvents). Violations are flagged red. Distinct messages
          for "no active zones" vs "no telemetry today" vs "no events". */}
      <Section title={tm("geofence_today")} icon={Hexagon}>
        {geofence.zonesChecked === 0 ? (
          <p className="text-sm text-text-tertiary">
            {tm("no_zones")}{" "}
            <Link href="/admin/bolgeler" className="text-accent-sky hover:underline">
              {tm("manage_zones")}
            </Link>
          </p>
        ) : geofence.points === 0 ? (
          <p className="text-sm text-text-tertiary">{tm("no_data")}</p>
        ) : geofence.events.length === 0 ? (
          <p className="text-sm text-text-tertiary">{tm("no_geofence_events")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">
                {tm("geofence_events_count", { count: geofence.events.length })}
              </span>
              {geofence.violationCount > 0 && (
                <>
                  <span className="text-text-tertiary">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                    <AlertTriangle className="size-3.5" />
                    {tm("violations_count", { count: geofence.violationCount })}
                  </span>
                </>
              )}
              {geofence.uncertain && (
                <span
                  title={tm("estimated_hint")}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary"
                >
                  ~ {tm("estimated")}
                </span>
              )}
            </div>

            <ul className="-mx-1 divide-y divide-border">
              {geofence.events.map((e, i) => (
                <li
                  key={`${e.zoneId}-${i}`}
                  className="flex items-center gap-2.5 px-1 py-2"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      e.violation
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {e.violation ? (
                      <AlertTriangle className="size-3.5" />
                    ) : (
                      <Hexagon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="truncate font-medium">{e.zoneName}</span>
                    {e.violation && (
                      <span className="ml-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        {tm("violation")}
                      </span>
                    )}
                    <span className="nums ml-1.5 block text-xs text-text-tertiary sm:ml-1.5 sm:inline">
                      {formatTime(e.entryTime, locale)}–
                      {e.exitTime ? formatTime(e.exitTime, locale) : tm("ongoing")}
                    </span>
                  </span>
                  <span className="nums shrink-0 text-right text-xs text-text-tertiary">
                    {formatHoursMinutes(e.dwellMs, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Son olaylar (alarmlar) — cihazın bildirdiği sürüş/güvenlik olayları */}
      <Section title={ta("recent_events")} icon={Siren}>
        {events.length === 0 ? (
          <p className="text-sm text-text-tertiary">{ta("no_recent_events")}</p>
        ) : (
          <ul className="-mx-1 divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-2.5 px-1 py-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    EVENT_ICON_STYLE[eventSeverity(e.event_type)]
                  )}
                >
                  <AlertTriangle className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{ta(`type.${e.event_type}`)}</span>
                  <span className="nums ml-1.5 block text-xs text-text-tertiary sm:ml-1.5 sm:inline">
                    {formatDate(e.occurred_at, locale)} · {formatTime(e.occurred_at, locale)}
                  </span>
                </span>
                {e.speed_kmh !== null && (
                  <span className="nums shrink-0 text-right text-xs text-text-tertiary">
                    {Math.round(e.speed_kmh)} km/h
                  </span>
                )}
                {e.latitude !== null && e.longitude !== null && (
                  <a
                    href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-sky hover:underline"
                  >
                    {ta("view_on_map")}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
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

      {/* Penalties (Strafe) */}
      <PenaltiesSection vehicleId={v.id} penalties={detail.penalties} />

      {/* Route history / replay */}
      <div className="glass flex items-center justify-between rounded-[16px] px-4 py-3.5">
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
    <section className="glass rounded-[16px] p-5">
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

/**
 * Tek aktif arıza satırı: KOD + kısa başlık + "X gündür aktif · Y km" rozetleri;
 * tıklanınca 4 alanlı detay paneli genişler (Tanım / Neresi arızalı /
 * Belirtiler / İhmal edilirse). info === null → sözlük dışı (üretici-spesifik)
 * kod: detayda tek fallback cümlesi, asla uydurma tanım yok.
 */
function DtcFaultRow({
  fault,
  open,
  onToggle,
  currentOdometerKm,
  locale,
  nf,
}: {
  fault: VehicleDtcRow & { info: DtcText | null };
  open: boolean;
  onToggle: () => void;
  currentOdometerKm: number | null;
  locale: string;
  nf: string;
}) {
  const tm = useTranslations("map");

  // "X gündür aktif" — gün granülaritesi; 0 gün → "bugün tespit edildi".
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(fault.first_seen).getTime()) / 86_400_000)
  );
  // "o günden beri Y km" — güncel odometer − ilk görülme km'si; veri yoksa "—".
  const kmSince =
    currentOdometerKm !== null && fault.first_seen_odometer_km !== null
      ? Math.max(0, Math.round(currentOdometerKm - fault.first_seen_odometer_km))
      : null;

  const detailId = `dtc-detail-${fault.id}`;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 py-2.5 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="nums font-mono text-sm font-semibold text-accent-gold">
          {fault.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {fault.info ? fault.info.title : tm("dtc_unknown_title")}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
          {days === 0 ? tm("dtc_today") : tm("dtc_active_days", { days })}
        </span>
        <span className="nums rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
          {kmSince !== null
            ? tm("dtc_km_since", { km: kmSince.toLocaleString(nf) })
            : "—"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-text-tertiary transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div id={detailId} className="space-y-2.5 pb-3 pl-1 pr-1">
          {fault.info ? (
            <>
              <DtcDetailField label={tm("dtc_field_def")}>
                {fault.code}: {fault.info.title}
              </DtcDetailField>
              <DtcDetailField label={tm("dtc_field_part")}>
                {fault.info.part}
              </DtcDetailField>
              <DtcDetailField label={tm("dtc_field_symptoms")}>
                {fault.info.symptoms}
              </DtcDetailField>
              <DtcDetailField label={tm("dtc_field_risk")}>
                {fault.info.risk}
              </DtcDetailField>
            </>
          ) : (
            <p className="text-sm text-text-tertiary">{tm("dtc_unknown")}</p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
            {fault.standard && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                {fault.standard}
              </span>
            )}
            {tm("dtc_since")}: {formatDate(fault.first_seen, locale)}
          </p>
        </div>
      )}
    </li>
  );
}

function DtcDetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.03em] text-text-tertiary">
        {label}
      </p>
      <p className="mt-0.5 text-sm leading-relaxed">{children}</p>
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
