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
