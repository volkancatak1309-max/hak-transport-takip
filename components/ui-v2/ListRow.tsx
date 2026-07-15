"use client";

import { cn } from "@/lib/utils";
import { useDensity } from "./useDensity";

/**
 * Kart-satır deseni (DESIGN-SYSTEM §6) — araçlar listesi, harita yan listesi
 * gibi tablo olmayan listeler için. Anatomi: sol 3px durum şeridi · .nums
 * kimlik bloğu · 2 satıra kadar özet · sağda chip + hover'da menü.
 * Yoğunluk: rahat 64px / sıkı 52px. Tıklama = DetailDrawer.
 */
export function ListRow({
  id,
  primary,
  secondary,
  trailing,
  menu,
  stripeColor,
  onClick,
  className,
}: {
  /** .nums kimlik bloğu (plaka vb.) — mono + uppercase çağıran tarafta. */
  id: React.ReactNode;
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  /** Sağ blok: StatusChip / değer. */
  trailing?: React.ReactNode;
  /** Hover'da beliren üç-nokta menü — silme burada yaşar, satırda değil. */
  menu?: React.ReactNode;
  /** CSS değeri (token): "var(--status-idle)" vb. */
  stripeColor?: string | null;
  onClick?: () => void;
  className?: string;
}) {
  const [density] = useDensity();
  return (
    <li
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 px-4",
        density === "compact" ? "min-h-[52px] py-1.5" : "min-h-16 py-2.5",
        onClick &&
          "cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-3",
        className
      )}
    >
      {stripeColor && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
          style={{ background: stripeColor }}
        />
      )}
      <div className="min-w-0 shrink-0">
        <div className="nums text-sm font-medium uppercase tracking-wide">{id}</div>
      </div>
      <div className="min-w-0 flex-1">
        {primary && <div className="truncate text-sm">{primary}</div>}
        {secondary && (
          <div className="truncate text-xs text-muted-foreground">{secondary}</div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
      {menu && (
        <div
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {menu}
        </div>
      )}
    </li>
  );
}
