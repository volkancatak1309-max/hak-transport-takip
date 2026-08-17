"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Play, Pause, RotateCcw, Gauge, MapPin, ParkingCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDurationShort } from "@/lib/format";
import type { RouteDay } from "@/lib/route-history";
import { TENANT_TZ } from "@/lib/tz";

const RouteReplayMap = dynamic(
  () => import("@/components/RouteReplayMap").then((m) => m.RouteReplayMap),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

const BASE_MS = 24000; // full route traversal at 1× speed
const SPEEDS = [1, 2, 4] as const;

export function RouteReplay({
  route,
  backHref,
  backLabel,
  emptyLabel,
}: {
  route: RouteDay;
  backHref: string;
  backLabel: string;
  /** Message shown when the day has no track. Defaults to the generic route copy;
   *  the device route passes a device-specific "no device data" string. */
  emptyLabel?: string;
}) {
  const t = useTranslations("route");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const points = route.points;
  const geometry = route.geometry.length > 1 ? route.geometry : points.map((p) => [p.lat, p.lng] as [number, number]);
  const hasRoute = points.length > 1;

  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const lastPaintRef = useRef(0);

  // Stop/replay state resets whenever the day changes.
  useEffect(() => {
    setProgress(0);
    setPlaying(false);
  }, [route.date, route.driverId]);

  const tick = useCallback(
    (now: number) => {
      if (lastRef.current == null) lastRef.current = now;
      const dt = now - lastRef.current;
      lastRef.current = now;

      setProgress((p) => {
        const next = p + (dt * speed) / BASE_MS;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });

      // throttle repaint cost to ~33ms (handled by React batching anyway)
      lastPaintRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    },
    [speed]
  );

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [playing, tick]);

  function togglePlay() {
    if (!hasRoute) return;
    if (progress >= 1) setProgress(0);
    setPlaying((v) => !v);
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  function onScrub(v: number) {
    setPlaying(false);
    setProgress(v);
  }
  function onDateChange(date: string) {
    const next = new URLSearchParams(params.toString());
    next.set("date", date);
    router.push(`${pathname}?${next.toString()}`);
  }

  const idx = Math.floor(Math.max(0, Math.min(1, progress)) * Math.max(0, points.length - 1));
  const curTime = points[idx]?.t ?? null;
  // Device heading at the current replay instant (only when the route is directional).
  const curHeading = route.directional ? points[idx]?.heading ?? null : null;
  const saatBicimi = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "de" ? "de-AT" : "tr-TR", {
      timeZone: TENANT_TZ,
      hour: "2-digit",
      minute: "2-digit",
    });
  const timeLabel = curTime ? saatBicimi(curTime) : "--:--";

  /**
   * ÖZET ŞERİDİ (17.08.2026) — "05:12 → 18:44 · 8s 32dk · 142 km".
   *
   * Sorunu şuydu: kontrol satırındaki tek sayı o anki noktanın SAATİ ama ekranda
   * bunu söyleyen bir şey yoktu; kullanıcı onu "süre" sanıyor ve park günlerinde
   * her gün aynı değeri görünce "bozuk" diyordu. Alanlar OPSİYONEL — sunucu
   * göndermezse şerit hiç basılmaz, eski görünüm birebir korunur.
   */
  const ozet = (() => {
    if (!route.firstAt || !route.lastAt) return null;
    const bas = new Date(route.firstAt).getTime();
    const bit = new Date(route.lastAt).getTime();
    if (!Number.isFinite(bas) || !Number.isFinite(bit) || bit < bas) return null;
    const parcalar = [
      `${saatBicimi(route.firstAt)} → ${saatBicimi(route.lastAt)}`,
      formatDurationShort(bit - bas, locale),
    ];
    if (typeof route.distanceKm === "number") {
      parcalar.push(
        `${route.distanceKm.toLocaleString(locale === "de" ? "de-AT" : "tr-TR", {
          maximumFractionDigits: 1,
        })} km`
      );
    }
    return parcalar.join(" · ");
  })();

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-6 sm:px-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {route.driverName && (
            <span className="text-sm text-muted-foreground">
              {route.driverName}
              {route.plate ? ` · ${route.plate}` : ""}
            </span>
          )}
          <input
            type="date"
            value={route.date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="nums h-9 rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring"
          />
        </div>
      </div>

      {/* Map */}
      <div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <div className="h-[60vh] min-h-[420px] w-full">
          <RouteReplayMap
            geometry={geometry}
            progress={progress}
            driverName={route.driverName}
            directional={route.directional}
            heading={curHeading}
          />
        </div>
        {!hasRoute && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
            <span className="flex items-center gap-2 rounded-[10px] border border-border bg-background/90 px-4 py-2 text-sm text-muted-foreground elevate">
              <MapPin className="size-4 text-text-tertiary" />
              {emptyLabel ?? t("no_route")}
            </span>
          </div>
        )}
        {/*
          HAREKETSİZ GÜN (17.08.2026) — veri VAR ama araç hiç kıpırdamamış.
          Rozet ÜSTTE duruyor, ortada değil: aracın o günkü tek konumu haritada
          görünmeye devam etmeli; ortalanmış bir rozet tam onun üstüne otururdu.
          `hasRoute` hâlâ true olduğu için oynatma/kaydırma DEVRE DIŞI BIRAKILMADI
          — davranış değişmiyor, yalnız ekran neden hiçbir şeyin kıpırdamadığını
          söylüyor.
        */}
        {hasRoute && route.stationary && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex justify-center p-3">
            <span className="flex items-center gap-2 rounded-[10px] border border-border bg-background/90 px-4 py-2 text-sm text-muted-foreground elevate">
              <ParkingCircle className="size-4 text-text-tertiary" />
              {t("stationary")}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Button size="icon" onClick={togglePlay} disabled={!hasRoute} aria-label={t("play")}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => {
              setPlaying(false);
              setProgress(0);
            }}
            disabled={!hasRoute}
            aria-label={t("restart")}
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={cycleSpeed} disabled={!hasRoute} className="gap-1.5">
            <Gauge className="size-4" />
            <span className="nums">{speed}×</span>
          </Button>

          <span className="nums ml-1 min-w-[3.5rem] text-sm tabular-nums text-muted-foreground">
            {timeLabel}
          </span>

          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => onScrub(Number(e.target.value) / 1000)}
            disabled={!hasRoute}
            aria-label={t("progress")}
            className="hak-scrub h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-[var(--accent-sky)] disabled:opacity-50"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-tertiary">
          {/* Özet şeridi kontrol satırının ALTINDA: saat etiketiyle aynı kartta ve
              hemen bitişiğinde, ama kaydırıcıyı dar ekranda ezmiyor. */}
          <span className="nums">
            {formatDate(route.date, locale)}
            {ozet ? ` · ${ozet}` : ""}
          </span>
          {hasRoute && (
            <span className="nums">
              {t("points", { n: route.totalRaw })}
              {route.totalRaw > route.points.length ? ` · ${t("sampled")}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
