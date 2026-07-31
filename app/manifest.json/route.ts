import { BRAND } from "@/lib/brand";

/**
 * PWA manifest'i — ARTIK STATİK DEĞİL (31.07.2026).
 *
 * `public/manifest.json` tek bir markayı taşıyabiliyordu; tek repo + müşteri
 * başına ayrı Vercel projesi mimarisinde manifest de env'den türemeli. Statik
 * dosya silindi ve yerine bu rota kondu — public/ altındaki dosyalar rotaları
 * gölgelediği için ikisi bir arada duramaz.
 *
 * URL BİLEREK `/manifest.json`: Next'in `app/manifest.ts` kuralı
 * `/manifest.webmanifest` üretir ve HAK61'de kurulu PWA'ların kayıtlı manifest
 * adresi `/manifest.json`'dır. Klasör adı rotayı belirlediği için adres
 * korunuyor; kurulu uygulamalar için hiçbir şey değişmiyor.
 *
 * hak61 künyesiyle üretilen çıktı, silinen dosyanın alan-alan aynısıdır
 * (ikonlardaki "?v=2" damgası dahil).
 */
export const dynamic = "force-static";

export function GET() {
  const body = {
    name: BRAND.appTitle,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: BRAND.backgroundColor,
    theme_color: BRAND.themeColor,
    orientation: "portrait",
    scope: "/",
    icons: [
      { src: BRAND.assets.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND.assets.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: BRAND.assets.icon192, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: BRAND.assets.icon512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
