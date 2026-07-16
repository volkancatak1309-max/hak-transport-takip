"use client";

import { cn } from "@/lib/utils";

/**
 * Reveal alt-sekme şeridi klonu (REVEAL-CLONE-SPEC A1). Sola hizalı sekmeler,
 * aktifte alt 2px bordo çizgi + font-semibold; altında tam-genişlik ayraç.
 * Reveal'ın kırmızısı → bizde --accent-claret.
 */
export type SubTab = { key: string; label: string; badge?: number };

export function SubTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: SubTab[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border", className)}>
      <div role="tablist" className="-mb-px flex items-center gap-7">
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => onChange(t.key)}
              className={cn(
                "relative inline-flex items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm transition-colors",
                active
                  ? "border-accent-claret font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="nums rounded-full bg-status-critical-fill px-1.5 text-[10px] font-medium text-white">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
