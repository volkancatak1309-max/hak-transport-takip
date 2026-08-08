"use client";

import { SECURITY_LAYER_PUBLIC } from "@/lib/tenant";

/**
 * PDF PARMAK İZİ — İSTEMCİ UCU (migration 047).
 *
 * PDF'ler tarayıcıda üretiliyor (@react-pdf/renderer) ve üretim React ağacının
 * DIŞINDA, düz bir fonksiyon çağrısıyla oluyor (`await downloadAZGReport(...)`).
 * Orada hook okunamaz, bu yüzden işaret modül değişkeninde taşınıyor —
 * lib/pdf-watermark-user.ts'in birebir aynı deseni ve aynı gerekçesi.
 *
 * ── DEĞER İSTEMCİDE ÜRETİLMİYOR ────────────────────────────────────────────
 * Burada yalnız TAŞINIYOR. Üretim ve kayıt sunucuda (lib/pdf-fingerprint.ts):
 * istemci ne değeri seçebiliyor ne de kaydı atlayabiliyor. İşareti belgeden
 * silmek mümkün ama indirmenin kaydını silmiyor.
 *
 * ── BAYRAK KAPALIYKEN AĞ İSTEĞİ YOK ────────────────────────────────────────
 * `SECURITY_LAYER_PUBLIC` kapalıyken ilk satırda çıkar ve action modülü
 * dinamik import edildiği için chunk'ı da indirilmez.
 */

let fingerprint: string | null = null;

export function getPdfFingerprint(): string | null {
  return fingerprint;
}

/**
 * Sunucudan yeni bir işaret ister ve bu indirme için saklar.
 *
 * Hata durumunda `null` bırakır: işaretsiz bir PDF, indirmenin hiç
 * gerçekleşmemesinden iyidir — rapor almak izden önce gelir.
 */
export async function mintPdfFingerprint(reportType: string): Promise<void> {
  fingerprint = null;
  if (!SECURITY_LAYER_PUBLIC) return;
  try {
    const m = await import("@/app/actions/audit");
    fingerprint = await m.mintPdfFingerprintAction(reportType);
  } catch {
    /* işaret alınamadı — PDF yine üretilir */
  }
}
