"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sekmeli ranked-breakdown kartı (REVEAL-GAP §3.3 — Dub analytics eb41f99a
 * breakdown cards + Reveal Alert Summary "Rank" deseni). Üstte sekmeler
 * ("Araca göre / Tipe göre"), gövdede sıralı liste: her satır arkasında
 * max'a göre yatay bar + sağda sayı. Satıra tıkla → drill (o değere filtrele).
 * Volkan #3-4'ün kalbi: ölü özet kartı → interaktif giriş kapısı.
 */
export type BreakdownRow = {
  key: string;
  label: React.ReactNode;
  value: number;
  /** Bar rengi (CSS token). Verilmezse sky. */
  color?: string;
  onClick?: () => void;
  /** Satır seçili mi (aktif filtre). */
  active?: boolean;
};

export type BreakdownTab = {
  key: string;
  label: string;
  rows: BreakdownRow[];
  /** Sağ üstteki ölçü etiketi (ör. "olay"). */
  unit?: string;
};

export function BreakdownCard({
  title,
  tabs,
  emptyLabel = "Veri yok",
  className,
}: {
  title?: string;
  tabs: BreakdownTab[];
  emptyLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  const max = Math.max(1, ...(tab?.rows.map((r) => r.value) ?? [1]));

  return (
    <div className={cn("glass flex flex-col rounded-[16px] p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-[10px] border border-border/60 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={t.key === tab?.key}
              className={cn(
                "rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors",
                t.key === tab?.key
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab?.unit && (
          <span className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
            {tab.unit}
          </span>
        )}
      </div>

      {title && (
        <p className="mb-2 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
          {title}
        </p>
      )}

      {!tab || tab.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1">
          {tab.rows.map((r) => {
            const pct = Math.round((r.value / max) * 100);
            const Row = r.onClick ? "button" : "div";
            return (
              <li key={r.key}>
                <Row
                  {...(r.onClick ? { type: "button", onClick: r.onClick } : {})}
                  className={cn(
                    "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[8px] px-2.5 py-1.5 text-left text-sm",
                    r.onClick && "transition-colors hover:bg-surface-2",
                    r.active && "bg-surface-2 ring-1 ring-ring/50"
                  )}
                >
                  {/* Arka bar — Dub deseni: satırın arkasında değeri gösteren dolgu. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-[8px] opacity-[0.18]"
                    style={{ width: `${pct}%`, background: r.color ?? "var(--accent-sky)" }}
                  />
                  <span className="relative z-10 min-w-0 truncate">{r.label}</span>
                  <span className="nums relative z-10 shrink-0 font-medium tabular-nums">
                    {r.value.toLocaleString("tr-TR")}
                  </span>
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
