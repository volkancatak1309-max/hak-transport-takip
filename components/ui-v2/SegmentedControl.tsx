"use client";

import { cn } from "@/lib/utils";

/**
 * Segmentli seçici (DESIGN-SYSTEM §7 destek bileşeni) — tarih aralığı
 * ön-ayarları ve sayfa sekmeleri (seferler durumu, yakıt/masraf kuyruğu) için.
 * Aktif segment --surface-2 zeminde; opsiyonel sayaç rozeti.
 */
export type SegmentOption = {
  value: string;
  label: string;
  /** Sekme sayacı (ör. bekleyen onay sayısı). */
  count?: number;
};

export function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SegmentOption[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] border border-border/60 p-0.5",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span className="nums rounded-full bg-accent-sky/15 px-1.5 text-[10px] text-accent-sky">
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
