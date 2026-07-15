"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, MapPin, Truck, ShieldAlert } from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusChip,
  SegmentedControl,
  FilterChips,
  BreakdownCard,
  MiniTrend,
  DataTable,
  DensityToggle,
  DetailDrawer,
  EmptyState,
  type Column,
  type ActiveChip,
  type BreakdownTab,
  type TrendBucket,
} from "@/components/ui-v2";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { eventTone, EVENT_STRIPE, EVENT_TONE_RANK } from "@/lib/event-ui";
import { formatDateTime } from "@/lib/format";
import type { VehicleEventWithPlate } from "@/lib/telemetry";
import type { AlarmRange } from "./page";

const EventMiniMap = dynamic(() => import("@/components/admin/EventMiniMap"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-[12px] bg-surface-2" />,
});

const STORM_WINDOW_MS = 10 * 60 * 1000;
// Hız yalnız bu tiplerde anlamlı; rölanti/jamming'de "0 km/h" gösterilmez (audit).
const SPEED_EVENTS = new Set([
  "overspeeding",
  "harsh_acceleration",
  "harsh_braking",
  "harsh_cornering",
  "crash",
]);

const VIENNA = "Europe/Vienna";
function viennaDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: VIENNA });
}
function viennaHourKey(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-CA", { timeZone: VIENNA });
  const hour = d.toLocaleTimeString("en-GB", { timeZone: VIENNA, hour: "2-digit", hour12: false }).slice(0, 2);
  return `${day}T${hour}`;
}

export function AlarmsClient({
  events,
  range,
  startISO,
  endISO,
}: {
  events: VehicleEventWithPlate[];
  range: AlarmRange;
  startISO: string;
  endISO: string;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  // ── Filtre durumu (tek çip sistemi — Volkan #1-2) ────────────────────────
  const [q, setQ] = useState("");
  const [vehicle, setVehicle] = useState(""); // exact plate
  const [type, setType] = useState(""); // event_type
  const [day, setDay] = useState<string | null>(null); // bucket key
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [sort, setSort] = useState<"severity" | "newest">("severity");
  const [selected, setSelected] = useState<VehicleEventWithPlate | null>(null);

  const rangeLabel =
    range === "today" ? t("range_today") : range === "30d" ? t("range_30d") : t("range_7d");
  const hourly = range === "today";

  // ── Özet (yüklü aralık) ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    let critical = 0;
    let today = 0;
    let lastCritical: string | null = null;
    const todayKey = viennaDayKey(new Date().toISOString());
    for (const e of events) {
      const isCrit = eventTone(e.event_type) === "critical";
      if (isCrit) {
        critical++;
        if (!lastCritical || e.occurred_at > lastCritical) lastCritical = e.occurred_at;
      }
      if (viennaDayKey(e.occurred_at) === todayKey) today++;
    }
    return { total: events.length, critical, today, lastCritical };
  }, [events]);

  // ── Breakdown (araç / tip ranking — Dub deseni) ──────────────────────────
  const breakdown = useMemo(() => {
    const byVehicle = new Map<string, { count: number; crit: number }>();
    const byType = new Map<string, { count: number; crit: number }>();
    for (const e of events) {
      const isCrit = eventTone(e.event_type) === "critical";
      const v = byVehicle.get(e.plate) ?? { count: 0, crit: 0 };
      v.count++; if (isCrit) v.crit++; byVehicle.set(e.plate, v);
      const ty = byType.get(e.event_type) ?? { count: 0, crit: 0 };
      ty.count++; if (isCrit) ty.crit++; byType.set(e.event_type, ty);
    }
    const topVehicles = [...byVehicle.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    const topTypes = [...byType.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    return { topVehicles, topTypes };
  }, [events]);

  // ── Trend kovaları (Resend/Reveal bar deseni) ────────────────────────────
  const trend = useMemo<TrendBucket[]>(() => {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const buckets = new Map<string, { total: number; crit: number }>();
    // Boş kovalar da görünsün diye tüm aralığı önceden doldur.
    if (hourly) {
      for (let h = 0; h < 24; h++) {
        const d = new Date(start.getTime() + h * 3600_000);
        if (d > end) break;
        buckets.set(viennaHourKey(d.toISOString()), { total: 0, crit: 0 });
      }
    } else {
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400_000)) {
        buckets.set(viennaDayKey(d.toISOString()), { total: 0, crit: 0 });
      }
    }
    for (const e of events) {
      const key = hourly ? viennaHourKey(e.occurred_at) : viennaDayKey(e.occurred_at);
      const b = buckets.get(key);
      if (!b) continue;
      b.total++;
      if (eventTone(e.event_type) === "critical") b.crit++;
    }
    return [...buckets.entries()].map(([key, v]) => ({
      key,
      label: hourly
        ? key.slice(11) + ":00"
        : new Date(key + "T12:00:00").toLocaleDateString(locale === "de" ? "de-AT" : "tr-TR", {
            day: "2-digit",
            month: "2-digit",
          }),
      value: v.total,
      critical: v.crit,
    }));
  }, [events, startISO, endISO, hourly, locale]);

  // ── Filtreleme (AND; hepsi çip) ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (vehicle && e.plate !== vehicle) return false;
      if (type && e.event_type !== type) return false;
      if (onlyCritical && eventTone(e.event_type) !== "critical") return false;
      if (day) {
        const key = hourly ? viennaHourKey(e.occurred_at) : viennaDayKey(e.occurred_at);
        if (key !== day) return false;
      }
      if (needle) {
        const hay = `${e.plate} ${t(`type.${e.event_type}`)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [events, q, vehicle, type, day, onlyCritical, hourly, t]);

  const sorted = useMemo(() => {
    if (sort === "newest") {
      return [...filtered].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    }
    // Önce kritik, sonra en yeni (Reveal "Most triggered / Order by Status").
    return [...filtered].sort((a, b) => {
      const d = EVENT_TONE_RANK[eventTone(b.event_type)] - EVENT_TONE_RANK[eventTone(a.event_type)];
      return d !== 0 ? d : b.occurred_at.localeCompare(a.occurred_at);
    });
  }, [filtered, sort]);

  // ── Aktif filtre çipleri ─────────────────────────────────────────────────
  const chips: ActiveChip[] = [];
  if (vehicle) chips.push({ key: "v", label: t("chip_vehicle"), value: vehicle, onRemove: () => setVehicle("") });
  if (type) chips.push({ key: "ty", label: t("chip_type"), value: t(`type.${type}`), onRemove: () => setType("") });
  if (day) {
    const b = trend.find((x) => x.key === day);
    chips.push({ key: "d", label: t("chip_day"), value: b?.label ?? day, onRemove: () => setDay(null) });
  }
  if (onlyCritical) chips.push({ key: "c", label: t("chip_critical"), value: "✓", onRemove: () => setOnlyCritical(false) });
  if (q) chips.push({ key: "q", label: t("chip_search"), value: q, onRemove: () => setQ("") });
  const clearAll = () => { setQ(""); setVehicle(""); setType(""); setDay(null); setOnlyCritical(false); };

  const vehicleTabs: BreakdownTab[] = [
    {
      key: "vehicle",
      label: t("by_vehicle"),
      unit: t("events_n"),
      rows: breakdown.topVehicles.map(([plate, v]) => ({
        key: plate,
        label: <span className="nums uppercase tracking-wide">{plate}</span>,
        value: v.count,
        color: v.crit > 0 ? "var(--status-critical)" : "var(--accent-sky)",
        active: vehicle === plate,
        onClick: () => { setVehicle(vehicle === plate ? "" : plate); },
      })),
    },
    {
      key: "type",
      label: t("by_type"),
      unit: t("events_n"),
      rows: breakdown.topTypes.map(([ty, v]) => ({
        key: ty,
        label: t(`type.${ty}`),
        value: v.count,
        color: EVENT_STRIPE[eventTone(ty)],
        active: type === ty,
        onClick: () => { setType(type === ty ? "" : ty); },
      })),
    },
  ];

  const columns: Column<VehicleEventWithPlate>[] = [
    {
      key: "time",
      header: t("col_time"),
      cell: (e) => formatDateTime(e.occurred_at, locale),
      nums: true,
      sortable: true,
      sortValue: (e) => e.occurred_at,
    },
    {
      key: "plate",
      header: t("col_vehicle"),
      cell: (e) => (
        <Link
          href={`/admin/araclar/${e.vehicle_id}`}
          onClick={(ev) => ev.stopPropagation()}
          className="nums font-medium uppercase tracking-wide hover:underline"
        >
          {e.plate}
        </Link>
      ),
      nums: true,
      sortable: true,
      sortValue: (e) => e.plate,
    },
    {
      key: "type",
      header: t("col_type"),
      cell: (e) => <StatusChip tone={eventTone(e.event_type)}>{t(`type.${e.event_type}`)}</StatusChip>,
      sortable: true,
      sortValue: (e) => EVENT_TONE_RANK[eventTone(e.event_type)],
    },
    {
      key: "speed",
      header: t("drawer_speed"),
      cell: (e) =>
        e.event_type === "idling"
          ? <span className="text-muted-foreground">{t("context_idle")}</span>
          : SPEED_EVENTS.has(e.event_type) && e.speed_kmh !== null
          ? `${Math.round(e.speed_kmh)} km/h`
          : "—",
      align: "right",
      nums: true,
      hideBelow: "sm",
    },
  ];

  const selIndex = selected ? sorted.findIndex((e) => e.id === selected.id) : -1;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant={onlyCritical ? "default" : "outline"}
              size="sm"
              onClick={() => setOnlyCritical((v) => !v)}
              className={onlyCritical ? "bg-status-critical-fill text-white hover:opacity-90" : ""}
            >
              <ShieldAlert className="size-4" />
              {t("only_critical")}
            </Button>
            <SegmentedControl
              ariaLabel="Tarih aralığı"
              value={range}
              onChange={(v) => startNav(() => router.replace(`/admin/alarmlar?range=${v}`, { scroll: false }))}
              options={[
                { value: "today", label: t("range_today") },
                { value: "7d", label: t("range_7d") },
                { value: "30d", label: t("range_30d") },
              ]}
            />
          </div>
        }
      />

      {/* KPI şeridi (Resend/Dub) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("stat_total")} value={summary.total.toLocaleString(locale)} scope={rangeLabel} />
        <StatCard
          label={t("stat_critical")}
          value={summary.critical.toLocaleString(locale)}
          scope={rangeLabel}
          tone={summary.critical > 0 ? "critical" : "neutral"}
        />
        <StatCard label={t("stat_change")} value={summary.today.toLocaleString(locale)} scope={t("range_today")} />
        <StatCard
          label={t("stat_last_critical")}
          value={summary.lastCritical ? formatDateTime(summary.lastCritical, locale).slice(-5) : "—"}
          scope={summary.lastCritical ? formatDateTime(summary.lastCritical, locale).slice(0, 10) : t("no_critical")}
          tone={summary.lastCritical ? "critical" : "neutral"}
        />
      </div>

      {/* Trend + Breakdown (asıl fark — REVEAL-GAP §5.1) */}
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="glass rounded-[16px] p-4 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{t("trend_title")}</p>
            <span className="text-[11px] text-muted-foreground">{rangeLabel}</span>
          </div>
          <MiniTrend
            data={trend}
            activeKey={day}
            onBucketClick={(b) => setDay(day === b.key ? null : b.key)}
            criticalLabel={t("trend_critical")}
            totalLabel={t("trend_total")}
          />
        </div>
        <BreakdownCard tabs={vehicleTabs} className="lg:col-span-2" emptyLabel={t("empty_none")} />
      </div>

      {/* Filtre çipleri + arama + sıralama */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search_ph2")}
            aria-label={t("search_ph2")}
            className="h-9"
          />
        </div>
        <SegmentedControl
          ariaLabel="Sıralama"
          value={sort}
          onChange={(v) => setSort(v as "severity" | "newest")}
          options={[
            { value: "severity", label: t("sort_severity") },
            { value: "newest", label: t("sort_newest") },
          ]}
        />
        <DensityToggle />
        <span className="nums ml-auto text-xs text-muted-foreground">
          {sorted.length !== events.length ? `${sorted.length} / ${events.length}` : sorted.length} {t("count")}
        </span>
      </div>
      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {/* Alarm log */}
      {sorted.length === 0 ? (
        <EmptyState
          kind={events.length === 0 ? "none" : "filtered"}
          title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
          hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
          cta={events.length > 0 ? <Button variant="ghost" size="sm" onClick={clearAll}>{t("empty_hint_filtered")}</Button> : undefined}
        />
      ) : (
        <DataTable
          rows={sorted}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => setSelected(e)}
          stripe={(e) => EVENT_STRIPE[eventTone(e.event_type)]}
          grouping={{
            getKey: (e) => `${e.vehicle_id}:${e.event_type}`,
            getTime: (e) => new Date(e.occurred_at).getTime(),
            windowMs: STORM_WINDOW_MS,
            renderLabel: (rows) => (
              <span className="flex items-center gap-2 text-sm">
                <span className="nums font-medium uppercase tracking-wide">{rows[0].plate}</span>
                <StatusChip tone={eventTone(rows[0].event_type)}>
                  {t(`type.${rows[0].event_type}`)} ×{rows.length}
                </StatusChip>
              </span>
            ),
          }}
          totalLabel={t("count")}
        />
      )}

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(v) => !v && setSelected(null)}
        title={selected?.plate ?? ""}
        subtitle={selected ? formatDateTime(selected.occurred_at, locale) : undefined}
        onPrev={selIndex > 0 ? () => setSelected(sorted[selIndex - 1]) : null}
        onNext={selIndex >= 0 && selIndex < sorted.length - 1 ? () => setSelected(sorted[selIndex + 1]) : null}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div>
              <StatusChip tone={eventTone(selected.event_type)}>
                {t(`type.${selected.event_type}`)}
              </StatusChip>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_speed")}</dt>
                <dd className="nums mt-0.5">
                  {SPEED_EVENTS.has(selected.event_type) && selected.speed_kmh !== null
                    ? `${Math.round(selected.speed_kmh)} km/h`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_location")}</dt>
                <dd className="nums mt-0.5">
                  {selected.latitude !== null && selected.longitude !== null
                    ? `${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}`
                    : t("no_location")}
                </dd>
              </div>
            </dl>

            {selected.latitude !== null && selected.longitude !== null && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_address")}</p>
                <EventMiniMap lat={selected.latitude} lng={selected.longitude} />
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {selected.latitude !== null && selected.longitude !== null && (
                <a
                  href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-accent-sky hover:underline"
                >
                  <MapPin className="size-4" />
                  {t("open_maps")}
                  <ExternalLink className="size-3" />
                </a>
              )}
              <Link
                href={`/admin/araclar/${selected.vehicle_id}`}
                className="inline-flex items-center gap-2 text-sm text-accent-sky hover:underline"
              >
                <Truck className="size-4" />
                {t("go_vehicle")}
              </Link>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
