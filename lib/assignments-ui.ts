import type { AssignmentStatus, AssignmentStop } from "@/lib/types";

// Left status stripe (3px border) — admin cards, panel cards, calendar.
// No green/red: assigned=gold(waiting), started=sky(active), completed=neutral,
// cancelled=claret.
export const STATUS_STRIPE: Record<AssignmentStatus, string> = {
  assigned: "border-l-accent-gold",
  started: "border-l-accent-sky",
  completed: "border-l-muted-foreground/40",
  cancelled: "border-l-accent-claret",
};

/**
 * StatusChip tonu — yönetici listesinin TEK durum taşıyıcısı (27.07.2026).
 *
 * Yönetici sefer listesinde sol 3px şerit KALDIRILDI: kilitteki kural, tonun
 * satırın kenarında değil kendi rozetinde yaşaması. Şerit `STATUS_STRIPE` olarak
 * duruyor çünkü şoför paneli ve takvim kartları hâlâ kullanıyor — orada satır
 * değil kart var ve kenar şeridi kartın kimliği.
 *
 * Yeşil/kırmızı yok: assigned=bekleyen(gold), started=canlı(sky),
 * completed=nötr, cancelled=bordo.
 */
export const STATUS_TONE: Record<
  AssignmentStatus,
  "warning" | "active" | "neutral" | "break"
> = {
  assigned: "warning",
  started: "active",
  completed: "neutral",
  cancelled: "break",
};

export const STATUS_BADGE: Record<
  AssignmentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  assigned: "secondary",
  started: "default",
  completed: "outline",
  cancelled: "outline",
};

/** "Feldkirch Lager → Salzburg → Linz", truncated to `max` chars. */
export function routeSummary(stops: AssignmentStop[], max = 60): string {
  const joined = (stops ?? []).map((s) => s.address).join(" → ");
  return joined.length > max ? joined.slice(0, max - 1) + "…" : joined;
}

/** Google Maps directions URL to the final stop, opened in a new tab. */
export function directionsUrl(stops: AssignmentStop[]): string {
  const dest = stops.length ? stops[stops.length - 1].address : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
