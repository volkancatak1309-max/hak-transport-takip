"use client";

import type { CSSProperties } from "react";
import type { LeaveTypeDef } from "@/lib/leave-types";

/**
 * İZİN HÜCRESİ GÖRSELİ — desen + ton (DESIGN.md §2.3/§2.5, 27.07 kararı).
 *
 * Renk ekseni kaldırıldı: filo bordo/mavisi araç kimliğidir, izin türü bir
 * zaman aralığıdır; ikisi aynı palete giremez. Ayrım üç kanaldan gelir:
 *   1. TON    — mercan ailesi (ücretli çekirdek) / nötr gri (diğer)
 *   2. DESEN  — düz / çapraz tarama / nokta / kesikli
 *   3. KOD    — hücredeki `short` (U, K, P, UB…) + tooltip + lejant
 *
 * Blok dili Amie takviminden (`24791745`): yumuşak köşe, soft dolgu, ince
 * renkli sol kenar; ızgara çizgileri neredeyse görünmez, bloklar öne çıkar.
 */

/** Hücrenin dolgu + desen stilini üretir. Hex YOK — hepsi token. */
export function leaveCellStyle(def: LeaveTypeDef, pending: boolean): CSSProperties {
  // Ton token'ı: mercan ailesi ya da nötr. `color-mix` ile soft dolguya iner.
  const base =
    def.tone === "accent" ? "var(--accent-coral)" : "var(--muted-foreground)";
  const fill = `color-mix(in srgb, ${base} ${pending ? 14 : 26}%, transparent)`;
  // MÜREKKEP: ağırlık FOREGROUND'da olmalı. %70 base ile açık temada kod
  // 3.71:1'e düşüyordu (ölçüldü) — soft dolgu zaten aynı hue'da olduğu için
  // renkli mürekkep zeminle yakınlaşıyor. %30 base yalnız hafif bir renk
  // ipucu bırakır, okunurluğu foreground taşır.
  const ink = `color-mix(in srgb, ${base} 30%, var(--foreground))`;

  const common: CSSProperties = {
    // Amie: bloğun solunda ince renkli kenar — türü blok kenarından da okutur.
    borderInlineStart: `2px solid color-mix(in srgb, ${base} ${pending ? 45 : 85}%, transparent)`,
    color: ink,
  };

  switch (def.pattern) {
    case "hatch":
      return {
        ...common,
        // Çapraz tarama: dolgunun üstüne 45° ince şeritler.
        backgroundColor: fill,
        backgroundImage: `repeating-linear-gradient(45deg, color-mix(in srgb, ${base} 30%, transparent) 0 2px, transparent 2px 5px)`,
      };
    case "dots":
      return {
        ...common,
        backgroundColor: fill,
        backgroundImage: `radial-gradient(color-mix(in srgb, ${base} 42%, transparent) 1px, transparent 1.2px)`,
        backgroundSize: "5px 5px",
      };
    case "dashed":
      return {
        ...common,
        // Ücretsiz/uzun süreli: dolgu YOK, kesikli çerçeve — "sayılmayan gün".
        backgroundColor: "transparent",
        outline: `1px dashed color-mix(in srgb, ${base} 55%, transparent)`,
        outlineOffset: "-2px",
      };
    default:
      return { ...common, backgroundColor: fill };
  }
}

/** Lejant/seçici için küçük örnek kare — hücreyle AYNI dili kullanır. */
export function LeaveSwatch({ def }: { def: LeaveTypeDef }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 rounded-[3px]"
      style={leaveCellStyle(def, false)}
    />
  );
}
