/**
 * MARKA KATMANI — çok-müşteri tek kaynak (31.07.2026).
 *
 * Bu dosyadan ÖNCE marka adı, logo yolu, şehir, sayfa başlığı ve resmî PDF
 * künyesi 14 ayrı dosyada düz metin olarak yazılıydı. İkinci müşteri (Sendigo)
 * kurulumunda hepsinin tek tek aranması gerekti; üçüncüde aynı arama baştan
 * yapılacaktı. Artık tek yer burası.
 *
 * ── DEĞİŞMEZLİK SÖZLEŞMESİ ─────────────────────────────────────────────────
 * Hiçbir env tanımlı DEĞİLKEN bu modülün ürettiği her değer, 31.07.2026
 * öncesindeki HAK61 sabitinin BİREBİR aynısıdır. HAK61 Vercel projesine tek
 * bir env eklenmez ve davranışı değişmez. Bunu `scripts/check-tenant-defaults.mjs`
 * her `npm run verify`'da doğrular — varsayılan kayarsa derleme kırılır.
 *
 * ── GÖRSELLER NEDEN TAŞINMADI ──────────────────────────────────────────────
 * HAK61'in ikon yolları (`/icon-192.png?v=2` …) bugün kurulu PWA'ların ana
 * ekran kısayollarında YAZILI. Dosyaları `public/brands/hak61/` altına taşımak
 * o kısayolların ikonunu kırardı. Bu yüzden hak61 künyesi KÖK yolları, yeni
 * müşteriler `public/brands/<tenant>/` altını kullanır. Kayıt defteri (`REGISTRY`)
 * bu farkı açıkça taşır; "eski müşteri istisnası" gizli bir dal değil, veri.
 *
 * ── SUNUCU / İSTEMCİ ───────────────────────────────────────────────────────
 * Buradaki her şey istemciye de gidebilir, bu yüzden TÜMÜ `NEXT_PUBLIC_`
 * önekiyle okunur (öneksiz env tarayıcıda `undefined`'dır ve marka sessizce
 * varsayılana düşerdi). Resmî PDF künyesi ise SUNUCU tarafıdır ve öneksiz
 * okunur — bkz. `lib/report-de.ts`.
 */

/** Bilinen müşteri kodu. Yeni müşteri = REGISTRY'ye bir satır. */
export const TENANT: string = process.env.NEXT_PUBLIC_TENANT?.trim() || "hak61";

type BrandAssets = {
  /** Wordmark/amblem — giriş ekranı, üst çubuk, PDF anteti. */
  logo: string;
  /** Açılış animasyonu görseli. */
  splash: string;
  /** Splash görselinin doğal boyutu (next/image için zorunlu). */
  splashWidth: number;
  splashHeight: number;
  favicon: string;
  favicon32: string;
  icon192: string;
  icon512: string;
  appleTouch: string;
};

type BrandDescriptor = {
  /** Kısa ad — başlıklar ve bildirim başlığı. */
  name: string;
  /** Tam ticari unvan — footer telif satırı. */
  legalName: string;
  /** Giriş ekranı alt satırı ("<marka> · <şehir>"). */
  city: string;
  /** Tarayıcı sekmesi + PWA adı. */
  appTitle: string;
  /** PWA açıklaması (manifest + metadata). */
  description: string;
  /** manifest.json short_name. */
  shortName: string;
  /**
   * Logonun en/boy oranı. HAK61 geniş (915/300 ≈ 3.05), Sendigo kare (1320/1290
   * ≈ 1.02). `BrandLogo` yüksekliği alır, genişliği bu orandan hesaplar.
   */
  logoRatio: number;
  /** PWA tema/arka plan rengi (manifest). */
  themeColor: string;
  backgroundColor: string;
  assets: BrandAssets;
};

/**
 * HAK61 — 31.07.2026 öncesi düz metin değerlerin BİREBİR kopyası.
 * Buradaki hiçbir dize "temizlenmez", "güncellenmez" ya da biçimi değiştirilmez;
 * bu künye bir varsayılan değil, mevcut davranışın kaydıdır.
 */
const HAK61: BrandDescriptor = {
  name: "HAK61",
  legalName: "HAK61 GmbH",
  city: "Wien",
  appTitle: "HAK61 — Schicht & KM",
  description: "Çalışan vardiya ve kilometre takip sistemi",
  shortName: "HAK61",
  logoRatio: 915 / 300,
  themeColor: "#0d0e10",
  backgroundColor: "#0a0b0e",
  assets: {
    logo: "/logo.png",
    splash: "/splash.webp",
    splashWidth: 920,
    splashHeight: 717,
    // ?v=2, 2026 başındaki turuncu "HAK Transport" ikonunu cihazlarda
    // geçersiz kılan sürüm damgasıdır — düşürülemez.
    favicon: "/favicon.ico?v=2",
    favicon32: "/favicon-32x32.png?v=2",
    icon192: "/icon-192.png?v=2",
    icon512: "/icon-512.png?v=2",
    appleTouch: "/apple-touch-icon.png?v=2",
  },
};

/** Sendigo GmbH — ilaç lojistiği, Dornbirn. Kare logo, koyu yeşil amblem. */
const SENDIGO: BrandDescriptor = {
  name: "SENDIGO",
  legalName: "Sendigo GmbH",
  city: "Dornbirn",
  appTitle: "Sendigo — Fuhrpark",
  description: "Fahrzeug- und Schichtverfolgung",
  shortName: "Sendigo",
  logoRatio: 1320 / 1290,
  themeColor: "#0d0e10",
  backgroundColor: "#0a0b0e",
  assets: {
    logo: "/brands/sendigo/logo.png",
    splash: "/brands/sendigo/splash.png",
    splashWidth: 920,
    splashHeight: 899,
    favicon: "/brands/sendigo/favicon.ico",
    favicon32: "/brands/sendigo/favicon-32x32.png",
    icon192: "/brands/sendigo/icon-192.png",
    icon512: "/brands/sendigo/icon-512.png",
    appleTouch: "/brands/sendigo/apple-touch-icon.png",
  },
};

/**
 * Galzura Fleet — SATIŞ DEMOSU ortamı (07.08.2026), gerçek bir müşteri değil.
 *
 * Künyeye alınmasının tek sebebi GÖRSEL ÖLÇÜLERDİR. Yedek künye
 * (`fallbackDescriptor`) splash'i 920×920 varsayar; gerçek lockup 920×569 ve
 * `next/image` yanlış oranla yer ayırdığı için açılış ekranında dikey boşluk
 * kalıyordu. Ölçüler `npm run brand:assets -- galzura-demo` çıktısından alındı:
 *   logo-source 1600×989 → oran 1.6178 · splash 920×569
 *
 * İkonlar ayrı bir kare işaretten (`icon-source.png`) üretilir — geniş lockup
 * 192 px'lik ikonda okunmuyordu (bkz. scripts/gen-brand-assets.mjs).
 *
 * Metin alanları env ile zaten eziliyor (docs/GALZURA-KURULUM.md §3); buradaki
 * değerler env unutulursa devreye giren makul karşılıklardır.
 */
const GALZURA_DEMO: BrandDescriptor = {
  name: "Galzura Fleet",
  legalName: "Galzura Fleet",
  city: "Wien",
  appTitle: "Galzura Fleet",
  description: "Fuhrpark- und Schichtverfolgung",
  shortName: "Galzura",
  logoRatio: 1600 / 989,
  themeColor: HAK61.themeColor,
  backgroundColor: HAK61.backgroundColor,
  assets: {
    logo: "/brands/galzura-demo/logo.png",
    splash: "/brands/galzura-demo/splash.png",
    splashWidth: 920,
    splashHeight: 569,
    favicon: "/brands/galzura-demo/favicon.ico",
    favicon32: "/brands/galzura-demo/favicon-32x32.png",
    icon192: "/brands/galzura-demo/icon-192.png",
    icon512: "/brands/galzura-demo/icon-512.png",
    appleTouch: "/brands/galzura-demo/apple-touch-icon.png",
  },
};

const REGISTRY: Record<string, BrandDescriptor> = {
  hak61: HAK61,
  sendigo: SENDIGO,
  "galzura-demo": GALZURA_DEMO,
};

/**
 * Kayıtsız bir tenant kodu için künye: tüm görseller `public/brands/<tenant>/`
 * altında beklenir, metinler env'den gelmek ZORUNDADIR. Böylece üçüncü müşteri
 * bu dosyaya dokunmadan da kurulabilir (env + görsel klasörü yeter).
 */
function fallbackDescriptor(tenant: string): BrandDescriptor {
  const base = `/brands/${tenant}`;
  return {
    name: tenant.toUpperCase(),
    legalName: tenant.toUpperCase(),
    city: "",
    appTitle: tenant.toUpperCase(),
    description: "",
    shortName: tenant.toUpperCase(),
    logoRatio: 1,
    themeColor: HAK61.themeColor,
    backgroundColor: HAK61.backgroundColor,
    assets: {
      logo: `${base}/logo.png`,
      splash: `${base}/splash.png`,
      splashWidth: 920,
      splashHeight: 920,
      favicon: `${base}/favicon.ico`,
      favicon32: `${base}/favicon-32x32.png`,
      icon192: `${base}/icon-192.png`,
      icon512: `${base}/icon-512.png`,
      appleTouch: `${base}/apple-touch-icon.png`,
    },
  };
}

const descriptor: BrandDescriptor = REGISTRY[TENANT] ?? fallbackDescriptor(TENANT);

/** Env varsa onu, yoksa künyedeki değeri döndürür (boş dize = tanımsız sayılır). */
function pick(envValue: string | undefined, fallback: string): string {
  const v = envValue?.trim();
  return v ? v : fallback;
}

function pickNumber(envValue: string | undefined, fallback: number): number {
  const v = Number(envValue?.trim());
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * MARKA — uygulamanın her yerinden okunan tek kaynak.
 *
 * Env her zaman künyeyi EZER: kayıt defterine dokunmadan bir dizeyi
 * değiştirmek (ör. Sendigo'nun unvanı) tek env satırıdır.
 */
export const BRAND = {
  tenant: TENANT,
  name: pick(process.env.NEXT_PUBLIC_BRAND_NAME, descriptor.name),
  legalName: pick(process.env.NEXT_PUBLIC_BRAND_LEGAL_NAME, descriptor.legalName),
  city: pick(process.env.NEXT_PUBLIC_BRAND_CITY, descriptor.city),
  appTitle: pick(process.env.NEXT_PUBLIC_BRAND_APP_TITLE, descriptor.appTitle),
  description: pick(process.env.NEXT_PUBLIC_BRAND_DESCRIPTION, descriptor.description),
  shortName: pick(process.env.NEXT_PUBLIC_BRAND_SHORT_NAME, descriptor.shortName),
  logoRatio: pickNumber(process.env.NEXT_PUBLIC_BRAND_LOGO_RATIO, descriptor.logoRatio),
  themeColor: pick(process.env.NEXT_PUBLIC_BRAND_THEME_COLOR, descriptor.themeColor),
  backgroundColor: pick(
    process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR,
    descriptor.backgroundColor
  ),
  assets: descriptor.assets,
} as const;

/**
 * Giriş / PIN ekranlarının alt satırı. Şehir boşsa yalnız marka adı basılır —
 * ayraç ortada asılı kalmaz.
 */
export function brandCityLine(): string {
  return BRAND.city ? `${BRAND.name} · ${BRAND.city}` : BRAND.name;
}

/** Footer telif satırı: "© 2026 HAK61 GmbH". */
export function brandCopyright(year: number): string {
  return `© ${year} ${BRAND.legalName}`;
}
