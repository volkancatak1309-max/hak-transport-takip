"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aktif filtre çipleri (REVEAL-GAP §3.2 — Dub analytics eb41f99a deseni).
 * "Tag is refero ×" gibi kaldırılabilir çipler + "Temizle". Boş = çip yok;
 * "Tümü" kavramı çipin YOKLUĞUYLA ifade edilir (Volkan hata #1). Dropdown'da
 * saklı "Şiddet/Olay tipi" placeholder'ı yerine aktif filtre daima görünür.
 */
export type ActiveChip = {
  key: string;
  /** "Araç" gibi filtre ekseni etiketi. */
  label: string;
  /** "AB-100XY" gibi seçili değer. */
  value: string;
  onRemove: () => void;
};

export function FilterChips({
  chips,
  onClearAll,
  clearLabel = "Temizle",
  className,
}: {
  chips: ActiveChip[];
  onClearAll: () => void;
  clearLabel?: string;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 py-1 pl-2.5 pr-1 text-xs"
        >
          <span className="text-muted-foreground">{c.label}:</span>
          <span className="font-medium">{c.value}</span>
          <button
            type="button"
            onClick={c.onRemove}
            aria-label={`${c.label} filtresini kaldır`}
            className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
