import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { PATH_BASLIGI } from "@/proxy";
import { getLocale } from "@/i18n/request";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { Splash } from "@/components/Splash";
import { BRAND } from "@/lib/brand";
import { assertTenantConfig } from "@/lib/tenant";
import { TENANT_TZ } from "@/lib/tz";
import "./globals.css";

// Kurulum tutarlılık denetimi — modül yüklenirken bir kez. Yanlış env bileşimi
// (şoför paneli yok + otomatik kapanma yok) sessiz veri kaybına dönüşmesin diye
// üretimde değil, ilk render'da patlar. HAK61 varsayılanlarında hiçbir şey atmaz.
assertTenantConfig();

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Marka metinleri ve ikon yolları lib/brand.ts'te (çok-müşteri tek kaynak).
// HAK61 künyesi 31.07.2026 öncesindeki değerlerin birebir kopyasıdır — ikon
// yollarındaki "?v=2" damgası dahil: o damga cihazlarda kurulu PWA
// kısayollarının ikonunu tazeleyen sürümdür, düşürülemez.
export const metadata: Metadata = {
  title: BRAND.appTitle,
  description: BRAND.description,
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: BRAND.name },
  icons: {
    icon: [
      { url: BRAND.assets.favicon, sizes: "any" },
      { url: BRAND.assets.favicon32, type: "image/png", sizes: "32x32" },
      { url: BRAND.assets.icon192, type: "image/png", sizes: "192x192" },
      { url: BRAND.assets.icon512, type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: BRAND.assets.appleTouch, sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e10" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const tumMesajlar = (await import(`@/messages/${locale}.json`)).default;

  /**
   * GİRİŞSİZ SAYFAYA SÖZLÜĞÜN TAMAMI GİTMEZ.
   *
   * `NextIntlClientProvider`a verilen her şey sunucu yükünde istemciye seri
   * hâlde iner. Panelde bu doğru (onlarca istemci bileşeni çeviri okuyor), ama
   * /takip girişsizdir ve ÖLÇÜLDÜ (24.08.2026, üretim derlemesi + curl):
   * sayfa 112 KB geliyordu ve içinde "Bordo Filo"/"Mavi Filo" (FİLO ADLARI),
   * PIN kuralı metinleri ve yönetici etiketleri vardı.
   *
   * Yolu proxy söylüyor (bkz. proxy.ts — matcher yalnız /takip).
   * Başlık yoksa davranış BUGÜNKÜYLE AYNI: tam sözlük. Yani bu daraltma
   * fail-open değil, KAPSAMI DAR bir istisnadır; middleware düşse panel
   * etkilenmez, yalnız takip sayfası eski (sızdıran) hâline döner — o yüzden
   * sızıntı denetimi ayrıca `scripts/check-takip-sizinti.mjs` muhafızındadır.
   */
  const yol = (await headers()).get(PATH_BASLIGI) ?? "";
  const girisSiz = yol.startsWith("/takip");
  const messages = girisSiz
    ? { takip: (tumMesajlar as Record<string, unknown>).takip }
    : tumMesajlar;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      // MÜŞTERİ KİMLİK KANCASI (07.08.2026) — CSS'in tenant'a göre token
      // ezebilmesi için. HAK61'de değer "hak61"dir ve globals.css'te o koda ait
      // hiçbir kural YOKTUR, yani öznitelik eklenmesi görünümü değiştirmez.
      data-tenant={BRAND.tenant}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          SPLASH KARARI — BOYAMADAN ÖNCE (09.08.2026). Bu betik <head>'de
          SENKRON çalışır, yani <body> hiç boyanmadan önce `data-splash`
          konur/konmaz. Splash katmanı SSR markup'ında zaten var; görünürlüğü
          globals.css'teki tek kural belirliyor. Effect'e bırakıldığında ekran
          üç kez değişiyordu: giriş formu → splash → giriş formu.

          `dangerouslySetInnerHTML` burada zorunlu: <script> içeriği ancak böyle
          satır içi gömülür ve harici bir dosya beklemeden çalışır — beklemek
          zaten kaçınmaya çalıştığımız boyamayı geri getirirdi. İçerik sabit bir
          dize, hiçbir kullanıcı/env girdisi enterpole edilmiyor.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!sessionStorage.getItem('hak_splash_shown')){sessionStorage.setItem('hak_splash_shown','1');document.documentElement.setAttribute('data-splash','1')}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <Providers>
          <NextIntlClientProvider locale={locale} messages={messages} timeZone={TENANT_TZ}>
            <Splash />
            {children}
            <Toaster position="bottom-right" richColors closeButton duration={3000} />
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
