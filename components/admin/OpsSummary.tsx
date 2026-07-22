"use client";

import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpTip } from "@/components/help/HelpTip";
import { formatDurationShort } from "@/lib/format";
import type { TodayOps, OpsDetail } from "@/lib/admin-dashboard";

type Tone = "sky" | "claret" | "gold" | "neutral";

const TONE: Record<Tone, { text: string; icon: string; ring: string }> = {
  sky: {
    text: "text-accent-sky",
    icon: "bg-accent-sky/12 text-accent-sky",
    ring: "ring-accent-sky/20",
  },
  claret: {
    text: "text-accent-claret-text",
    icon: "bg-accent-claret/12 text-accent-claret-text",
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

type Row = { left: string; right: string };

export function OpsSummary({ ops, detail }: { ops: TodayOps; detail: OpsDetail }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const [openKey, setOpenKey] = useState<string | null>(null);
  // "now" ticks every 30s so the "active since" durations stay fresh. Lazy
  // initializer (allowed) keeps Date.now() out of the render body; the interval
  // updates it from a callback (never a synchronous setState in the effect).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const num = (n: number | null) => (n === null ? "—" : n.toLocaleString(nf));
  const dur = (iso: string | null) =>
    iso ? formatDurationShort(now - new Date(iso).getTime(), locale) : "—";

  const tiles: {
    key: string;
    label: string;
    help: string;
    value: string;
    icon: LucideIcon;
    tone: Tone;
    live?: boolean;
  }[] = [
    { key: "drivers", label: t("dash.ops_drivers_field"), help: "ops_drivers", value: num(ops.driversInField), icon: Users, tone: "sky", live: ops.driversInField > 0 },
    { key: "vehicles", label: t("dash.ops_vehicles_delivering"), help: "ops_vehicles", value: num(ops.vehiclesDelivering), icon: Truck, tone: "sky" },
    { key: "break", label: t("dash.ops_on_break"), help: "ops_break", value: num(ops.onBreak), icon: Coffee, tone: "claret" },
    { key: "km", label: t("dash.ops_km_today"), help: "ops_km", value: num(ops.totalKmToday), icon: Gauge, tone: "neutral" },
    { key: "loaded", label: t("dash.ops_loaded"), help: "ops_loaded", value: num(ops.loaded), icon: Package, tone: "neutral" },
    { key: "delivered", label: t("dash.ops_delivered"), help: "ops_delivered", value: num(ops.delivered), icon: PackageCheck, tone: "neutral" },
    { key: "undelivered", label: t("dash.ops_undelivered"), help: "ops_undelivered", value: num(ops.undelivered), icon: PackageX, tone: ops.undelivered && ops.undelivered > 0 ? "gold" : "neutral" },
    // İKİ AYRI KART (22.07.2026). Eskiden tek "9 Saati Aşan" kartı vardı ve
    // 9 saat ihlal gibi görünüyordu; 20 şoför kırmızıya düşüyordu.
    //   • overLimit → § 9 Abs. 1 (gece: § 14 Abs. 2) yasal tavan → claret
    //   • break45   → § 13c Abs. 1 mola kademesi → gold (uyarı, ihlal değil)
    { key: "overLimit", label: t("dash.ops_over_limit"), help: "ops_over_limit", value: num(ops.overLimit), icon: AlertTriangle, tone: ops.overLimit > 0 ? "claret" : "neutral" },
    { key: "break45", label: t("dash.ops_break45"), help: "ops_break45", value: num(ops.needsBreak45), icon: Coffee, tone: ops.needsBreak45 > 0 ? "gold" : "neutral" },
  ];

  function rowsFor(key: string): Row[] {
    switch (key) {
      case "drivers":
        return detail.driversInField.map((d) => ({
          left: d.name,
          right: [d.plate, dur(d.since)].filter(Boolean).join(" · "),
        }));
      case "vehicles":
        return detail.vehiclesDelivering.map((v) => ({
          left: v.plate,
          right: v.driver_name ?? "—",
        }));
      case "break":
        return detail.onBreak.map((b) => ({ left: b.name, right: dur(b.since) }));
      case "km":
        return detail.km.map((r) => ({ left: r.name, right: `${r.value.toLocaleString(nf)} km` }));
      case "loaded":
        return detail.loaded.map((r) => ({ left: r.name, right: r.value.toLocaleString(nf) }));
      case "delivered":
        return detail.delivered.map((r) => ({ left: r.name, right: r.value.toLocaleString(nf) }));
      case "undelivered":
        return detail.undelivered.map((r) => ({ left: r.name, right: r.value.toLocaleString(nf) }));
      case "overLimit":
        return detail.overLimit.map((o) => ({
          left: o.name,
          right: formatDurationShort(o.ms, locale),
        }));
      case "break45":
        return detail.needsBreak45.map((o) => ({
          left: o.name,
          right: `${formatDurationShort(o.ms, locale)} · ${o.breakMin} dk`,
        }));
      default:
        return [];
    }
  }

  const activeTile = tiles.find((t) => t.key === openKey);
  const rows = openKey ? rowsFor(openKey) : [];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1 text-sm font-semibold tracking-tight">
            {t("dash.ops_title")}
            <HelpTip tkey="ops_title" />
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-sky/12 px-2.5 py-1 text-[12px] sm:text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-sky">
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
                role="button"
                tabIndex={0}
                onClick={() => setOpenKey(tile.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenKey(tile.key);
                  }
                }}
                /* Erişilebilir ad görünen metni İÇERMELİ (WCAG 2.5.3 Label in
                   Name). Yalnız tile.label vermek, görünen "0 SAHADAKİ ŞOFÖR"
                   ile uyuşmuyordu (Lighthouse label-content-name-mismatch).
                   Değeri de ada katmak hem kuralı sağlıyor hem ekran okuyucuya
                   sayıyı duyuruyor. */
                aria-label={`${tile.value} ${tile.label}`}
                className="flex cursor-pointer flex-col gap-2 rounded-xl bg-surface-2/60 p-3 ring-1 ring-inset ring-border/60 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky/40"
              >
                <div className="flex items-center justify-between">
                  <span className={`flex size-7 items-center justify-center rounded-lg ${tone.icon}`}>
                    <Icon className="size-4" />
                  </span>
                  {tile.live && <span className="live-dot" />}
                </div>
                <div>
                  <div className={`nums text-xl font-semibold leading-none ${tone.text}`}>
                    {tile.value}
                  </div>
                  <div className="mt-1 flex items-center gap-0.5 text-[12px] sm:text-[10px] font-medium uppercase leading-tight tracking-[0.04em] text-muted-foreground">
                    <span>{tile.label}</span>
                    {/* keep the (i) help working without triggering the tile */}
                    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <HelpTip tkey={tile.help} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog open={openKey !== null} onOpenChange={(o) => !o && setOpenKey(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeTile?.label}
              {activeTile && (
                <span className="nums rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {activeTile.value}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("dash.detail_empty")}</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {rows.map((r, i) => (
                <li key={`${r.left}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="truncate">{r.left}</span>
                  <span className="nums shrink-0 font-medium text-muted-foreground">{r.right}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
