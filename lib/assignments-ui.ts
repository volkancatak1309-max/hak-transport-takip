import type { AssignmentStatus, AssignmentStop } from "@/lib/types";

// Left status stripe (3px border) — admin cards, panel cards, calendar.
export const STATUS_STRIPE: Record<AssignmentStatus, string> = {
  assigned: "border-l-muted-foreground/40",
  started: "border-l-primary",
  completed: "border-l-emerald-500",
  cancelled: "border-l-destructive",
};

export const STATUS_BADGE: Record<
  AssignmentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  assigned: "secondary",
  started: "default",
  completed: "outline",
  cancelled: "destructive",
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
