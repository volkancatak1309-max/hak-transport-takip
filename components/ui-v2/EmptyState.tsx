import type { LucideIcon } from "lucide-react";
import { Inbox, SearchX, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tek boş-durum kaynağı (DESIGN-SYSTEM §7). Üç tip ayrışır ve boş bölüm
 * dikeyde BÜYÜMEZ — kompakt tek blok (FAZ 0: dört dev boş kutu bulgusu).
 */
export type EmptyKind =
  | "none" //     hiç kayıt yok → onboarding CTA'lı
  | "filtered" // bu filtrede sonuç yok → "Temizle" CTA'lı
  | "no-signal"; // veri/sinyal gelmiyor → teknik ipucu

const DEFAULT_ICON: Record<EmptyKind, LucideIcon> = {
  none: Inbox,
  filtered: SearchX,
  "no-signal": WifiOff,
};

export function EmptyState({
  kind = "none",
  title,
  hint,
  cta,
  icon,
  className,
}: {
  kind?: EmptyKind;
  title: string;
  /** Tek cümle neden — uzun paragraf yasak. */
  hint?: string;
  /** Opsiyonel eylem (buton/link). "filtered" için "Temizle" beklenir. */
  cta?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const Icon = icon ?? DEFAULT_ICON[kind];
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 rounded-[14px] border border-border/60 px-4 py-6 text-center",
        className
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <div className="text-left">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {cta && <div className="ml-2 shrink-0">{cta}</div>}
    </div>
  );
}
