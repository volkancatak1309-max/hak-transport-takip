"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Truck, Search, ChevronRight, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/help/HelpTip";
import { STATUS_STYLE } from "@/lib/vehicle-ui";
import type { VehicleWithStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AraclarClient({ vehicles }: { vehicles: VehicleWithStatus[] }) {
  const t = useTranslations("vehicles");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = { total: vehicles.length, sevkiyatta: 0, molada: 0, bosta: 0, bakimda: 0 };
    for (const v of vehicles) c[v.live_status]++;
    return c;
  }, [vehicles]);

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    if (!s) return vehicles;
    return vehicles.filter(
      (v) =>
        v.plate.toLocaleLowerCase("tr").includes(s) ||
        (v.driver_name ?? "").toLocaleLowerCase("tr").includes(s) ||
        `${v.make ?? ""} ${v.model ?? ""}`.toLocaleLowerCase("tr").includes(s)
    );
  }, [vehicles, q]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 px-4 py-6 sm:px-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi_total")} value={counts.total} />
        <Kpi label={t("kpi_active")} value={counts.sevkiyatta} accent="sky" live={counts.sevkiyatta > 0} />
        <Kpi label={t("kpi_break")} value={counts.molada} accent="claret" />
        <Kpi label={t("kpi_idle")} value={counts.bosta} accent="gold" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="h-11 pl-9"
          />
        </div>
        <HelpTip tkey="veh_list" />
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("none")}</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((v) => {
              const st = STATUS_STYLE[v.live_status];
              return (
                <li key={v.id}>
                  <Link
                    href={`/admin/araclar/${v.id}`}
                    className={cn(
                      "group flex items-center gap-3 border-l-[3px] px-4 py-3.5 transition-colors duration-150 hover:bg-surface-2",
                      st.stripe
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-muted-foreground">
                      <Truck className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="nums truncate text-sm font-semibold uppercase tracking-wide">
                          {v.plate}
                        </span>
                        <span className="hidden truncate text-xs text-text-tertiary sm:inline">
                          {[v.make, v.model].filter(Boolean).join(" ")}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserRound className="size-3.5 shrink-0 text-text-tertiary" />
                        {v.driver_name ? (
                          <span className="truncate">
                            {v.driver_name}
                            {!v.driver_is_live && (
                              <span className="ml-1 text-text-tertiary">· {t("assigned_label")}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">{t("no_driver")}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
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
                    <ChevronRight className="size-4 shrink-0 text-text-tertiary transition-colors group-hover:text-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
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
  value: number;
  accent?: "sky" | "claret" | "gold";
  live?: boolean;
}) {
  const color =
    accent === "sky"
      ? "text-accent-sky"
      : accent === "claret"
      ? "text-accent-claret"
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
      <div className={`nums mt-1.5 text-[28px] font-semibold leading-none ${color}`}>{value}</div>
    </div>
  );
}
