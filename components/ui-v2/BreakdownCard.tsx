"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Dağılım kartı — MISSIVE ÜÇ-KOLON kalıbı (DESIGN.md §0, "Missive Analytics":
 * alt bölümde üç kolonluk döküm; her kolon bir ölçütün kova kova dağılımı).
 *
 * 26.07.2026'da yeniden örüldü. Yapı korundu (sekmeler + sıralı satırlar,
 * satıra tıkla → filtrele), iki şey değişti:
 *   1) Satırlar geniş ekranda ÇOK KOLONA akar (`columns`, varsayılan 3). Tek
 *      uzun liste yerine üç kısa kolon: 12 kovalı bir dağılım tek ekranda okunur.
 *   2) Bar rengi tek aksan mercan; kırpma yerine sarma.
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

const COLUMN_CLASS: Record<1 | 2 | 3, string> = {
  1: "",
  2: "sm:columns-2",
  3: "sm:columns-2 lg:columns-3",
};

export function BreakdownCard({
  title,
  tabs,
  columns = 3,
  emptyLabel = "Veri yok",
  className,
}: {
  title?: string;
  tabs: BreakdownTab[];
  /** Geniş ekranda kaç kolona aksın (Missive kalıbı). Dar ekran daima tek kolon. */
  columns?: 1 | 2 | 3;
  emptyLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  const max = Math.max(1, ...(tab?.rows.map((r) => r.value) ?? [1]));

  return (
    <div className={cn("surface-card flex flex-col rounded-[16px] p-5", className)}>
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
        <ul className={cn("gap-x-6 [column-fill:balance]", COLUMN_CLASS[columns])}>
          {tab.rows.map((r) => {
            const pct = Math.round((r.value / max) * 100);
            const Row = r.onClick ? "button" : "div";
            return (
              // break-inside-avoid: satır iki kolona bölünmesin (çok kolonlu akış).
              <li key={r.key} className="mb-0.5 break-inside-avoid">
                <Row
                  {...(r.onClick ? { type: "button", onClick: r.onClick } : {})}
                  className={cn(
                    "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[8px] px-2.5 py-1.5 text-left text-sm",
                    r.onClick && "transition-colors hover:bg-surface-2",
                    r.active && "bg-surface-2 ring-1 ring-ring/50"
                  )}
                >
                  {/* Hücre-içi bar — Stripe deseni, tek aksan mercan. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-[8px] opacity-[0.16]"
                    style={{ width: `${pct}%`, background: r.color ?? "var(--accent-coral)" }}
                  />
                  {/* Etiket KIRPILMAZ — kova adları ("30dk–2sa") kesilirse kart işlevsiz. */}
                  <span className="relative z-10 min-w-0 flex-1 leading-tight">{r.label}</span>
                  <span className="relative z-10 shrink-0 font-mono font-medium tabular-nums">
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
