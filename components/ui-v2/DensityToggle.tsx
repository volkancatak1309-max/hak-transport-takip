"use client";

import { Rows2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDensity } from "./useDensity";

/**
 * Yoğunluk anahtarı (DESIGN-SYSTEM §6) — DataTable sağ üstünde. Tercih global
 * (useDensity → tek localStorage anahtarı). rahat 48px / sıkı 40px.
 */
export function DensityToggle({ className }: { className?: string }) {
  const [density, setDensity] = useDensity();
  return (
    <div
      role="group"
      aria-label="Satır yoğunluğu"
      className={cn("inline-flex items-center rounded-[10px] border border-border/60 p-0.5", className)}
    >
      <button
        type="button"
        aria-pressed={density === "comfortable"}
        aria-label="Rahat"
        title="Rahat"
        onClick={() => setDensity("comfortable")}
        className={cn(
          "flex size-7 items-center justify-center rounded-[7px] transition-colors",
          density === "comfortable" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Rows2 aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-pressed={density === "compact"}
        aria-label="Sıkı"
        title="Sıkı"
        onClick={() => setDensity("compact")}
        className={cn(
          "flex size-7 items-center justify-center rounded-[7px] transition-colors",
          density === "compact" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Rows3 aria-hidden className="size-4" />
      </button>
    </div>
  );
}
