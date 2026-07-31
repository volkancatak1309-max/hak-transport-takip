"use client";

import { Rows2, Rows3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDensity } from "./useDensity";

/**
 * Yoğunluk anahtarı (DESIGN-SYSTEM §6) — DataTable sağ üstünde. Tercih global
 * (useDensity → tek localStorage anahtarı). rahat 48px / sıkı 40px.
 */
export function DensityToggle({ className }: { className?: string }) {
  const [density, setDensity] = useDensity();
  // 31.07.2026: üç etiket düz Türkçe yazılıydı. `title` fareyle üzerine
  // gelindiğinde GÖRÜNÜR bir ipucudur — Almanca kurulumda Türkçe çıkıyordu.
  const t = useTranslations("common");
  return (
    <div
      role="group"
      aria-label={t("density_group")}
      className={cn("inline-flex items-center rounded-[10px] border border-border/60 p-0.5", className)}
    >
      <button
        type="button"
        aria-pressed={density === "comfortable"}
        aria-label={t("density_comfortable")}
        title={t("density_comfortable")}
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
        aria-label={t("density_compact")}
        title={t("density_compact")}
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
