/**
 * Mola kuralları — şoför panelindeki mola sayacının arayüzü.
 *
 * Eşiklerin kendisi lib/azg-rules.ts'te (tüm AZG sabitleriyle birlikte, her
 * biri dayandığı paragrafla); bu dosya yalnız panelin okuduğu ince katman.
 *
 * § 13c Abs. 1 AZG — şoförler için geçerli paragraf budur; rapor 22.07.2026'ya
 * kadar yanlışlıkla genel hüküm olan § 11'i gösteriyordu:
 *   • 6 saati aşan çalışma → en az 30 dakika mola
 *   • 9 saati aşan çalışma → en az 45 dakika mola
 *
 * 22.07.2026'ya kadar hedef SABİT 30 dakikaydı; 45 dakikalık ikinci kademe
 * bilinçli olarak eksik bırakılmıştı. Artık hedef, molanın başladığı andaki
 * çalışılmış süreye göre seçiliyor (breakTargetMin).
 */

export {
  breakTargetMin,
  requiredBreakMin,
  AZG_BREAK_AFTER_6H_MIN,
  AZG_BREAK_AFTER_9H_MIN,
  AZG_BREAK_TIER1_MS,
  AZG_BREAK_TIER2_MS,
} from "@/lib/azg-rules";

import { AZG_BREAK_AFTER_6H_MIN } from "@/lib/azg-rules";

/**
 * Varsayılan hedef (dakika) — 6-9 saat bandındaki vardiyalar için.
 *
 * SABİT DEĞİL, VARSAYILAN: çalışılan süreyi bilen her yerde bunun yerine
 * `breakTargetMin(workedMs)` çağırın; 9 saati aşan vardiyada o 45 döner.
 */
export const BREAK_TARGET_MIN = AZG_BREAK_AFTER_6H_MIN;

/** Aynı varsayılan milisaniye cinsinden. */
export const BREAK_TARGET_MS = BREAK_TARGET_MIN * 60_000;
