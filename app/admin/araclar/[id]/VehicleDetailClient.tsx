"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Truck,
  History,
  MapPin,
  ExternalLink,
  AlertTriangle,
  Hexagon,
  Wrench,
  ChevronDown,
  UserRound,
  Inbox,
} from "lucide-react";
import { HelpTip } from "@/components/help/HelpTip";
import { PenaltiesSection } from "./PenaltiesSection";
import { VehicleFormDialog } from "@/components/admin/VehicleFormDialog";
import {
  DetailColumns,
  SpecGroup,
  SpecRow,
  RailSection,
  RailCard,
  type RailTone,
} from "@/components/ui-v2";
import { STATUS_STYLE, FLEET_STYLE, fleetLabel } from "@/lib/vehicle-ui";
import {
  formatDate,
  formatTime,
  formatRelative,
  formatHoursMinutes,
} from "@/lib/format";
import type { VehicleDetail } from "@/lib/vehicles";
import type { TelemetryRow, VehicleEventRow, VehicleDtcRow } from "@/lib/telemetry";
import type { DtcText } from "@/lib/dtc-codes";
import { eventTone } from "@/lib/event-ui";
import type { EngineHoursResult } from "@/lib/metrics-engine-hours";
import type { DistanceResult } from "@/lib/metrics-distance";
import type { IdleResult } from "@/lib/metrics-idle";
import type { GeofenceResult } from "@/lib/metrics-geofence";
import { cn } from "@/lib/utils";

// Leaflet DOM'a bağlı — sunucuda render edilemez.
const VehicleMiniMap = dynamic(
  () => import("@/components/VehicleMiniMap").then((m) => m.VehicleMiniMap),
  { ssr: false }
);

const DASH = "—";

/** Rayda gösterilen azami olay. Kesme SESSİZ değil: altına kaç olaydan kaçının
 *  gösterildiği yazılır (yoksa "hepsi bu" diye okunur). */
const RAIL_LIMIT = 20;

/**
 * ARAÇ DETAYI — Enode geliştirici konsolu klonu (DESIGN.md §0 DESTEK D).
 *
 * Üç kolon: nav (kabuk) · orta künye · sağ olay rayı. Orta kolon aracın NE
 * OLDUĞUNU tek bir satır gramerinde anlatır (etiket solda / değer sağda);
 * sağ kolon aracın BAŞINA NE GELDİĞİNİ kronolojik kartlarla anlatır.
 *
 * Eski sayfadaki "her ölçü kendi kartında" düzeni bilinçli olarak terk edildi:
 * 9 ayrı kart, 4 farklı satır dili ve ikisi birbirini tekrar eden iki KM bloğu
 * vardı. Ölçüm ile kimlik artık aynı gramerle okunuyor.
 */
export function VehicleDetailClient({
  detail,
  telemetry,
  engineHours,
  distance,
  idle,
  geofence,
  events,
  dtc,
  drivers,
}: {
  detail: VehicleDetail;
  telemetry: TelemetryRow | null;
  engineHours: EngineHoursResult;
  distance: DistanceResult;
  idle: IdleResult;
  geofence: GeofenceResult;
  events: VehicleEventRow[];
  dtc: (VehicleDtcRow & { info: DtcText | null })[];
  /** Künye satırındaki "Düzenle" formunun şoför seçimi için. */
  drivers: { id: string; name: string; is_active: boolean }[];
}) {
  const t = useTranslations("vehicles");
  const td = useTranslations("vehicles.detail");
  const tm = useTranslations("map");
  const tman = useTranslations("vehicles.manage");
  const ta = useTranslations("alarms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { vehicle: v, today } = detail;
  const st = STATUS_STYLE[v.live_status];
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const km = (n: number | null) => fmtKm(n, nf);

  const [openDtc, setOpenDtc] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // "X gündür aktif" gibi yaşa bağlı etiketler için TEK zaman damgası. Render
  // sırasında Date.now() çağırmak saf-olmayan bir işlem (React Compiler kuralı)
  // ve kartlar arası tutarsızlık üretir; state'e alınıp dakikada bir tazelenir.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Soft auto-refresh of the server-rendered data — same pattern as the live
  // map. Only refreshes while the tab is visible so a backgrounded page doesn't
  // poll needlessly.
  useEffect(() => {
    const REFRESH_MS = 30_000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const edit = () => setEditOpen(true);

  /**
   * OLAY RAYI — arıza + alarm + bölge + vardiya tek kronolojide.
   *
   * Dört ayrı kaynak dört ayrı kartta yaşasaydı yönetici "önce ne oldu"yu
   * kafasında birleştirmek zorunda kalırdı; oysa asıl soru budur (arıza mı
   * vardiyayı bozdu, yoksa vardiya sırasında mı arıza çıktı).
   */
  const railItems = useMemo(() => {
    type Item = { key: string; at: number; node: React.ReactNode };
    const items: Item[] = [];

    for (const d of dtc) {
      items.push({
        key: `dtc-${d.id}`,
        at: new Date(d.first_seen).getTime(),
        node: (
          <DtcRailCard
            fault={d}
            open={openDtc === d.id}
            onToggle={() => setOpenDtc(openDtc === d.id ? null : d.id)}
            currentOdometerKm={telemetry?.odometer_km ?? null}
            nowMs={nowMs}
            locale={locale}
            nf={nf}
          />
        ),
      });
    }

    for (const e of events) {
      // UI V2 eşlemesi (eventTone), eski EVENT_SEVERITY değil: orada jamming ve
      // unplug "gri"ydi, oysa ikisi de hırsızlık/kurcalama sinyali.
      const chip = eventTone(e.event_type);
      const tone: RailTone =
        chip === "critical" ? "critical" : chip === "warning" ? "warning" : "neutral";
      items.push({
        key: `evt-${e.id}`,
        at: new Date(e.occurred_at).getTime(),
        node: (
          <RailCard
            icon={<AlertTriangle className="size-3.5" />}
            tone={tone}
            title={ta(`type.${e.event_type}`)}
            time={stamp(e.occurred_at, locale)}
            action={
              e.latitude !== null && e.longitude !== null ? (
                <a
                  href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-sky-text hover:underline"
                >
                  {ta("view_on_map")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : undefined
            }
          >
            {e.speed_kmh !== null && (
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-text-tertiary">
                {Math.round(e.speed_kmh)} km/h
              </p>
            )}
          </RailCard>
        ),
      });
    }

    for (const [i, g] of geofence.events.entries()) {
      items.push({
        key: `geo-${g.zoneId}-${i}`,
        at: new Date(g.entryTime).getTime(),
        node: (
          <RailCard
            icon={g.violation ? <AlertTriangle className="size-3.5" /> : <Hexagon className="size-3.5" />}
            tone={g.violation ? "critical" : "neutral"}
            title={
              <span className="flex flex-wrap items-center gap-1.5">
                {g.zoneName}
                {g.violation && (
                  <span className="rounded-full bg-status-critical-soft px-1.5 py-0.5 text-[10px] font-medium text-status-critical-text">
                    {tm("violation")}
                  </span>
                )}
              </span>
            }
            time={formatHoursMinutes(g.dwellMs, locale)}
          >
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-text-tertiary">
              {formatTime(g.entryTime, locale)}–
              {g.exitTime ? formatTime(g.exitTime, locale) : tm("ongoing")}
            </p>
          </RailCard>
        ),
      });
    }

    for (const s of detail.recent) {
      items.push({
        key: `shift-${s.id}`,
        at: new Date(s.date).getTime(),
        node: (
          <RailCard
            icon={<UserRound className="size-3.5" />}
            tone={s.ended ? "neutral" : "info"}
            title={s.driver_name ?? td("no_active_driver")}
            time={stamp(s.date, locale)}
            action={
              s.driver_name ? (
                <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                  {fmtKm(s.start_km, nf)} → {fmtKm(s.end_km, nf)}
                  {s.km !== null && ` · ${fmtKm(s.km, nf)} km`}
                </span>
              ) : undefined
            }
          >
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {s.ended ? td("shift_ended") : td("shift_running")}
            </p>
          </RailCard>
        ),
      });
    }

    return items.sort((a, b) => b.at - a.at);
  }, [
    dtc,
    events,
    geofence.events,
    detail.recent,
    openDtc,
    telemetry,
    nowMs,
    locale,
    nf,
    ta,
    tm,
    td,
  ]);

  const shownRail = railItems.slice(0, RAIL_LIMIT);

  const coords =
    telemetry !== null
      ? `${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)}`
      : null;

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-6 sm:px-6">
      <Link
        href="/admin/araclar"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> {td("back")}
      </Link>

      {/* BAŞLIK — kart DEĞİL. Enode'da künye ekranının başlığı zeminde durur;
          kartın içine alınırsa "plaka" da bir alanmış gibi okunur. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface-panel">
          <Truck className={cn("size-5", FLEET_STYLE[v.fleet].text)} aria-hidden />
        </span>
        <div className="min-w-0">
          {/* Plaka HİÇBİR ekranda kırpılmaz. */}
          <h1 className="whitespace-nowrap font-mono text-[28px] font-semibold uppercase leading-tight tracking-[-0.01em] tabular-nums">
            {v.plate}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[v.make, v.model, v.year].filter(Boolean).join(" · ") || DASH}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium",
              FLEET_STYLE[v.fleet].chip
            )}
          >
            <Truck className="size-3.5 shrink-0" aria-hidden />
            {fleetLabel(v.fleet, t)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium",
              st.chip
            )}
          >
            {st.live ? (
              <span className="live-dot" />
            ) : (
              <span className={cn("size-1.5 rounded-full", st.dot)} />
            )}
            {t(`status.${st.labelKey}`)}
          </span>
          <HelpTip tkey="veh_status" />
        </div>
      </div>

      <DetailColumns
        rail={
          <RailSection title={td("rail_events")} count={railItems.length}>
            {shownRail.length === 0 ? (
              <div className="surface-card rounded-[12px] px-3 py-6 text-center">
                <Inbox className="mx-auto size-5 text-text-tertiary" aria-hidden />
                <p className="mt-2 text-[13px] text-text-tertiary">{td("rail_empty")}</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {shownRail.map((it) => (
                    <div key={it.key}>{it.node}</div>
                  ))}
                </div>
                {railItems.length > shownRail.length && (
                  <p className="px-1 pt-1 text-[11px] text-text-tertiary">
                    {td("rail_more", {
                      shown: shownRail.length,
                      total: railItems.length,
                    })}
                  </p>
                )}
              </>
            )}
          </RailSection>
        }
      >
        {/* DURUM — aracın ŞU AN'ı. Sayfanın canlı grubu; mercan işaret burada. */}
        <SpecGroup
          title={td("group_status")}
          accent
          footer={
            <div className="space-y-3 border-t border-border px-5 pb-5 pt-4">
              {/* MİNİ HARİTA — "Konum" satırının altında dar bant. Kendi başına
                  bir ekran değil, koordinatın okunur hâli. */}
              {telemetry ? (
                <div className="h-[150px] overflow-hidden rounded-[12px] border border-border">
                  <VehicleMiniMap
                    lat={telemetry.latitude}
                    lng={telemetry.longitude}
                    color={v.fleet === "bordo" ? "var(--accent-claret)" : "var(--accent-sky)"}
                    label={v.plate}
                  />
                </div>
              ) : (
                <div className="flex h-[150px] items-center justify-center rounded-[12px] border border-dashed border-border">
                  <p className="text-[13px] text-text-tertiary">{tm("no_device_data")}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {/* Sayfanın TEK dolu mercan öğesi (DESIGN.md §2.2).
                    <Button> DEĞİL: varsayılan varyantın `.btn-primary` sınıfı
                    background-color'ı token'dan basıyor ve utility sınıfı
                    eziyordu — buton mercan yerine koyu çıkıyordu. Zaten hedef
                    bir bağlantı; düz <Link> hem doğru semantik hem doğru renk. */}
                <Link
                  href={`/admin/araclar/${v.id}/rota`}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-accent-coral px-4 text-sm font-medium text-accent-coral-fg outline-none transition-colors duration-200 hover:bg-accent-coral-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px sm:w-auto"
                >
                  <History className="size-4" aria-hidden />
                  {td("route_history")}
                </Link>
                <HelpTip tkey="veh_route" />
              </div>
            </div>
          }
        >
          <SpecRow label={td("plate")} mono onEdit={edit} editLabel={tc("edit")}>
            {v.plate}
          </SpecRow>
          <SpecRow label={td("fleet")} onEdit={edit} editLabel={tc("edit")}>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                FLEET_STYLE[v.fleet].chip
              )}
            >
              {fleetLabel(v.fleet, t)}
            </span>
          </SpecRow>
          <SpecRow label={td("live_status")}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                st.chip
              )}
            >
              {st.live ? (
                <span className="live-dot" />
              ) : (
                <span className={cn("size-1.5 rounded-full", st.dot)} />
              )}
              {t(`status.${st.labelKey}`)}
            </span>
          </SpecRow>
          {/* map.last_seen DEĞİL: o anahtar "Son görülme: {ago}" cümlesi,
              etiket değil — satır etiketi olarak kullanılınca değişken
              beklediği için i18n hatası veriyordu. */}
          <SpecRow label={td("last_seen")} mono muted={!telemetry}>
            {telemetry ? (
              <LastSeen iso={telemetry.recorded_at} locale={locale} />
            ) : (
              t("no_signal")
            )}
          </SpecRow>
          <SpecRow label={tm("ignition")}>
            {telemetry?.ignition_on === true ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/15 px-2 py-0.5 text-[11px] font-medium text-accent-green">
                <span className="size-1.5 rounded-full bg-accent-green" />
                {tm("ignition_on")}
              </span>
            ) : telemetry?.ignition_on === false ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                {tm("ignition_off")}
              </span>
            ) : (
              DASH
            )}
          </SpecRow>
          <SpecRow
            label={td("driver")}
            onEdit={edit}
            editLabel={tc("edit")}
            muted={!v.driver_name}
          >
            {v.driver_name ? (
              v.driver_id ? (
                <Link
                  href={`/admin/workers/${v.driver_id}`}
                  className="font-medium hover:underline"
                >
                  {v.driver_name}
                </Link>
              ) : (
                v.driver_name
              )
            ) : (
              td("no_active_driver")
            )}
          </SpecRow>
          <SpecRow label={td("location")} mono muted={!coords}>
            {coords ? (
              <a
                href={`https://www.google.com/maps?q=${telemetry!.latitude},${telemetry!.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                <MapPin className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
                {coords}
              </a>
            ) : (
              DASH
            )}
          </SpecRow>
        </SpecGroup>

        {/* KÜNYE — aracın DEĞİŞMEYENİ. */}
        <SpecGroup title={td("group_identity")}>
          <SpecRow label={tman("make")} onEdit={edit} editLabel={tc("edit")} muted={!v.make}>
            {v.make || DASH}
          </SpecRow>
          <SpecRow label={tman("model")} onEdit={edit} editLabel={tc("edit")} muted={!v.model}>
            {v.model || DASH}
          </SpecRow>
          <SpecRow label={td("year")} mono onEdit={edit} editLabel={tc("edit")} muted={!v.year}>
            {v.year ?? DASH}
          </SpecRow>
          {/* VIN düzenlenemez: cihazın CAN üzerinden bildirdiği alan
              (migration 021), elle yazılırsa telemetriyle çelişir. */}
          <SpecRow label={tm("vin")} mono muted={!v.vin}>
            {v.vin || td("not_set")}
          </SpecRow>
          <SpecRow label={tman("imei")} mono onEdit={edit} editLabel={tc("edit")} muted={!v.imei}>
            {v.imei || td("not_set")}
          </SpecRow>
          <SpecRow
            label={td("inspection_due")}
            mono
            onEdit={edit}
            editLabel={tc("edit")}
            muted={!v.inspection_due}
          >
            {v.inspection_due ? formatDate(v.inspection_due, locale) : td("not_set")}
          </SpecRow>
          <SpecRow
            label={td("insurance_due")}
            mono
            onEdit={edit}
            editLabel={tc("edit")}
            muted={!v.insurance_due}
          >
            {v.insurance_due ? formatDate(v.insurance_due, locale) : td("not_set")}
          </SpecRow>
        </SpecGroup>

        {/* BUGÜN — vardiya defterinden gelen sayılar + cihaz GPS ölçümleri.
            İkisi tek grupta: yönetici "bugün ne oldu"yu tek yerde okur. */}
        <SpecGroup title={td("group_today")} action={<HelpTip tkey="veh_status" />}>
          <SpecRow label={td("today_km")} mono>
            {today.km === null ? (
              <span className="text-text-tertiary">{DASH}</span>
            ) : (
              // Sayfanın öne çıkan sayısı — mercan (DESIGN.md §2.2).
              <span className="text-[15px] font-semibold text-accent-coral-text">
                {km(today.km)} km
              </span>
            )}
          </SpecRow>
          <SpecRow label={td("start_end_km")} mono>
            {km(today.startKm)} → {km(today.endKm)}
          </SpecRow>
          <SpecRow label={td("times")} mono>
            {today.firstStart ? formatTime(today.firstStart, locale) : DASH} →{" "}
            {today.lastEnd ? formatTime(today.lastEnd, locale) : DASH}
          </SpecRow>
          <SpecRow label={td("packages")} mono>
            {today.startPackages ?? DASH} → {today.endPackages ?? DASH}
          </SpecRow>
          <SpecRow label={tm("engine_hours_today")} mono muted={engineHours.points === 0}>
            {engineHours.points === 0 ? (
              tm("no_data")
            ) : (
              <Measure uncertain={engineHours.uncertain} hint={tm("estimated_hint")} label={tm("estimated")}>
                {formatHoursMinutes(engineHours.ms, locale)}
              </Measure>
            )}
          </SpecRow>
          <SpecRow label={tm("gps_distance_today")} mono muted={distance.points === 0}>
            {distance.points === 0 ? (
              tm("no_data")
            ) : (
              <Measure uncertain={distance.uncertain} hint={tm("estimated_hint")} label={tm("estimated")}>
                {distance.km.toLocaleString(nf, { maximumFractionDigits: 1 })} km
              </Measure>
            )}
          </SpecRow>
          <SpecRow label={tm("idle_today")} mono muted={idle.points === 0}>
            {idle.points === 0 ? (
              tm("no_data")
            ) : (
              <Measure uncertain={idle.uncertain} hint={tm("estimated_hint")} label={tm("estimated")}>
                {formatHoursMinutes(idle.totalIdleMs, locale)}
                {idle.idleEvents > 0 && (
                  <span className="ml-1 font-sans text-[11px] font-normal text-text-tertiary">
                    {tm("idle_events", { count: idle.idleEvents })}
                  </span>
                )}
              </Measure>
            )}
          </SpecRow>
        </SpecGroup>

        {/* TELEMETRİ — cihazın (FMC003) son bildirdiği ham değerler. OBD/CAN
            bildirmeyen cihazlarda alanlar "—" kalır; uydurma değer yok. */}
        <SpecGroup title={td("group_telemetry")}>
          <SpecRow label={tm("vehicle_speed")} mono muted={telemetry?.speed_kmh == null}>
            {telemetry?.speed_kmh != null ? `${Math.round(telemetry.speed_kmh)} km/h` : DASH}
          </SpecRow>
          <SpecRow label={tm("heading")} mono muted={telemetry?.heading == null}>
            {telemetry?.heading != null
              ? `${tm(`compass.${compassKey(telemetry.heading)}`)} · ${telemetry.heading}°`
              : DASH}
          </SpecRow>
          <SpecRow label={tm("fuel_level")} mono muted={telemetry?.fuel_level_pct == null}>
            {telemetry?.fuel_level_pct != null
              ? `%${Math.round(telemetry.fuel_level_pct)}`
              : DASH}
          </SpecRow>
          <SpecRow label={tm("vehicle_km")} mono muted={telemetry?.odometer_km == null}>
            {telemetry?.odometer_km != null
              ? `${Math.round(telemetry.odometer_km).toLocaleString(nf)} km`
              : DASH}
          </SpecRow>
          <SpecRow label={tm("engine_rpm")} mono muted={telemetry?.engine_rpm == null}>
            {telemetry?.engine_rpm != null ? telemetry.engine_rpm.toLocaleString(nf) : DASH}
          </SpecRow>
          <SpecRow label={tm("coolant_temp")} mono muted={telemetry?.coolant_temp_c == null}>
            {telemetry?.coolant_temp_c != null
              ? `${Math.round(telemetry.coolant_temp_c)} °C`
              : DASH}
          </SpecRow>
          <SpecRow label={tm("engine_load")} mono muted={telemetry?.engine_load_pct == null}>
            {telemetry?.engine_load_pct != null
              ? `%${Math.round(telemetry.engine_load_pct)}`
              : DASH}
          </SpecRow>
          <SpecRow
            label={tm("fuel_consumption")}
            mono
            muted={telemetry?.fuel_consumption == null}
          >
            {telemetry?.fuel_consumption != null
              ? telemetry.fuel_consumption.toLocaleString(nf, { maximumFractionDigits: 1 })
              : DASH}
          </SpecRow>
          <SpecRow label={tm("power_voltage")} mono muted={telemetry?.power_voltage == null}>
            {telemetry?.power_voltage != null ? `${telemetry.power_voltage.toFixed(1)} V` : DASH}
          </SpecRow>
          <SpecRow label={tm("battery_voltage")} mono muted={telemetry?.battery_voltage == null}>
            {telemetry?.battery_voltage != null
              ? `${telemetry.battery_voltage.toFixed(2)} V`
              : DASH}
          </SpecRow>
          <SpecRow label={tm("gsm_signal")} mono muted={telemetry?.gsm_signal == null}>
            {telemetry?.gsm_signal != null ? `%${Math.round(telemetry.gsm_signal)}` : DASH}
          </SpecRow>
        </SpecGroup>

        <PenaltiesSection vehicleId={v.id} penalties={detail.penalties} />
      </DetailColumns>

      <VehicleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        vehicle={v}
        drivers={drivers}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

/** Ölçüm değeri + gerekiyorsa "~ tahmini" rozeti (boşluk/kelepçe olmuşsa). */
function Measure({
  uncertain,
  hint,
  label,
  children,
}: {
  uncertain: boolean;
  hint: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      {/* Rozet metni text-tertiary DEĞİL: #6E6E73, panel grisi (#F1F1F3)
          üstünde tam 4.50:1 sınırında kalıyordu — ikincil ton bir tık koyu
          ve güvenli tarafta. */}
      {uncertain && (
        <span
          title={hint}
          className="rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground"
        >
          ~ {label}
        </span>
      )}
    </span>
  );
}

/**
 * Rayda tek arıza kartı: KOD + başlık, açılınca 4 alanlı tanım paneli.
 * info === null → sözlük dışı (üretici-spesifik) kod: tek fallback cümlesi,
 * asla uydurma tanım.
 */
function DtcRailCard({
  fault,
  open,
  onToggle,
  currentOdometerKm,
  nowMs,
  locale,
  nf,
}: {
  fault: VehicleDtcRow & { info: DtcText | null };
  open: boolean;
  onToggle: () => void;
  currentOdometerKm: number | null;
  /** Üstten gelen sabit "şimdi" — render saf kalsın (React Compiler kuralı). */
  nowMs: number;
  locale: string;
  nf: string;
}) {
  const tm = useTranslations("map");
  const tc = useTranslations("common");
  const days = Math.max(
    0,
    Math.floor((nowMs - new Date(fault.first_seen).getTime()) / 86_400_000)
  );
  const kmSince =
    currentOdometerKm !== null && fault.first_seen_odometer_km !== null
      ? Math.max(0, Math.round(currentOdometerKm - fault.first_seen_odometer_km))
      : null;
  const detailId = `dtc-detail-${fault.id}`;

  return (
    <RailCard
      icon={<Wrench className="size-3.5" />}
      tone="warning"
      title={
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-mono font-semibold text-accent-gold-text">{fault.code}</span>
          <span>{fault.info ? fault.info.title : tm("dtc_unknown_title")}</span>
        </span>
      }
      time={days === 0 ? tm("dtc_today") : tm("dtc_active_days", { days })}
      action={
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={detailId}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? tc("close") : tc("details")}
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      }
    >
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-text-tertiary">
        {kmSince !== null ? tm("dtc_km_since", { km: kmSince.toLocaleString(nf) }) : "—"}
        {" · "}
        {tm("dtc_since")}: {formatDate(fault.first_seen, locale)}
      </p>
      {open && (
        <div id={detailId} className="mt-2 space-y-2 border-t border-border pt-2">
          {fault.info ? (
            <>
              <DtcField label={tm("dtc_field_part")}>{fault.info.part}</DtcField>
              <DtcField label={tm("dtc_field_symptoms")}>{fault.info.symptoms}</DtcField>
              <DtcField label={tm("dtc_field_risk")}>{fault.info.risk}</DtcField>
            </>
          ) : (
            <p className="text-[12px] text-text-tertiary">{tm("dtc_unknown")}</p>
          )}
        </div>
      )}
    </RailCard>
  );
}

function DtcField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
        {label}
      </p>
      <p className="mt-0.5 text-[12px] leading-relaxed">{children}</p>
    </div>
  );
}

/** Rayda kısa zaman damgası: bugünse saat, değilse tarih. */
function stamp(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? formatTime(iso, locale) : formatDate(iso, locale);
}

const COMPASS_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
/** Map a 0..359 heading to one of 8 compass points (i18n key suffix). */
function compassKey(heading: number): (typeof COMPASS_KEYS)[number] {
  const idx = Math.round((((heading % 360) + 360) % 360) / 45) % 8;
  return COMPASS_KEYS[idx];
}

/**
 * "5 dakika önce". Sunucuda ve ilk boyamada mutlak saati basar (hidrasyon
 * kayması olmasın), mount'tan sonra göreli etikete yükselir.
 */
function LastSeen({ iso, locale }: { iso: string; locale: string }) {
  const [time, setTime] = useState<string>(() => formatTime(iso, locale));
  useEffect(() => {
    const tick = () => setTime(formatRelative(iso, locale));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [iso, locale]);
  return <>{time}</>;
}

/** Binlik ayraçlı km — null ise tire. Modül seviyesinde: bileşen gövdesinde
 *  tanımlanınca her render'da yeni kimlik alıp useMemo bağımlılığını bozuyordu. */
function fmtKm(n: number | null, nf: string): string {
  return n === null ? DASH : n.toLocaleString(nf);
}
