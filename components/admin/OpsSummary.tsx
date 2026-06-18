"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Users,
  Truck,
  Coffee,
  Gauge,
  Package,
  PackageCheck,
  PackageX,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HelpTip } from "@/components/help/HelpTip";
import type { TodayOps } from "@/lib/admin-dashboard";

type Tone = "sky" | "claret" | "gold" | "neutral";

const TONE: Record<Tone, { text: string; icon: string; ring: string }> = {
  sky: {
    text: "text-accent-sky",
    icon: "bg-accent-sky/12 text-accent-sky",
    ring: "ring-accent-sky/20",
  },
  claret: {
    text: "text-accent-claret",
    icon: "bg-accent-claret/12 text-accent-claret",
    ring: "ring-accent-claret/20",
  },
  gold: {
    text: "text-accent-gold",
    icon: "bg-accent-gold/15 text-accent-gold",
    ring: "ring-accent-gold/25",
  },
  neutral: {
    text: "text-foreground",
    icon: "bg-surface-2 text-muted-foreground",
    ring: "ring-border",
  },
};

export function OpsSummary({ ops }: { ops: TodayOps }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(nf));

  const tiles: {
    key: string;
    label: string;
    help: string;
    value: string;
    icon: LucideIcon;
    tone: Tone;
    live?: boolean;
  }[] = [
    {
      key: "drivers",
      label: t("dash.ops_drivers_field"),
      help: "ops_drivers",
      value: num(ops.driversInField),
      icon: Users,
      tone: "sky",
      live: ops.driversInField > 0,
    },
    {
      key: "vehicles",
      label: t("dash.ops_vehicles_delivering"),
      help: "ops_vehicles",
      value: num(ops.vehiclesDelivering),
      icon: Truck,
      tone: "sky",
    },
    {
      key: "break",
      label: t("dash.ops_on_break"),
      help: "ops_break",
      value: num(ops.onBreak),
      icon: Coffee,
      tone: "claret",
    },
    {
      key: "km",
      label: t("dash.ops_km_today"),
      help: "ops_km",
      value: num(ops.totalKmToday),
      icon: Gauge,
      tone: "neutral",
    },
    {
      key: "loaded",
      label: t("dash.ops_loaded"),
      help: "ops_loaded",
      value: num(ops.loaded),
      icon: Package,
      tone: "neutral",
    },
    {
      key: "delivered",
      label: t("dash.ops_delivered"),
      help: "ops_delivered",
      value: num(ops.delivered),
      icon: PackageCheck,
      tone: "neutral",
    },
    {
      key: "undelivered",
      label: t("dash.ops_undelivered"),
      help: "ops_undelivered",
      value: num(ops.undelivered),
      icon: PackageX,
      tone: ops.undelivered && ops.undelivered > 0 ? "gold" : "neutral",
    },
    {
      key: "over9",
      label: t("dash.ops_over_nine"),
      help: "ops_over9",
      value: num(ops.overNine),
      icon: AlertTriangle,
      tone: ops.overNine > 0 ? "gold" : "neutral",
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1 text-sm font-semibold tracking-tight">
            {t("dash.ops_title")}
            <HelpTip tkey="ops_title" />
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-sky/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-sky">
            <span className="live-dot" />
            {t("dash.live")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {tiles.map((tile) => {
            const tone = TONE[tile.tone];
            const Icon = tile.icon;
            return (
              <div
                key={tile.key}
                className="flex flex-col gap-2 rounded-xl bg-surface-2/60 p-3 ring-1 ring-inset ring-border/60 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex size-7 items-center justify-center rounded-lg ${tone.icon}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  {tile.live && <span className="live-dot" />}
                </div>
                <div>
                  <div className={`nums text-xl font-semibold leading-none ${tone.text}`}>
                    {tile.value}
                  </div>
                  <div className="mt-1 flex items-center gap-0.5 text-[10px] font-medium uppercase leading-tight tracking-[0.04em] text-muted-foreground">
                    <span>{tile.label}</span>
                    <HelpTip tkey={tile.help} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
