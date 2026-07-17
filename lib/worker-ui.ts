/**
 * Şoför profil alanlarının (migration 025) UI türetmeleri — şu an tek tüketici
 * ehliyet uyarısı. Rozet sınıfları FleetDtcCard'daki kritik-rozet desenini
 * birebir izler: kritik durum --status-critical ailesi (destructive DEĞİL —
 * DESIGN-SYSTEM §2.3, rozet zemininde 6.06:1), yaklaşan uyarı accent-gold.
 */

/** license_expiry bu kadar gün içindeyse "yaklaşıyor" uyarısı gösterilir. */
export const LICENSE_WARN_DAYS = 60;

export type LicenseState =
  | { state: "expired"; days: number } // kaç gün ÖNCE doldu (pozitif)
  | { state: "expiring"; days: number } // dolmasına kaç gün var
  | null;

/**
 * Ehliyet bitiş durumu: geçmiş → expired, LICENSE_WARN_DAYS içinde → expiring,
 * uzak/boş → null (rozet yok). Gün hesabı takvim-gün yaklaşımı (UTC gece yarısı
 * hassasiyeti bu rozet için yeterli — saatlik kesinlik gerektiren bir SLA yok).
 */
export function licenseState(
  expiry: string | null | undefined,
  nowMs: number = Date.now()
): LicenseState {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.round((t - nowMs) / 86_400_000);
  if (days < 0) return { state: "expired", days: -days };
  if (days <= LICENSE_WARN_DAYS) return { state: "expiring", days };
  return null;
}

/** Rozet bg+text sınıfları — FleetDtcCard kritik-rozet ailesiyle aynı. */
export const LICENSE_BADGE: Record<"expired" | "expiring", string> = {
  expired: "bg-status-critical-soft text-status-critical",
  expiring: "bg-accent-gold/15 text-accent-gold",
};
