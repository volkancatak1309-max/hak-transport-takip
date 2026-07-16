"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Reveal filtre bandı klonu (REVEAL-CLONE-SPEC A3/A5). Hafif tint band +
 * etiketli dropdown'lar tek satırda. Volkan: "basit, tek satır, Reveal
 * neyse o" — çip/breakdown karması yok. Reveal açık grisi → --surface-2.
 */
export type RevealFilter = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  widthClass?: string;
};

export function RevealFilterRow({
  filters,
  right,
  className,
}: {
  filters: RevealFilter[];
  /** Sağa hizalı ek öğe (ör. CSV butonu, sonuç sayacı). */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-4 rounded-[10px] bg-surface-2/60 px-4 py-3",
        className
      )}
    >
      {filters.map((f, i) => (
        <div key={i} className="space-y-1">
          <label className="block text-xs text-muted-foreground">{f.label}</label>
          <Select value={f.value} onValueChange={(v) => v && f.onChange(String(v))}>
            <SelectTrigger className={cn("h-9", f.widthClass ?? "w-[200px]")} aria-label={f.label}>
              <SelectValue>
                {f.options.find((o) => o.value === f.value)?.label ?? f.options[0]?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
