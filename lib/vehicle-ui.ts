import type { VehicleLiveStatus, VehicleBaseStatus } from "@/lib/types";

/**
 * Live operational status from shift/break/base data. NO green/red:
 *   sevkiyatta (active driving) = sky · molada (on break) = claret ·
 *   bosta (idle/depot) = gold · bakimda (maintenance/inactive) = neutral gray.
 */
export function computeLiveStatus(input: {
  baseStatus: VehicleBaseStatus;
  hasActiveShift: boolean;
  onBreak: boolean;
}): VehicleLiveStatus {
  if (input.baseStatus === "maintenance" || input.baseStatus === "inactive") {
    return "bakimda";
  }
  if (!input.hasActiveShift) return "bosta";
  return input.onBreak ? "molada" : "sevkiyatta";
}

export type StatusStyle = {
  /** next-intl key under "vehicles.status". */
  labelKey: VehicleLiveStatus;
  /** chip: bg + text */
  chip: string;
  /** left border stripe (table/cards) */
  stripe: string;
  /** dot color (bg-*) */
  dot: string;
  /** show the animated live dot (only for truly live states) */
  live: boolean;
};

export const STATUS_STYLE: Record<VehicleLiveStatus, StatusStyle> = {
  sevkiyatta: {
    labelKey: "sevkiyatta",
    chip: "bg-accent-sky/15 text-accent-sky",
    stripe: "border-l-accent-sky",
    dot: "bg-accent-sky",
    live: true,
  },
  molada: {
    labelKey: "molada",
    chip: "bg-accent-claret/15 text-accent-claret",
    stripe: "border-l-accent-claret",
    dot: "bg-accent-claret",
    live: true,
  },
  bosta: {
    labelKey: "bosta",
    chip: "bg-accent-gold/15 text-accent-gold",
    stripe: "border-l-accent-gold",
    dot: "bg-accent-gold",
    live: false,
  },
  bakimda: {
    labelKey: "bakimda",
    chip: "bg-muted text-muted-foreground",
    stripe: "border-l-muted-foreground/40",
    dot: "bg-muted-foreground",
    live: false,
  },
};
