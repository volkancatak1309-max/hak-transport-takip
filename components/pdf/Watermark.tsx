"use client";
import { Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_WATERMARK } from "@/lib/tenant";
import { getWatermarkUser } from "@/lib/pdf-watermark-user";
import { TENANT_TZ } from "@/lib/tz";

/**
 * PDF FİLİGRANI (045) — demo raporlarının dolaşıma girmesini caydırır.
 *
 * `NEXT_PUBLIC_PDF_WATERMARK` boşsa (HAK61 ve Sendigo'nun bugünkü hâli)
 * bileşen `null` döner: mevcut raporlarda TEK PİKSEL değişmez.
 *
 * Metin: "<bayrak> — <kullanıcı> — <tarih saat>". Kullanıcı adının içeride
 * olması bilinçli: sızan bir PDF'in hangi hesaptan çıktığı okunur.
 *
 * ⚠️ Bu bir DRM değil. Filigran caydırıcıdır; kararlı biri PDF'i düzenleyip
 * kaldırabilir. Ekran görüntüsü / sağ tık / DevTools engelleme BİLEREK
 * yapılmadı — çalışmaz ve paneli bozar.
 */
const styles = StyleSheet.create({
  mark: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 34,
    color: "#000000",
    opacity: 0.08,
    // @react-pdf transform'u destekliyor; çapraz yerleşim metni okunur ama
    // içeriğin okunmasını engellemeyecek kadar soluk tutuyor.
    transform: "rotate(-30deg)",
  },
});

export function Watermark({ at }: { at?: Date } = {}) {
  if (!PDF_WATERMARK) return null;
  const user = getWatermarkUser();
  const d = at ?? new Date();
  const damga = d.toLocaleString("de-AT", { timeZone: TENANT_TZ });
  return (
    <Text style={styles.mark} fixed>
      {`${PDF_WATERMARK} — ${user ?? "—"} — ${damga}`}
    </Text>
  );
}
