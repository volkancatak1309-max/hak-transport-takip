/**
 * YAKIT DENGESİ — tek kaynak.
 *
 * `report_fuel_stats*` RPC'leri seviye yüzdesini (`first_pct`, `last_pct`) ve
 * dolum toplamını (`refill_pct`) döndürür; "ne kadar yakıldı" bu üçünden
 * TÜRETİLİR ve formülün iki okuyucusu var: yakıt raporu (lib/reports.ts) ve
 * mobil vardiya detayı (app/api/mobile/shifts/[id]). Formül iki yerde
 * yazılsaydı biri düzeltildiğinde diğeri sessizce eski hâlde kalırdı.
 *
 * Kimlik: yakılan = alınan (dolum) + net düşüş (ilk − son).
 * Küçük sensör gürültüsünde negatife düşerse 0'a kırpılır (net "dolu bitti").
 */
export function fuelConsumedPct(
  firstPct: number,
  lastPct: number,
  refillPct: number
): number {
  return Math.max(0, refillPct + (firstPct - lastPct));
}

/** Yüzde → litre. Depo hacmi bilinmiyorsa null — UYDURMA litre yok (027). */
export function pctToLiters(pct: number, tankCapacityL: number | null): number | null {
  return tankCapacityL != null ? (pct / 100) * tankCapacityL : null;
}
