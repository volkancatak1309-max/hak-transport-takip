import { NextResponse, type NextRequest } from "next/server";

/**
 * TEK İŞİ VAR: girişsiz takip sayfasının hangi yol olduğunu kök layout'a
 * söylemek.
 *
 * ═══ NEDEN GEREKTİ ═══
 *
 * `app/layout.tsx` i18n sözlüğünün TAMAMINI `NextIntlClientProvider`a veriyor
 * ve o da sunucu yükünde (RSC payload) istemciye seri hâlde gidiyor. Panelde
 * doğru: onlarca istemci bileşeni `useTranslations` çağırıyor.
 *
 * Ama /takip GİRİŞSİZ bir sayfa ve ÖLÇÜLDÜ (24.08.2026, üretim derlemesi +
 * curl): sayfa kaynağı 112 KB geliyordu ve içinde ürünün tüm sözlüğü vardı —
 * "Bordo Filo" / "Mavi Filo" (FİLO ADLARI), PIN kuralı metinleri, flespi
 * alan ipuçları, yönetici ekranlarının etiketleri. Görevin "filo bilgisi
 * GÖRÜNMEZ" kuralı, harfiyen ihlal ediliyordu.
 *
 * ═══ NEDEN MIDDLEWARE, NEDEN AYRI KÖK LAYOUT DEĞİL ═══
 *
 * Next'te bir rotanın kök layout'tan kaçmasının tek yolu ÇOKLU KÖK LAYOUT'tur
 * (route group başına ayrı `<html>`), o da uygulamanın TAMAMINI bir gruba
 * taşımayı gerektirir — /admin, /panel, /erisim, /pin, hata sayfaları.
 * Girişsiz tek bir sayfa için bütün depoyu oynatmak, düzeltmenin kendisinden
 * daha riskli olurdu.
 *
 * Layout ise render sırasında yolu BİLMİYOR (layout'lara pathname geçmez).
 * Bu dosya o boşluğu kapatıyor: yolu bir başlığa yazıyor, layout okuyor.
 *
 * ⚠️ `matcher` YALNIZ /takip. Uygulamanın geri kalanı proxy'den HİÇ
 * geçmiyor — davranış, gecikme ve maliyet olarak sıfır etki.
 */

export const PATH_BASLIGI = "x-hak-path";

export default function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(PATH_BASLIGI, req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/takip/:path*"],
};
