import { cn } from "@/lib/utils";

/**
 * Tek rozet kaynağı (DESIGN-SYSTEM §7). Dört lib dosyasına dağılmış el yapımı
 * chip'lerin (status-ui / vehicle-ui / assignments-ui / event-ui) yerini alır;
 * FAZ 4'te sayfalar buna taşınır. Renkler §2.4-2.6 token'ları — ham renk yok.
 */
export type ChipTone =
  | "critical" // çarpma, jamming, panik, aktif arıza
  | "warning" //  aşırı hız, 9s+, bekleyen onay
  | "info" //     canlı/aktif, rutin bilgi vurgusu
  | "neutral" //  rutin olaylar, pasif durumlar
  | "active" //   vardiya: sevkiyatta (sky)
  | "break" //    vardiya: molada (bordo — metin açık ton, §2.3)
  | "idle" //     vardiya: boşta (gold)
  | "maintenance"; // bakımda (nötr)

const TONE: Record<ChipTone, string> = {
  critical: "bg-status-critical-soft text-status-critical-text",
  warning: "bg-accent-gold/15 text-accent-gold-text",
  info: "bg-accent-sky/15 text-accent-sky-text",
  neutral: "bg-muted text-muted-foreground",
  active: "bg-accent-sky/15 text-accent-sky-text",
  break: "bg-accent-claret/20 text-accent-claret-text",
  idle: "bg-accent-gold/15 text-accent-gold-text",
  maintenance: "bg-muted text-muted-foreground",
};

export function StatusChip({
  tone,
  children,
  dot = false,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  /** Sol tarafta durum noktası (canlılık sinyali). */
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  );
}
