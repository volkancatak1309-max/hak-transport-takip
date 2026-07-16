"use client";

import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/help/HelpTip";
import type { FleetStatus as FleetStatusData } from "@/lib/admin-dashboard";
import type { VehicleLiveStatus } from "@/lib/types";

const ORDER: VehicleLiveStatus[] = ["sevkiyatta", "bosta", "molada", "bakimda"];

// Brand palette — NO green/red. Sky = active, gold = idle, claret = break,
// neutral gray = maintenance. Driven from the OKLCH design tokens.
const COLOR: Record<VehicleLiveStatus, string> = {
  sevkiyatta: "var(--accent-sky)",
  bosta: "var(--accent-gold)",
  molada: "var(--accent-claret)",
  bakimda: "var(--muted-foreground)",
};

export function FleetStatus({ fleet }: { fleet: FleetStatusData }) {
  const t = useTranslations("admin");
  const ts = useTranslations("vehicles.status");

  const rows = ORDER.map((status) => ({
    status,
    label: ts(status),
    value: fleet.counts[status],
    color: COLOR[status],
  }));
  const data = rows.filter((r) => r.value > 0);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Truck className="size-4 text-muted-foreground" />
          {t("dash.fleet_title")}
          <HelpTip tkey="fleet" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {fleet.total === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8 text-sm text-muted-foreground">
            {t("dash.fleet_empty")}
          </div>
        ) : (
          <div className="flex items-center gap-5">
            {/* Tek statü (ör. hepsi boşta) → donut sıfır bilgi taşır (audit);
                net özet gösterilir. Karışıksa donut. */}
            {data.length <= 1 ? (
              <div className="flex size-32 shrink-0 flex-col items-center justify-center rounded-full border border-border/60">
                <span className="nums text-3xl font-semibold leading-none">{fleet.total}</span>
                <span className="mt-1 text-[11px] font-medium" style={{ color: data[0]?.color }}>
                  {data[0]?.label}
                </span>
              </div>
            ) : (
              <div className="relative size-32 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius="64%"
                      outerRadius="100%"
                      paddingAngle={2}
                      stroke="var(--card)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {data.map((d) => (
                        <Cell key={d.status} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="nums text-2xl font-semibold leading-none">{fleet.total}</span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
                    {t("dash.fleet_total")}
                  </span>
                </div>
              </div>
            )}
            <ul className="flex-1 space-y-1.5">
              {rows.map((r) => {
                const pct = fleet.total > 0 ? Math.round((r.value / fleet.total) * 100) : 0;
                return (
                  <li
                    key={r.status}
                    className="relative flex items-center gap-2.5 overflow-hidden rounded-[8px] px-2 py-1 text-sm"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-[8px] opacity-[0.16]"
                      style={{ width: `${pct}%`, backgroundColor: r.color }}
                    />
                    <span
                      className="relative z-10 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="relative z-10 flex-1 text-muted-foreground">{r.label}</span>
                    <span className="nums relative z-10 font-semibold tabular-nums">{r.value}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
