"use client";
import { Text, StyleSheet } from "@react-pdf/renderer";
import { getPdfFingerprint } from "@/lib/pdf-fingerprint-client";

/**
 * GÖRÜNMEZ PDF PARMAK İZİ (migration 047).
 *
 * Filigran (components/pdf/Watermark.tsx) CAYDIRICIDIR ve görünür — kararlı
 * biri PDF'i düzenleyip siler. Bu işaret onun tamamlayıcısı: GÖRÜNMEZ olduğu
 * için silinmesi akla gelmez, ama metin olarak belgede durur ve `pdftotext`
 * benzeri her araçla okunur.
 *
 * ── NEDEN `opacity: 0`, NEDEN BEYAZ ÜSTÜNE BEYAZ DEĞİL ─────────────────────
 * İkisi de metni içerik akışında bırakır, ama beyaz-üstüne-beyaz KOYU zeminli
 * bir sayfada ortaya çıkar. `opacity: 0` zeminden bağımsız görünmez kalır.
 * ⚠️ İkisi de "şifreleme" değil: belgeyi bir metin ayıklayıcıya veren biri
 * işareti GÖRÜR. Amaç saklamak değil, FARK EDİLMEMEK — silinmesi için önce
 * varlığının bilinmesi gerekiyor.
 *
 * ── KONUM ──────────────────────────────────────────────────────────────────
 * `position: absolute` + `fixed`: her sayfada, düzenin DIŞINDA. Tek bir
 * sayfası kesilip alınan belgede bile iz kalsın diye sayfa sayfa basılıyor —
 * yalnız kapak sayfasında olsaydı ikinci sayfayı paylaşan biri iz bırakmazdı.
 *
 * İşaret yoksa (katman kapalı ya da üretilemedi) bileşen `null` döner:
 * HAK61/Sendigo'nun PDF'lerinde tek bayt değişmez.
 */
const styles = StyleSheet.create({
  mark: {
    position: "absolute",
    bottom: 4,
    left: 6,
    fontSize: 4,
    opacity: 0,
  },
});

export function Fingerprint() {
  const fp = getPdfFingerprint();
  if (!fp) return null;
  return (
    <Text style={styles.mark} fixed>
      {fp}
    </Text>
  );
}

/**
 * İKİNCİ TAŞIYICI — belge künyesi (`/Subject`, `/Keywords`).
 *
 * Metin katmanı ile künye BİRBİRİNDEN BAĞIMSIZ saklanıyor: sayfayı yeniden
 * yazan bir düzenleyici metni düşürebilir ama künyeyi taşır; künyeyi temizleyen
 * bir araç metne dokunmaz. İkisini birden silmek için işaretin VARLIĞINI
 * bilmek gerekir — ki görünmez olmasının tek amacı bu.
 *
 * `<Document {...fingerprintDocProps()}>` biçiminde kullanılır; işaret yoksa
 * boş nesne döner ve Document bugünküyle birebir aynı kalır.
 */
export function fingerprintDocProps(): { subject?: string; keywords?: string } {
  const fp = getPdfFingerprint();
  return fp ? { subject: fp, keywords: fp } : {};
}
