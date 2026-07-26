"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ListFilter,
  MapPin,
  Route,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { EmptyState, SpecRow } from "@/components/ui-v2";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { HelpTip } from "@/components/help/HelpTip";
import { AlarmStrip } from "./AlarmStrip";
import { eventTone, EVENT_TONE_RANK } from "@/lib/event-ui";
import { formatDateTime, formatDate, formatTime, formatIdleShort } from "@/lib/format";
import type { VehicleEventWithPlate, EventDensityCell } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import type { AlarmRange } from "./page";

export type AlarmRow = VehicleEventWithPlate & {
  duration_ms?: number | null;
  ongoing?: boolean;
};

const EventMiniMap = dynamic(() => import("@/components/admin/EventMiniMap"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-[12px] bg-surface-panel" />,
});

const SPEED_EVENTS = new Set([
  "overspeeding",
  "harsh_acceleration",
  "harsh_braking",
  "harsh_cornering",
  "crash",
]);

/** Linear'ın Display menüsündeki gruplama ekseni. */
type GroupBy = "severity" | "date";

/**
 * ALARMLAR — üç referansın birleşimi:
 *   ① Zendesk `7957c520` → 90 günlük araç şeridi (AlarmStrip)
 *   ② Linear  `2a0adcf3` → kolon başlığı/ayraç/zebra OLMAYAN gruplu liste
 *   ③ Stripe  `4e3c7127` → satır YERİNDE açılır: künye + mini harita + eylem
 *
 * Eski iskeletten (SubTabs "Genel Bakış/Kayıt" + DataTable + DetailDrawer)
 * parça kalmadı. İşlev korundu: aralık/epoch varsayılanı, eşik uyarısı,
 * araç/tip/önem filtreleri, rölanti epizodu süresi, haritada aç, araca git.
 *
 * Gruplama VARSAYILANI ÖNEM: bu ekranın sorusu "şimdi neye müdahale edeyim",
 * "salı günü ne oldu" değil. Tarih ekseni Display'de ikinci seçenek.
 */
export function AlarmsClient({
  events,
  density,
  stripDays,
  vehicles,
  range,
  epochISO,
  showEpochWarning,
}: {
  events: AlarmRow[];
  density: EventDensityCell[];
  stripDays: number;
  vehicles: { id: string; plate: string; fleet: string }[];
  range: AlarmRange;
  epochISO: string | null;
  showEpochWarning: boolean;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  const [fVehicle, setFVehicle] = useState("");
  const [fType, setFType] = useState("");
  const [fSev, setFSev] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("severity");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const idleBadge = (e: AlarmRow): string | null => {
    if (e.event_type !== "idling" || e.duration_ms == null) return null;
    const d = formatIdleShort(e.duration_ms, locale);
    return e.ongoing ? `${d} · ${t("ongoing")}` : d;
  };

  const filtered = useMemo(() => {
    const rows = events.filter((e) => {
      if (fVehicle && e.plate !== fVehicle) return false;
      if (fType && e.event_type !== fType) return false;
      if (fSev && eventTone(e.event_type) !== fSev) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const d =
        EVENT_TONE_RANK[eventTone(b.event_type)] - EVENT_TONE_RANK[eventTone(a.event_type)];
      return d !== 0 ? d : b.occurred_at.localeCompare(a.occurred_at);
    });
  }, [events, fVehicle, fType, fSev]);

  /** Gruplu liste — Linear'ın katlanır başlık + sayaç deseni. */
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; rows: AlarmRow[] }>();
    for (const e of filtered) {
      let key: string;
      let label: string;
      if (groupBy === "severity") {
        const tone = eventTone(e.event_type);
        key = tone === "critical" ? "0-critical" : tone === "warning" ? "1-warning" : "2-neutral";
        label =
          tone === "critical"
            ? t("sev_critical")
            : tone === "warning"
              ? t("sev_warning")
              : t("sev_neutral");
      } else {
        key = e.occurred_at.slice(0, 10);
        label = formatDate(e.occurred_at, locale);
      }
      const cur = m.get(key);
      if (cur) cur.rows.push(e);
      else m.set(key, { label, rows: [e] });
    }
    return [...m.entries()]
      .sort((a, b) => (groupBy === "severity" ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
      .map(([key, v]) => ({ key, ...v }));
  }, [filtered, groupBy, t, locale]);

  const plateOptions = useMemo(
    () => [...new Set(events.map((e) => e.plate))].sort(),
    [events]
  );
  const typeOptions = useMemo(
    () =>
      [...new Set(events.map((e) => e.event_type))]
        .map((ty) => ({ value: ty, label: t(`type.${ty}`) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [events, t, locale]
  );

  const activeChips = [
    fVehicle && { k: "v", label: `${t("col_vehicle")}: ${fVehicle}`, clear: () => setFVehicle("") },
    fType && { k: "t", label: `${t("filter_type")}: ${t(`type.${fType}`)}`, clear: () => setFType("") },
    fSev && {
      k: "s",
      label: `${t("filter_severity")}: ${fSev === "critical" ? t("sev_critical") : fSev === "warning" ? t("sev_warning") : t("sev_neutral")}`,
      clear: () => setFSev(""),
    },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const toneDot = (ty: string) => {
    const tone = eventTone(ty);
    return tone === "critical"
      ? "bg-status-critical"
      : tone === "warning"
        ? "bg-accent-gold"
        : "bg-muted-foreground";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
          <HelpTip tkey="alarms_page" />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <EpochWarning epochISO={epochISO} show={showEpochWarning} />

      {/* ① ZENDESK ŞERİDİ — aralık filtresinden BAĞIMSIZ, hep son 90 gün. */}
      <AlarmStrip
        cells={density}
        days={stripDays}
        vehicles={vehicles}
        onPick={setFVehicle}
        activePlate={fVehicle}
      />

      {/* ② LINEAR ÇUBUĞU — solda Filter, sağda Display. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <ListFilter className="size-3.5" aria-hidden />
          {t("filter_label")}
        </span>

        <Select value={range} onValueChange={(v) => v && startNav(() => router.replace(`/admin/alarmlar?range=${v}`, { scroll: false }))}>
          <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]" aria-label={t("filter_shown")}>
            <span>
              {range === "epoch" ? t("range_epoch") : range === "today" ? t("range_today") : range === "7d" ? t("range_7d") : t("range_30d")}
            </span>
          </SelectTrigger>
          <SelectContent>
            {epochISO && <SelectItem value="epoch">{t("range_epoch")}</SelectItem>}
            <SelectItem value="today">{t("range_today")}</SelectItem>
            <SelectItem value="7d">{t("range_7d")}</SelectItem>
            <SelectItem value="30d">{t("range_30d")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={fSev} onValueChange={(v) => setFSev(v === "__all" ? "" : String(v ?? ""))}>
          <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]" aria-label={t("filter_severity")}>
            <span>{t("filter_severity")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            <SelectItem value="critical">{t("sev_critical")}</SelectItem>
            <SelectItem value="warning">{t("sev_warning")}</SelectItem>
            <SelectItem value="neutral">{t("sev_neutral")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={fType} onValueChange={(v) => setFType(v === "__all" ? "" : String(v ?? ""))}>
          <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]" aria-label={t("filter_type")}>
            <span>{t("filter_type")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            {typeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fVehicle} onValueChange={(v) => setFVehicle(v === "__all" ? "" : String(v ?? ""))}>
          <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]" aria-label={t("col_vehicle")}>
            <span>{t("col_vehicle")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            {plateOptions.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]" aria-label={t("display_label")}>
              <SlidersHorizontal className="size-3.5" aria-hidden />
              <span>{t("display_label")}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="severity">{t("group_severity")}</SelectItem>
              <SelectItem value="date">{t("group_date")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {filtered.length !== events.length ? `${filtered.length} / ${events.length}` : filtered.length}
          </span>
        </div>
      </div>

      {/* Aktif filtre çipleri — görünmeyen filtre en pahalı hatadır. */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map((c) => (
            <span key={c.k} className="surface-card inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]">
              {c.label}
              <button type="button" onClick={c.clear} aria-label={c.label} className="rounded-full p-0.5 text-text-tertiary transition-colors hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ② LINEAR LİSTESİ — kolon başlığı yok, ayraç yok, zebra yok. */}
      {filtered.length === 0 ? (
        <EmptyState
          kind={events.length === 0 ? "none" : "filtered"}
          title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
          hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
        />
      ) : (
        <div className="glass-panel rounded-[16px] px-2 py-3 sm:px-4">
          {groups.map((g) => {
            const off = collapsed.has(g.key);
            return (
              <section key={g.key} className="mb-2 last:mb-0">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((s) => {
                      const n = new Set(s);
                      if (n.has(g.key)) n.delete(g.key);
                      else n.add(g.key);
                      return n;
                    })
                  }
                  aria-expanded={!off}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-surface-panel"
                >
                  <ChevronRight className={cn("size-3.5 text-text-tertiary transition-transform", !off && "rotate-90")} aria-hidden />
                  <span className="text-[13px] font-medium">{g.label}</span>
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{g.rows.length}</span>
                </button>

                {!off && (
                  <ul>
                    {g.rows.map((e) => {
                      const open = openId === e.id;
                      const badge = idleBadge(e);
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : e.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-panel"
                          >
                            <span className={cn("size-2 shrink-0 rounded-full", toneDot(e.event_type))} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-[13px]">
                              {t(`type.${e.event_type}`)}
                              {badge && (
                                <span className="ml-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
                                  {badge}
                                </span>
                              )}
                            </span>
                            <span className="hidden shrink-0 font-mono text-[12px] font-medium uppercase tabular-nums sm:inline">
                              {e.plate}
                            </span>
                            <span className="shrink-0 font-mono text-[12px] tabular-nums text-text-tertiary">
                              {formatTime(e.occurred_at, locale)}
                            </span>
                            <ChevronDown className={cn("size-3.5 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} aria-hidden />
                          </button>

                          {/* ③ STRIPE AÇILIR SATIR — künye + mini harita + eylem.
                              Ayrı çekmece YOK: bağlam satırın yerinde kalır. */}
                          {open && (
                            <div className="mb-2 grid gap-4 rounded-[12px] bg-surface-panel px-4 py-3 md:grid-cols-[1fr_280px]">
                              <dl>
                                <SpecRow label={t("col_vehicle")} mono>
                                  <Link href={`/admin/araclar/${e.vehicle_id}`} className="hover:underline">
                                    {e.plate}
                                  </Link>
                                </SpecRow>
                                <SpecRow label={t("col_type")}>{t(`type.${e.event_type}`)}</SpecRow>
                                <SpecRow label={t("col_time")} mono>
                                  {formatDateTime(e.occurred_at, locale)}
                                </SpecRow>
                                {e.event_type === "idling" && e.duration_ms != null && (
                                  <SpecRow label={t("drawer_duration")} mono>
                                    {formatIdleShort(e.duration_ms, locale)}
                                    {e.ongoing ? ` (${t("ongoing")})` : ""}
                                  </SpecRow>
                                )}
                                <SpecRow label={t("drawer_speed")} mono muted={!SPEED_EVENTS.has(e.event_type) || e.speed_kmh === null}>
                                  {SPEED_EVENTS.has(e.event_type) && e.speed_kmh !== null
                                    ? `${Math.round(e.speed_kmh)} km/h`
                                    : "—"}
                                </SpecRow>
                                <SpecRow label={t("drawer_location")} mono muted={e.latitude === null}>
                                  {e.latitude !== null && e.longitude !== null
                                    ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`
                                    : t("no_location")}
                                </SpecRow>
                              </dl>

                              <div className="space-y-2">
                                {e.latitude !== null && e.longitude !== null && (
                                  <div className="overflow-hidden rounded-[12px]">
                                    <EventMiniMap lat={e.latitude} lng={e.longitude} />
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                  <Link href={`/admin/araclar/${e.vehicle_id}`} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline">
                                    <Truck className="size-3.5" aria-hidden />
                                    {t("go_vehicle")}
                                  </Link>
                                  <Link href={`/admin/araclar/${e.vehicle_id}/rota`} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline">
                                    <Route className="size-3.5" aria-hidden />
                                    {t("go_route")}
                                  </Link>
                                  {e.latitude !== null && e.longitude !== null && (
                                    <a
                                      href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline"
                                    >
                                      <MapPin className="size-3.5" aria-hidden />
                                      {t("open_maps")}
                                      <ExternalLink className="size-3" aria-hidden />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
