import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "@/i18n/request";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { Splash } from "@/components/Splash";
import { BRAND } from "@/lib/brand";
import { assertTenantConfig } from "@/lib/tenant";
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
  const messages = (await import(`@/messages/${locale}.json`)).default;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-background text-foreground">
        <Providers>
          <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Vienna">
            <Splash />
            {children}
            <Toaster position="bottom-right" richColors closeButton duration={3000} />
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
