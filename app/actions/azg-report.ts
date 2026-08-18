"use server";

import { requireAdmin } from "@/lib/session";
import { buildAZGReport } from "@/lib/azg-report";

/**
 * § 26 AZG RAPORU — PANEL KAPISI.
 *
 * ═══ HESAP BURADAN TAŞINDI (18.08.2026) → lib/azg-report.ts ═══
 *
 * Sebep: mobil rapor ucu (`/api/mobile/reports/azg.pdf`) aynı hesabı çağırmak
 * zorunda ama bir route handler'da ÇEREZ yok — `requireAdmin()` yönlendirme
 * fırlatıyor. Hesabı kopyalamak resmî bir belgede İKİ AYRI DOĞRU üretme riski
 * demekti (§ madde referansları, gece penceresi, mola kademeleri, mikro-vardiya
 * elemesi… hepsi ikiye bölünürdü). Onun yerine hesap tek yere alındı; bu dosya
 * PANELİN kapısı olarak kaldı.
 *
 * DAVRANIŞ DEĞİŞMEDİ: aynı imza, aynı dönüş tipi, aynı `requireAdmin()`.
 * `AZGData` ve kardeş türler aşağıda yeniden dışa veriliyor — bu modülü
 * import eden `components/pdf/AZGReport.tsx` ve `app/admin/AdminClient.tsx`
 * hiç değişmedi.
 */
export type {
  AZGSeverity,
  AZGViolation,
  AZGPerWorker,
  AZGSuspicious,
  AZGData,
  AZGResult,
} from "@/lib/azg-report";

export async function getAZGReportData(
  month: string
): Promise<import("@/lib/azg-report").AZGResult> {
  await requireAdmin();
  return buildAZGReport(month);
}
