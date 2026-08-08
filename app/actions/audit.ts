"use server";

import { getSession } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * İSTEMCİDEN GELEN EYLEM İZİ (045) — PDF ve CSV indirmeleri.
 *
 * ── NEDEN BİR ACTION GEREKİYOR ─────────────────────────────────────────────
 * Raporların hepsi TARAYICIDA üretiliyor (@react-pdf/renderer ve tablodan CSV
 * kurma), yani indirme anında sunucuya giden başka bir istek YOK. Sayfa
 * görüntülemesini sunucu bileşeni yazabiliyor ama "indirdi"yi yazacak tek yer
 * burası. İz olmadan patron ekranı "raporu kim dışa çıkardı" sorusuna cevap
 * veremezdi — demo kurulumunda asıl merak edilen şey tam olarak bu.
 *
 * ── SON SÖZ SUNUCUDA ───────────────────────────────────────────────────────
 * Bu bir action, yani doğrudan çağrılabilir. Bu yüzden:
 *   • katman kapalıysa hiçbir şey yazılmaz (bayrak burada da denetlenir),
 *   • oturumu olmayan çağrı sessizce düşer (kimliksiz satır yazılmaz),
 *   • `target` KISALTILIR ve serbest metin olarak kabul edilmez — istemciden
 *     gelen bir dize doğrudan tabloya sınırsız yazılamaz.
 * Dönüş değeri yok: iz yazımı çağıranı ne bekletir ne düşürür.
 */

/** İzin verilen rapor adları. İstemciden gelen dize BU KÜMEYE eşlenir. */
const PDF_HEDEF = [
  "azg",
  "co2",
  "fuel",
  "performance",
  "shift",
] as const;

const CSV_HEDEF = [
  "shifts",
  "distance",
  "fuel",
  "expenses/payroll",
] as const;

export type PdfTarget = (typeof PDF_HEDEF)[number];
export type CsvTarget = (typeof CSV_HEDEF)[number];

async function yaz(
  action: "export_pdf" | "export_csv",
  target: string,
  izinli: readonly string[],
  meta?: Record<string, unknown>
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;
  // Bilinmeyen hedef → 'other'. Serbest metni tabloya taşımıyoruz.
  const guvenli = izinli.includes(target) ? target : "other";
  try {
    const session = await getSession();
    if (!session.worker_id) return;
    await audit(session.worker_id, action, guvenli, meta);
  } catch {
    /* iz yazılamadı — indirme çağıranda zaten tamamlandı */
  }
}

/** PDF indirildi. `components/pdf/download*` girişlerinden çağrılır. */
export async function logPdfExportAction(target: string): Promise<void> {
  await yaz("export_pdf", target, PDF_HEDEF);
}

/** CSV indirildi. İstemcide tablodan üretilen üç yüzeyden çağrılır. */
export async function logCsvExportAction(target: string): Promise<void> {
  await yaz("export_csv", target, CSV_HEDEF);
}
