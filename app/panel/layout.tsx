/**
 * ŞOFÖR PANELİ KABUĞU — cam için HAFİF VARYANT (DESIGN.md §3.3).
 *
 * `.driver-surface` sınıfı yalnız bir şey yapar: bu ağacın altındaki cam
 * yüzeylerden `backdrop-filter`'ı kaldırır. Cam dili kalkmaz — üç katmanlı
 * ışık, yüzey tonu ve yarıçap aynen sürer; yalnız GPU'yu yakan bulanıklık
 * gider.
 *
 * Gerekçe saha koşulu: panel kamyonette, çoğu şoförde 5 yıllık Android.
 * O cihazlarda `backdrop-filter` kaydırmayı takıyor ve vardiya kapatma gibi
 * kritik akışı yavaşlatıyor. Yönetici paneli masaüstünde kaldığı için tam
 * cam kullanmaya devam eder.
 */
export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="driver-surface contents">{children}</div>;
}
