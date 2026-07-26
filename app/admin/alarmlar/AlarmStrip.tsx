"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { EventDensityCell } from "@/lib/telemetry";

/**
 * GENEL BAKIŞ ŞERİDİ — Zendesk status sayfası klonu (`7957c520`).
 *
 * Araç başına son N günün alarm yoğunluğu, gün başına bir ince hücre.
 * Referansın asıl fikri: **sayı okumadan** hangi aracın sorunlu olduğunu
 * görmek. Zendesk'te bir servisin 90 günü tek bakışta okunur; bizde bir aracın.
 *
 * ÖNEMLİ SAPMA — "sorunsuz gün" YEŞİL DEĞİL, nötr gri. Kilitte yeşil yalnız
 * donanım kontak sinyaline ayrılmış (DESIGN.md §2.3); burada yeşil kullanmak
 * "araç çalışıyor" ile "alarm yok"u aynı renge bindirirdi. Yoğunluk skalası:
 * nötr → mercan-soft → mercan → kritik.
 */

type Props = {
  cells: EventDensityCell[];
  days: number;
  vehicles: { id: string; plate: string; fleet: string }[];
  /** Şeride tıklanınca o araç listede filtrelenir. */
  onPick: (plate: string) => void;
  activePlate: string;
};

/** Gün anahtarı üretimi — Vienna gününü istemcide tekrar hesaplamadan,
 *  sunucunun ürettiği anahtar biçimiyle (YYYY-MM-DD) aynı sırayı kurar. */
function dayKeys(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }
  return out;
}

export function AlarmStrip({ cells, days, vehicles, onPick, activePlate }: Props) {
  const t = useTranslations("alarms");
  const [showClean, setShowClean] = useState(false);

  const keys = useMemo(() => dayKeys(days), [days]);

  /** araç → gün → hücre */
  const byVehicle = useMemo(() => {
    const m = new Map<string, Map<string, EventDensityCell>>();
    for (const c of cells) {
      let inner = m.get(c.vehicle_id);
      if (!inner) m.set(c.vehicle_id, (inner = new Map()));
      inner.set(c.day, c);
    }
    return m;
  }, [cells]);

  const rows = useMemo(() => {
    const arr = vehicles.map((v) => {
      const inner = byVehicle.get(v.id);
      let total = 0;
      let crit = 0;
      if (inner) {
        for (const c of inner.values()) {
          total += c.count;
          if (c.worst === "critical") crit += c.count;
        }
      }
      return { ...v, total, crit, inner };
    });
    // Sorunlu araç önce; eşitse plakaya düşer.
    arr.sort((a, b) => b.crit - a.crit || b.total - a.total || a.plate.localeCompare(b.plate));
    return arr;
  }, [vehicles, byVehicle]);

  const dirty = rows.filter((r) => r.total > 0);
  const clean = rows.filter((r) => r.total === 0);
  const shown = showClean ? rows : dirty;

  if (rows.length === 0) return null;

  return (
    <section className="glass-panel rounded-[16px] p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t("strip_title", { days })}</h2>
        <span className="text-[12px] text-muted-foreground">
          {t("strip_legend")}
        </span>
      </header>

      {dirty.length === 0 ? (
        <p className="py-2 text-[13px] text-muted-foreground">{t("strip_all_clean")}</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((r) => {
            const on = activePlate === r.plate;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(on ? "" : r.plate)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors",
                    on ? "bg-surface-hover" : "hover:bg-surface-panel"
                  )}
                >
                  <span className="w-[70px] shrink-0 font-mono text-[11px] font-semibold uppercase tabular-nums sm:w-[92px] sm:text-[12px]">
                    {r.plate}
                  </span>
                  {/* ŞERİT — gün başına 1 hücre. Renk tek taşıyıcı değil:
                      her hücrenin title'ında gün + sayı yazar. */}
                  <span className="flex min-w-0 flex-1 gap-px sm:gap-[2px]">
                    {keys.map((k) => {
                      const c = r.inner?.get(k);
                      const tone = !c
                        ? "bg-surface-panel"
                        : c.worst === "critical"
                          ? "bg-status-critical"
                          : c.count >= 3
                            ? "bg-accent-coral"
                            : "bg-accent-coral-soft";
                      return (
                        <span
                          key={k}
                          title={c ? `${k} · ${c.count}` : `${k} · 0`}
                          // min-w YOK: 90 hücre dar ekranda 1px altına inebilmeli, yoksa satır taşar
                          className={cn("h-5 min-w-0 flex-1 rounded-[2px]", tone)}
                        />
                      );
                    })}
                  </span>
                  <span className="w-[40px] shrink-0 text-right font-mono text-[12px] tabular-nums sm:w-[54px]">
                    {r.crit > 0 ? (
                      <span className="text-status-critical-text">{r.total}</span>
                    ) : (
                      <span className="text-muted-foreground">{r.total}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {clean.length > 0 && (
        <button
          type="button"
          onClick={() => setShowClean((v) => !v)}
          className="mt-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {showClean ? t("strip_hide_clean") : t("strip_show_clean", { n: clean.length })}
        </button>
      )}
    </section>
  );
}
