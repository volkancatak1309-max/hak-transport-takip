"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MapPinned, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { HelpTip } from "@/components/help/HelpTip";
import { formatTime, formatDurationShort } from "@/lib/format";
import type { ActiveDriver, ActiveVehicle } from "@/lib/types";

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
  onMap: number;
  longestMs: number;
  overLimit: number;
};

export function LiveTrackingClient({
  drivers,
  vehicles,
  summary,
}: {
  drivers: ActiveDriver[];
  vehicles: ActiveVehicle[];
  summary: Summary;
}) {
  const t = useTranslations("map");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());

  // Soft auto-refresh of server data + a 1s tick for live durations.
  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi_active")} value={String(summary.activeShifts)} accent="sky" live={summary.activeShifts > 0} />
        <Kpi label={t("kpi_on_map")} value={String(summary.onMap)} />
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
        <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <MapPinned className="size-[18px] text-accent-claret" />
              <span className="text-sm font-medium">{t("title")}</span>
              <HelpTip tkey="map" />
            </div>
            <span className="nums text-xs text-text-tertiary">
              {drivers.length + vehicles.length}
            </span>
          </div>
          <div className="relative h-[58vh] min-h-[420px] w-full">
            <FleetMap drivers={drivers} vehicles={vehicles} />
            {drivers.length === 0 && vehicles.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
                <span className="rounded-[10px] border border-border bg-background/90 px-4 py-2 text-sm text-muted-foreground elevate">
                  {t("no_active")}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Driver list */}
        <section className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-medium">{t("drivers_title")}</span>
            <span className="nums text-xs text-text-tertiary">{drivers.length}</span>
          </div>
          {drivers.length === 0 ? (
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
                        <span className="live-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-card" />
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
                          <span className="nums text-text-tertiary">
                            {t("last_update", { time: formatTime(d.recorded_at, locale) })}
                          </span>
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
  accent,
  live,
}: {
  label: string;
  value: string;
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
    <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {live && <span className="live-dot" />}
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
          {label}
        </span>
      </div>
      <div className={`nums mt-1.5 text-[28px] font-semibold leading-none ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
