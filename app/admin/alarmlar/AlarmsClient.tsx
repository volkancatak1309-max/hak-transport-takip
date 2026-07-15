"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, MapPin, Truck } from "lucide-react";
import {
  PageHeader,
  StatCard,
  StatusChip,
  FilterBar,
  SegmentedControl,
  DataTable,
  DensityToggle,
  DetailDrawer,
  EmptyState,
  type Column,
} from "@/components/ui-v2";
import { Button } from "@/components/ui/button";
import { eventTone, EVENT_STRIPE, EVENT_TONE_RANK } from "@/lib/event-ui";
import { formatDateTime } from "@/lib/format";
import type { VehicleEventWithPlate } from "@/lib/telemetry";
import type { AlarmRange } from "./page";

const STORM_WINDOW_MS = 10 * 60 * 1000;

export function AlarmsClient({
  events,
  range,
}: {
  events: VehicleEventWithPlate[];
  range: AlarmRange;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  const [q, setQ] = useState("");
  const [sev, setSev] = useState(""); // "" | critical | warning | neutral
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<VehicleEventWithPlate | null>(null);

  // ── Özet istatistikler (yüklü aralık üzerinden) ──────────────────────────
  const stats = useMemo(() => {
    let critical = 0;
    const byVehicle = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const e of events) {
      if (eventTone(e.event_type) === "critical") critical++;
      byVehicle.set(e.plate, (byVehicle.get(e.plate) ?? 0) + 1);
      byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);
    }
    const topVehicle = [...byVehicle.entries()].sort((a, b) => b[1] - a[1])[0];
    const topType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total: events.length,
      critical,
      topVehicle: topVehicle ? { plate: topVehicle[0], count: topVehicle[1] } : null,
      topType: topType ? { type: topType[0], count: topType[1] } : null,
    };
  }, [events]);

  // Filtrede görünen olay tipleri (yüklü veriye göre dinamik)
  const typeOptions = useMemo(() => {
    const set = [...new Set(events.map((e) => e.event_type))];
    return set
      .map((ty) => ({ value: ty, label: t(`type.${ty}`) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [events, t, locale]);

  // ── Anlık filtreleme (client-state; RSC refetch yok) ─────────────────────
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (needle && !e.plate.toLowerCase().includes(needle)) return false;
      if (sev && eventTone(e.event_type) !== sev) return false;
      if (type && e.event_type !== type) return false;
      return true;
    });
  }, [events, q, sev, type]);

  const rangeLabel =
    range === "today" ? t("range_today") : range === "30d" ? t("range_30d") : t("range_7d");

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
        e.speed_kmh !== null ? `${Math.round(e.speed_kmh)} km/h` : "—",
      align: "right",
      nums: true,
      sortable: true,
      sortValue: (e) => e.speed_kmh ?? -1,
      hideBelow: "sm",
    },
  ];

  const neighbors = filtered;
  const selIndex = selected ? neighbors.findIndex((e) => e.id === selected.id) : -1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <SegmentedControl
            ariaLabel="Tarih aralığı"
            value={range}
            onChange={(v) =>
              startNav(() => router.replace(`/admin/alarmlar?range=${v}`, { scroll: false }))
            }
            options={[
              { value: "today", label: t("range_today") },
              { value: "7d", label: t("range_7d") },
              { value: "30d", label: t("range_30d") },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("stat_total")} value={stats.total.toLocaleString(locale)} scope={rangeLabel} />
        <StatCard
          label={t("stat_critical")}
          value={stats.critical.toLocaleString(locale)}
          scope={rangeLabel}
          tone={stats.critical > 0 ? "critical" : "neutral"}
        />
        <StatCard
          label={t("stat_top_vehicle")}
          value={stats.topVehicle ? <span className="uppercase">{stats.topVehicle.plate}</span> : "—"}
          scope={stats.topVehicle ? `${stats.topVehicle.count} ${t("events_n")}` : rangeLabel}
        />
        <StatCard
          label={t("stat_top_type")}
          value={stats.topType ? <span className="text-lg">{t(`type.${stats.topType.type}`)}</span> : "—"}
          scope={stats.topType ? `${stats.topType.count} ${t("events_n")}` : rangeLabel}
        />
      </div>

      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: t("search_ph") }}
        selects={[
          {
            label: t("filter_severity"),
            value: sev,
            onChange: setSev,
            allLabel: t("filter_severity"),
            options: [
              { value: "critical", label: t("sev_critical") },
              { value: "warning", label: t("sev_warning") },
              { value: "neutral", label: t("sev_neutral") },
            ],
          },
          {
            label: t("filter_type"),
            value: type,
            onChange: setType,
            allLabel: t("filter_type"),
            options: typeOptions,
          },
        ]}
        resultCount={filtered.length}
        totalCount={events.length}
        countLabel={t("count")}
        onClear={() => {
          setQ("");
          setSev("");
          setType("");
        }}
      >
        <DensityToggle />
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          kind={events.length === 0 ? "none" : "filtered"}
          title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
          hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
          cta={
            events.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => { setQ(""); setSev(""); setType(""); }}>
                {t("empty_hint_filtered")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          rows={filtered}
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
        onPrev={selIndex > 0 ? () => setSelected(neighbors[selIndex - 1]) : null}
        onNext={
          selIndex >= 0 && selIndex < neighbors.length - 1
            ? () => setSelected(neighbors[selIndex + 1])
            : null
        }
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
                  {selected.speed_kmh !== null ? `${Math.round(selected.speed_kmh)} km/h` : "—"}
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
            <div className="flex flex-col gap-2 pt-2">
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
