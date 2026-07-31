import type { VehicleLiveStatus, VehicleBaseStatus, VehicleFleet } from "@/lib/types";
import { FLEET_LABELS } from "@/lib/tenant";

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

/**
 * ÇİP METNİ DOLGU TOKEN'I DEĞİL, `*-text` TÜREVİ KULLANIR (DESIGN.md §2.4).
 *
 * Saf --accent-gold / --accent-sky / --accent-claret, kendi %15 tinti üstünde
 * 11-13px çip metni olarak AA'yı geçmiyor (açık temada "Boşta" 2.34:1 ölçüldü,
 * 26.07.2026). Dolgu tonu ile metin tonu aynı değildir; FLEET_STYLE zaten bu
 * ayrımı yapıyordu, durum çipleri geride kalmıştı. Nokta/şerit dolgu tonunda
 * KALIR — onlar metin değil.
 */
export const STATUS_STYLE: Record<VehicleLiveStatus, StatusStyle> = {
  sevkiyatta: {
    labelKey: "sevkiyatta",
    chip: "bg-accent-sky/15 text-accent-sky-text",
    stripe: "border-l-accent-sky",
    dot: "bg-accent-sky",
    live: true,
  },
  molada: {
    labelKey: "molada",
    chip: "bg-accent-claret/15 text-accent-claret-text",
    stripe: "border-l-accent-claret",
    dot: "bg-accent-claret",
    live: true,
  },
  bosta: {
    labelKey: "bosta",
    chip: "bg-accent-gold/15 text-accent-gold-text",
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

export type FleetStyle = {
  /** chip: bg + text — text uses the theme-aware token so dark mode keeps contrast */
  chip: string;
  /** plain text color (icon accents) */
  text: string;
  /** solid fill for the map-legend swatch (bg-*) */
  dot: string;
};

/** Fleet identity colors (migration 023): bordo filo = claret, mavi filo = sky.
 *  Single source of truth — the map legend, list badges and panel chips all
 *  derive from here; never inline the accent vars for fleet identity. */
export const FLEET_STYLE: Record<VehicleFleet, FleetStyle> = {
  bordo: {
    chip: "bg-accent-claret/15 text-accent-claret-text",
    text: "text-accent-claret-text",
    dot: "bg-accent-claret",
  },
  mavi: {
    // Saf --accent-sky metin olarak 10-12px'te AA'yı geçmiyor (açıkta 3.6:1);
    // metin rolü için okunur türev token kullanılır — bordo'daki desenin aynısı.
    chip: "bg-accent-sky/15 text-accent-sky-text",
    text: "text-accent-sky-text",
    dot: "bg-accent-sky",
  },
};

/**
 * FİLO ETİKETİ — kullanıcıya gösterilen metin.
 *
 * DB'deki kod adları (`bordo` / `mavi`) ve yukarıdaki FLEET_STYLE müşteriye
 * göre DEĞİŞMEZ: migration 023/029'daki CHECK kısıtı bu iki değeri bekliyor ve
 * renk kimliği tasarım kararıdır. Değişen yalnız ETİKETTİR — dört araçlık tek
 * filolu bir müşteride "Bordo Filo / Mavi Filo" ayrımı anlamsızdır.
 *
 * Env tanımlı değilse i18n sözlüğündeki bugünkü karşılık kullanılır, yani
 * HAK61'de hiçbir şey değişmez.
 */
export function fleetLabel(
  fleet: string,
  t: (key: string) => string
): string {
  return FLEET_LABELS[fleet] || t(`fleet.${fleet}`);
}
