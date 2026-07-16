/**
 * Araç olayı (vehicle_events) türü → görsel önem eşlemesi.
 * Kural: çarpma/çekilme kırmızı · sert sürüş turuncu · aşırı hız sarı ·
 * diğerleri (söküm, rölanti, jamming) gri.
 * Kırmızı = destructive, sarı = accent-gold token'ları; tasarım sisteminde
 * turuncu token OLMADIĞI için sert sürüşte Tailwind orange paleti kullanılır.
 */
export type EventSeverity = "red" | "orange" | "yellow" | "gray";

export const EVENT_SEVERITY: Record<string, EventSeverity> = {
  crash: "red",
  towing: "red",
  harsh_acceleration: "orange",
  harsh_braking: "orange",
  harsh_cornering: "orange",
  overspeeding: "yellow",
  unplug: "gray",
  idling: "gray",
  jamming: "gray",
};

/** chip/badge sınıfları — STATUS_STYLE.chip ile aynı bg/15 + text deseni. */
export const EVENT_BADGE: Record<EventSeverity, string> = {
  red: "bg-destructive/15 text-destructive",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  yellow: "bg-accent-gold/15 text-accent-gold",
  gray: "bg-muted text-muted-foreground",
};

/** Liste satırlarındaki yuvarlak ikon zemini için (bg + text). */
export const EVENT_ICON_STYLE: Record<EventSeverity, string> = {
  red: "bg-destructive/10 text-destructive",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  yellow: "bg-accent-gold/10 text-accent-gold",
  gray: "bg-muted text-muted-foreground",
};

export function eventSeverity(type: string): EventSeverity {
  return EVENT_SEVERITY[type] ?? "gray";
}

/* ── UI V2 şiddet eşlemesi (DESIGN-SYSTEM §2.6) ────────────────────────────
   Eski EVENT_SEVERITY'den FARK: jamming (sinyal karıştırma) ve unplug (cihaz
   söküldü) artık KRİTİK — ikisi de hırsızlık/kurcalama sinyali; FAZ 0'da
   "jamming soluk gri" en ciddi bulgulardandı. StatusChip ton'larına eşlenir. */
import type { ChipTone } from "@/components/ui-v2/StatusChip";

export const EVENT_TONE: Record<string, ChipTone> = {
  crash: "critical",
  towing: "critical",
  jamming: "critical",
  unplug: "critical",
  overspeeding: "warning",
  idling: "warning",
  harsh_acceleration: "neutral",
  harsh_braking: "neutral",
  harsh_cornering: "neutral",
};

export function eventTone(type: string): ChipTone {
  return EVENT_TONE[type] ?? "neutral";
}

/** Şiddet ağırlığı — sıralama/özet için (yüksek = daha kritik). */
export const EVENT_TONE_RANK: Record<ChipTone, number> = {
  critical: 3,
  warning: 2,
  neutral: 1,
  info: 1,
  active: 0,
  break: 0,
  idle: 0,
  maintenance: 0,
};

/** Harita/durum şeridi için CSS token değeri. */
export const EVENT_STRIPE: Record<ChipTone, string> = {
  critical: "var(--status-critical)",
  warning: "var(--accent-gold)",
  neutral: "var(--muted-foreground)",
  info: "var(--accent-sky)",
  active: "var(--accent-sky)",
  break: "var(--accent-claret)",
  idle: "var(--accent-gold)",
  maintenance: "var(--muted-foreground)",
};
