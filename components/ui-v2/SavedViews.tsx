"use client";

import { cn } from "@/lib/utils";

/**
 * KAYITLI GÖRÜNÜMLER — Aboard "Active / My reports / Archived" deseninin
 * (Refero `16e15625`) uyarlaması.
 *
 * Aboard'da bu görünümler sol menüde, her birinin yanında kaç kayıt olduğunu
 * söyleyen bir sayı ile duruyor; KPI şeridi YOK. Biz de öyle yaptık: araç
 * sayfasındaki 4 kutuluk KPI şeridi kaldırıldı ve sayılar buraya, görünüm
 * rozetlerine taşındı (26.07.2026, Volkan onayı). Böylece hem bir blok azaldı
 * hem sayı tıklanabilir hale geldi — "3 arıza var" demek yerine "3 arızalıyı
 * göster" diyor.
 *
 * Sayfa üstünde yatay şerit olarak durur; dar ekranda yatay kayar.
 */
export type SavedView = {
  key: string;
  label: string;
  count: number;
  /** Sayı > 0 iken rozet mercan olur (dikkat çeken görünümler). */
  alert?: boolean;
};

export function SavedViews({
  views,
  active,
  onChange,
  className,
}: {
  views: SavedView[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="views"
      className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5", className)}
    >
      {views.map((v) => {
        const on = v.key === active;
        const alert = v.alert && v.count > 0;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v.key)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px] font-medium",
              "transition-colors duration-150",
              on
                ? "border-transparent bg-accent-coral-soft text-accent-coral-text"
                : "border-border bg-card text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            )}
          >
            {v.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                on
                  // Beyaz-üstü-mercan 11px'te 3.4:1 — AA değil. Aktif rozet
                  // beyaz zemin + koyu mercan metin: hem okunur hem mercan.
                  ? "bg-card text-accent-coral-text"
                  : alert
                    ? "bg-accent-gold text-[#181818]"
                    : "bg-surface-panel text-foreground"
              )}
            >
              {v.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
