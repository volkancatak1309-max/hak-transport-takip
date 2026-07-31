import { redirect } from "next/navigation";
import { DRIVER_PANEL_ENABLED } from "@/lib/tenant";

/**
 * ŞOFÖR PANELİ KABUĞU — cam için HAFİF VARYANT (DESIGN.md §3.3).
 *
 * Ayrıca /panel ağacının TEK kapısı (31.07.2026): şoför paneli kapalı
 * müşteride (Sendigo) buradan aşağısı hiç render edilmez. Kapıyı beş ayrı
 * page.tsx'e dağıtmak yerine layout'a koymak, ileride eklenecek her alt
 * sayfayı da kendiliğinden kapsar — unutulacak bir yer kalmaz.
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
  if (!DRIVER_PANEL_ENABLED) redirect("/admin");
  return <div className="driver-surface contents">{children}</div>;
}
