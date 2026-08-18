import { Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_WATERMARK } from "@/lib/tenant";

/**
 * FİLİGRAN + PARMAK İZİ — SUNUCU İKİZLERİ. Değerler PROP, global DEĞİL.
 *
 * ═══ NEDEN AYRI DOSYA — MODÜL GLOBALİ SUNUCUDA GÜVENLİ DEĞİL ═══
 *
 * `components/pdf/Watermark.tsx` adı `lib/pdf-watermark-user.ts`teki bir MODÜL
 * DEĞİŞKENİNDEN okuyor; `components/pdf/Fingerprint.tsx` de işareti
 * `lib/pdf-fingerprint-client.ts`teki modül değişkeninden alıyor. İkisi de
 * TARAYICIDA doğru: her sekme kendi süreci, değer o kullanıcıya ait.
 *
 * SUNUCUDA AYNI DESEN BİR SIZINTIDIR. Modül durumu lambda ÖRNEĞİ başına
 * yaşar ve Vercel Fluid Compute aynı örneği EŞZAMANLI isteklerde yeniden
 * kullanır. İki yönetici aynı anda rapor indirdiğinde sıra şu olabilir:
 *     A: global = "Ali"   →  B: global = "Berk"  →  A render eder
 * ve A'nın belgesine B'nin adı basılır. Belge kim indirdi diye sorulduğunda
 * YANLIŞ İNSANI gösterir — filigranın var olma sebebinin tam tersi. Race
 * penceresi dar olduğu için hata seyrek, sessiz ve tam da güvenilmesi gereken
 * yerde çıkar.
 *
 * Bu yüzden sunucu yolunda global HİÇ OKUNMAZ: her iki değer de zorunlu
 * proptur. Tip sistemi bunu zorlar — bir çağıran unutursa derleme düşer.
 *
 * ── PANEL DOSYALARINA DOKUNULMADI ─────────────────────────────────────────
 * `Watermark.tsx` / `Fingerprint.tsx` / iki `*-client.ts` AYNEN duruyor. Panel
 * PDF'i bugünkü yolundan üretmeye devam ediyor; iki yol yan yana yaşıyor.
 * Ortak bir dosyaya indirmek panelin `"use client"` sınırını değiştirmek
 * demekti (sunucu modülü `"use client"` bir modülden bileşen fonksiyonunu
 * DEĞİL, istemci referansını alır) — canlı bir yüzeyi bu tur için riske atmaya
 * değmez. ⚠️ BEDELİ: stiller iki yerde ve zamanla AYRIŞABİLİR. Panelin de
 * sunucu yoluna geçtiği turda bu ikizler silinmeli.
 *
 * ── `at` NEDEN PROP ───────────────────────────────────────────────────────
 * Bileşen içinde `new Date()` çağrılmıyor. İki sebep: (1) tüm belge tek bir
 * "üretim anı" taşımalı, sayfadan sayfaya kaymamalı; (2) React derleyici
 * kuralları (`react-hooks/purity`) bileşen içindeki saf olmayan çağrıyı hata
 * sayıyor ve ESLint tabanını bozardı.
 */

const styles = StyleSheet.create({
  // Panelin Watermark.tsx'iyle BİREBİR aynı değerler — iki yol aynı yüz.
  mark: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 34,
    color: "#000000",
    opacity: 0.08,
    transform: "rotate(-30deg)",
  },
  // Panelin Fingerprint.tsx'iyle BİREBİR aynı: görünmez ama metin katmanında.
  fp: {
    position: "absolute",
    bottom: 4,
    left: 6,
    fontSize: 4,
    opacity: 0,
  },
});

/**
 * Filigran. `PDF_WATERMARK` boşsa (HAK61/Sendigo'nun bugünkü hâli) `null` —
 * üretilen belgede tek bayt değişmez.
 */
export function WatermarkServer({
  kullanici,
  damga,
}: {
  /** Belgeyi İSTEYEN kişinin adı. null → "—" basılır, uydurulmaz. */
  kullanici: string | null;
  /** Önceden biçimlenmiş üretim anı (de-AT, kiracı dilimi). */
  damga: string;
}) {
  if (!PDF_WATERMARK) return null;
  return (
    <Text style={styles.mark} fixed>
      {`${PDF_WATERMARK} — ${kullanici ?? "—"} — ${damga}`}
    </Text>
  );
}

/**
 * Görünmez parmak izi (047). İşaret yoksa `null` — katman kapalıyken belge
 * bugünküyle birebir aynı kalır.
 */
export function FingerprintServer({ isaret }: { isaret: string | null }) {
  if (!isaret) return null;
  return (
    <Text style={styles.fp} fixed>
      {isaret}
    </Text>
  );
}

/**
 * İkinci taşıyıcı: belge künyesi (`/Subject`, `/Keywords`). Metin katmanından
 * BAĞIMSIZ saklanır — birini silen araç ötekini taşır (bkz. Fingerprint.tsx).
 */
export function fingerprintDocPropsServer(
  isaret: string | null
): { subject?: string; keywords?: string } {
  return isaret ? { subject: isaret, keywords: isaret } : {};
}
