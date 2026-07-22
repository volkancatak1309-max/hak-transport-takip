"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, MapPin, Truck } from "lucide-react";
import {
  SubTabs,
  StatusChip,
  RevealFilterRow,
  DataTable,
  DensityToggle,
  DetailDrawer,
  EmptyState,
  type Column,
  type RevealFilter,
} from "@/components/ui-v2";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { eventTone, EVENT_STRIPE, EVENT_TONE_RANK } from "@/lib/event-ui";
import { formatDateTime, formatIdleShort } from "@/lib/format";
import type { VehicleEventWithPlate } from "@/lib/telemetry";
import type { AlarmRange } from "./page";

/**
 * Alarm satırı = nokta-olay (vehicle_events) VEYA rölanti epizodu (idle_episodes,
 * migration 024). Epizod satırları süre taşır (duration_ms) ve açıksa ongoing.
 */
export type AlarmRow = VehicleEventWithPlate & {
  duration_ms?: number | null;
  ongoing?: boolean;
};

const EventMiniMap = dynamic(() => import("@/components/admin/EventMiniMap"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-[12px] bg-surface-2" />,
});

const STORM_WINDOW_MS = 10 * 60 * 1000;
const SPEED_EVENTS = new Set(["overspeeding", "harsh_acceleration", "harsh_braking", "harsh_cornering", "crash"]);

export function AlarmsClient({
  events,
  range,
  epochISO,
  showEpochWarning,
}: {
  events: AlarmRow[];
  range: AlarmRange;
  /** Alarm eşiklerinin değiştiği an (ISO); kayıt yoksa null. */
  epochISO: string | null;
  /** Görüntülenen aralık sınırdan önce başlıyor → üstte uyarı. */
  showEpochWarning: boolean;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  const [tab, setTab] = useState<"overview" | "log">("overview");
  const [sort, setSort] = useState<"most" | "newest">("most");
  // Alarm Kaydı filtreleri (basit dropdown — Reveal Alert Log bandı)
  const [fVehicle, setFVehicle] = useState("");
  const [fType, setFType] = useState("");
  const [fSev, setFSev] = useState("");
  const [selected, setSelected] = useState<AlarmRow | null>(null);

  // Rölanti epizodu süresi rozeti (migration 024): "· 25 dk" / açıksa
  // "· 12 dk (devam ediyor)". Süre epizoddan geliyor (ham gözlemlenen span);
  // diğer olay tiplerinde gösterilmez.
  const idleBadge = (e: AlarmRow): string | null => {
    if (e.event_type !== "idling" || e.duration_ms == null) return null;
    const d = formatIdleShort(e.duration_ms, locale);
    return e.ongoing ? `· ${d} (${t("ongoing")})` : `· ${d}`;
  };

  const toneCat = (ty: string) => {
    const tone = eventTone(ty);
    return tone === "critical" ? t("sev_critical") : tone === "warning" ? t("sev_warning") : t("sev_neutral");
  };

  // ── Genel Bakış: olay TİPİ tile'ları (Reveal Overview policy tile'ları) ───
  const typeTiles = useMemo(() => {
    const byType = new Map<string, { count: number; crit: number; last: string }>();
    for (const e of events) {
      const cur = byType.get(e.event_type) ?? { count: 0, crit: 0, last: e.occurred_at };
      cur.count++;
      if (eventTone(e.event_type) === "critical") cur.crit++;
      if (e.occurred_at > cur.last) cur.last = e.occurred_at;
      byType.set(e.event_type, cur);
    }
    const arr = [...byType.entries()].map(([ty, v]) => ({ type: ty, ...v }));
    arr.sort((a, b) => (sort === "newest" ? b.last.localeCompare(a.last) : b.count - a.count));
    return arr;
  }, [events, sort]);

  // ── Alarm Kaydı: filtreli + sıralı liste ─────────────────────────────────
  const logRows = useMemo(() => {
    let rows = events.filter((e) => {
      if (fVehicle && e.plate !== fVehicle) return false;
      if (fType && e.event_type !== fType) return false;
      if (fSev && eventTone(e.event_type) !== fSev) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "newest") return b.occurred_at.localeCompare(a.occurred_at);
      const d = EVENT_TONE_RANK[eventTone(b.event_type)] - EVENT_TONE_RANK[eventTone(a.event_type)];
      return d !== 0 ? d : b.occurred_at.localeCompare(a.occurred_at);
    });
    return rows;
  }, [events, fVehicle, fType, fSev, sort]);

  const plateOptions = useMemo(
    () => [...new Set(events.map((e) => e.plate))].sort().map((p) => ({ value: p, label: p })),
    [events]
  );
  const typeOptions = useMemo(
    () => [...new Set(events.map((e) => e.event_type))]
      .map((ty) => ({ value: ty, label: t(`type.${ty}`) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [events, t, locale]
  );

  const overviewFilters: RevealFilter[] = [
    {
      label: t("filter_shown"),
      value: range,
      onChange: (v) => startNav(() => router.replace(`/admin/alarmlar?range=${v}`, { scroll: false })),
      // "Yeni eşiklerden beri" EN ÜSTTE ve varsayılan (sunucu tarafında
      // seçiliyor). Sınır kaydı yoksa seçenek hiç listelenmez — tıklanınca
      // 7 güne düşen ölü bir seçenek göstermeyiz.
      options: [
        ...(epochISO ? [{ value: "epoch", label: t("range_epoch") }] : []),
        { value: "today", label: t("range_today") },
        { value: "7d", label: t("range_7d") },
        { value: "30d", label: t("range_30d") },
      ],
    },
    {
      label: t("filter_sort"),
      value: sort,
      onChange: (v) => setSort(v as "most" | "newest"),
      options: [
        { value: "most", label: t("sort_most") },
        { value: "newest", label: t("sort_newest") },
      ],
    },
  ];

  const logFilters: RevealFilter[] = [
    {
      label: t("col_vehicle"),
      value: fVehicle,
      onChange: setFVehicle,
      options: [{ value: "", label: t("all") }, ...plateOptions],
    },
    {
      label: t("filter_type"),
      value: fType,
      onChange: setFType,
      options: [{ value: "", label: t("all") }, ...typeOptions],
    },
    {
      label: t("filter_severity"),
      value: fSev,
      onChange: setFSev,
      options: [
        { value: "", label: t("all") },
        { value: "critical", label: t("sev_critical") },
        { value: "warning", label: t("sev_warning") },
        { value: "neutral", label: t("sev_neutral") },
      ],
    },
  ];

  const columns: Column<AlarmRow>[] = [
    {
      key: "plate",
      header: t("col_vehicle"),
      cell: (e) => (
        <Link href={`/admin/araclar/${e.vehicle_id}`} onClick={(ev) => ev.stopPropagation()}
          className="nums font-medium uppercase tracking-wide hover:underline">{e.plate}</Link>
      ),
      nums: true, sortable: true, sortValue: (e) => e.plate,
    },
    {
      key: "type",
      header: t("col_type"),
      // Rozetin YANINDA süre (migration 024) — chip'in içine gömülmez.
      cell: (e) => {
        const badge = idleBadge(e);
        return (
          <span className="flex items-center gap-1.5">
            <StatusChip tone={eventTone(e.event_type)}>{t(`type.${e.event_type}`)}</StatusChip>
            {badge && <span className="nums text-xs text-muted-foreground">{badge}</span>}
          </span>
        );
      },
      sortable: true, sortValue: (e) => EVENT_TONE_RANK[eventTone(e.event_type)],
    },
    {
      key: "time",
      header: t("col_time"),
      cell: (e) => formatDateTime(e.occurred_at, locale),
      nums: true, sortable: true, sortValue: (e) => e.occurred_at,
    },
    {
      key: "speed",
      header: t("drawer_speed"),
      cell: (e) => e.event_type === "idling"
        ? <span className="text-muted-foreground">{t("context_idle")}</span>
        : SPEED_EVENTS.has(e.event_type) && e.speed_kmh !== null ? `${Math.round(e.speed_kmh)} km/h` : "—",
      align: "right", nums: true, hideBelow: "sm",
    },
  ];

  const selIndex = selected ? logRows.findIndex((e) => e.id === selected.id) : -1;

  function openType(ty: string) {
    setFType(ty);
    setTab("log");
  }

  return (
    <div className="space-y-5">
      <SubTabs
        tabs={[
          { key: "overview", label: t("tab_overview") },
          { key: "log", label: t("tab_log"), badge: undefined },
        ]}
        value={tab}
        onChange={(k) => setTab(k as "overview" | "log")}
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Eşik sınırı uyarısı — başlığın hemen altında, İKİ sekmede de görünür:
          sayılar hem Genel Bakış tile'larında hem Alarm Kaydı'nda aynı karışık
          veriden geliyor. */}
      <EpochWarning epochISO={epochISO} show={showEpochWarning} />

      {tab === "overview" ? (
        <>
          <RevealFilterRow filters={overviewFilters} />
          {typeTiles.length === 0 ? (
            <EmptyState kind="none" title={t("empty_none")} hint={t("empty_hint_none")} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {typeTiles.map((tile) => {
                const tone = eventTone(tile.type);
                return (
                  <button
                    key={tile.type}
                    type="button"
                    onClick={() => openType(tile.type)}
                    className="glass group flex min-h-[120px] flex-col rounded-[8px] border border-border/70 p-[18px] text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: EVENT_STRIPE[tone] }}
                          />
                          <span className="truncate text-base font-semibold">{t(`type.${tile.type}`)}</span>
                        </div>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">{toneCat(tile.type)}</span>
                      </div>
                      {tile.crit > 0 && (
                        <span className="nums grid size-[22px] shrink-0 place-items-center rounded-full bg-status-critical-fill text-[11px] font-medium text-white">
                          {tile.crit}
                        </span>
                      )}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                      <div>
                        <div className="text-xs text-muted-foreground">{t("tile_last")}</div>
                        <div className="nums mt-0.5 text-[13px]">{formatDateTime(tile.last, locale)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{t("tile_alerts")}</div>
                        <div className="nums mt-0.5 text-sm font-semibold">{tile.count.toLocaleString(locale)}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <RevealFilterRow
            filters={logFilters}
            right={
              <div className="flex items-center gap-2">
                <DensityToggle />
                <span className="nums text-xs text-muted-foreground">
                  {logRows.length !== events.length ? `${logRows.length} / ${events.length}` : logRows.length} {t("count")}
                </span>
              </div>
            }
          />
          {logRows.length === 0 ? (
            <EmptyState
              kind={events.length === 0 ? "none" : "filtered"}
              title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
              hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
            />
          ) : (
            <DataTable
              rows={logRows}
              columns={columns}
              rowKey={(e) => e.id}
              onRowClick={(e) => setSelected(e)}
              stripe={(e) => EVENT_STRIPE[eventTone(e.event_type)]}
              grouping={{
                // idling ARTIK epizod (bir rölanti = tek satır + süre) → storm
                // grouping'DEN HARİÇ: her idling satırına benzersiz anahtar ver,
                // asla "×N" altında gruplanmasın. Diğer tipler burst'lerde aynen
                // gruplanır (ani fren/aşırı hız vb. bozulmaz).
                getKey: (e) =>
                  e.event_type === "idling"
                    ? `idle:${e.id}`
                    : `${e.vehicle_id}:${e.event_type}`,
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
        </>
      )}

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(v) => !v && setSelected(null)}
        title={selected?.plate ?? ""}
        subtitle={selected ? formatDateTime(selected.occurred_at, locale) : undefined}
        onPrev={selIndex > 0 ? () => setSelected(logRows[selIndex - 1]) : null}
        onNext={selIndex >= 0 && selIndex < logRows.length - 1 ? () => setSelected(logRows[selIndex + 1]) : null}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div><StatusChip tone={eventTone(selected.event_type)}>{t(`type.${selected.event_type}`)}</StatusChip></div>
            <dl className="grid grid-cols-2 gap-3">
              {selected.event_type === "idling" && selected.duration_ms != null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_duration")}</dt>
                  <dd className="nums mt-0.5">
                    {formatIdleShort(selected.duration_ms, locale)}
                    {selected.ongoing ? ` (${t("ongoing")})` : ""}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_speed")}</dt>
                <dd className="nums mt-0.5">{SPEED_EVENTS.has(selected.event_type) && selected.speed_kmh !== null ? `${Math.round(selected.speed_kmh)} km/h` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("drawer_location")}</dt>
                <dd className="nums mt-0.5">{selected.latitude !== null && selected.longitude !== null ? `${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}` : t("no_location")}</dd>
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
                <a href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-accent-sky hover:underline">
                  <MapPin className="size-4" />{t("open_maps")}<ExternalLink className="size-3" />
                </a>
              )}
              <Link href={`/admin/araclar/${selected.vehicle_id}`} className="inline-flex items-center gap-2 text-sm text-accent-sky hover:underline">
                <Truck className="size-4" />{t("go_vehicle")}
              </Link>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
