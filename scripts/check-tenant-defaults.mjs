#!/usr/bin/env node
/**
 * DEĞİŞMEZLİK MUHAFIZI — "env'siz build = bugünkü HAK61 davranışı".
 *
 * 31.07.2026'da çok-müşteri katmanı eklendi: 30'a yakın davranış sabiti düz
 * metinden env'e taşındı. Taşınırken DEĞERİN değil yalnız KAYNAĞIN değişmesi
 * gerekiyordu. Bu betik onu denetler.
 *
 * NASIL: aşağıdaki tablo, taşınmadan ÖNCEKİ değerlerin kaydıdır — kod
 * okunarak değil, 31.07.2026 öncesi dosyalardan alınarak yazıldı. Betik
 * lib/tenant.ts + lib/brand.ts + lib/report-de.ts modüllerini HİÇBİR env
 * tanımlı DEĞİLKEN yükler ve her alanı bu kayıtla karşılaştırır. Bir varsayılan
 * kayarsa çıkış kodu 1 → `npm run verify` kırılır.
 *
 * NEDEN BİR TEST DEĞİL DE BETİK: projede test koşucusu yok ve bu denetimin
 * `npm run verify` zincirine girmesi gerekiyordu — muhafız betikleri
 * (check-test-filters.mjs) zaten o zincirin parçası ve aynı kalıbı izliyor.
 *
 * ⚠️ BU TABLODAKİ BİR SATIRI DEĞİŞTİRMEK, HAK61'İN CANLI DAVRANIŞINI
 *    DEĞİŞTİRMEK DEMEKTİR. Kayıt "eskiden ne yapıyordu"yu tutar; kodu ona
 *    uydurmak gerekir, tersi değil.
 *
 * Kullanım: node scripts/check-tenant-defaults.mjs
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 31.07.2026 ÖNCESİ DEĞERLER.
 * Her satırın yanında kaynağı: hangi dosyada, hangi düz metin olarak duruyordu.
 */
const EXPECTED = {
  // ── lib/tenant.ts (eski lib/features.ts) ──────────────────────────────────
  "tenant.FUEL_ENABLED": false, //            features.ts: export const FUEL_ENABLED = false
  "tenant.EXPENSE_ENABLED": false, //         features.ts: export const EXPENSE_ENABLED = false
  "tenant.MAINTENANCE_ENABLED": false, //     features.ts: export const MAINTENANCE_ENABLED = false
  "tenant.LEAVES_ENABLED": true, //           features.ts: export const LEAVES_ENABLED = true

  // ── Kurulum modu — hepsi "bugün böyle davranıyordu" ──────────────────────
  "tenant.DRIVER_PANEL_ENABLED": true, //     /panel herkese açıktı
  "tenant.PACKAGES_ENABLED": true, //         paket kolonları her yerde görünürdü
  "tenant.LENKZEIT_WARNING_ENABLED": true, // LenkzeitWarning koşulsuz render ediliyordu
  "tenant.SAFETY_SCORE_CALIBRATED": true, //  metric-thresholds.ts: = true
  "tenant.SHIFT_START_TRIGGER": "depot_entry", // auto-shift.ts: depotArrivalTrigger
  "tenant.SHIFT_AUTO_END": "off", //          auto-shift.ts: AUTO_END_ENABLED = false
  "tenant.SHIFT_AUTO_END_IDLE_MIN": 30, //    auto-shift.ts: DEFAULT_IDLE_END_MINUTES = 30
  "tenant.FLEET_EPOCH_ISO": "2026-06-01T00:00:00.000Z", // analytics.ts: FLEET_EPOCH
  // Araçlar sayfasındaki filo çipleri ve araç formundaki filo seçeneği. HAK61'de
  // İKİSİ DE görünür (migration 023: 9 bordo / 19 mavi) — bu satır kayarsa
  // canlıda bir filo arayüzden kaybolur.
  "tenant.ACTIVE_FLEETS": "bordo,mavi",

  // ── lib/brand.ts ─────────────────────────────────────────────────────────
  "brand.tenant": "hak61",
  "brand.name": "HAK61", //                   layout.tsx appleWebApp.title
  "brand.legalName": "HAK61 GmbH", //         Footer.tsx / DashboardShell.tsx
  "brand.city": "Wien", //                    page.tsx / pin/page.tsx: "HAK61 · Wien"
  "brand.appTitle": "HAK61 — Schicht & KM", // layout.tsx metadata.title
  "brand.description": "Çalışan vardiya ve kilometre takip sistemi",
  "brand.shortName": "HAK61", //              manifest.json short_name
  "brand.themeColor": "#0d0e10", //           manifest.json theme_color
  "brand.backgroundColor": "#0a0b0e", //      manifest.json background_color
  "brand.logo": "/logo.png", //               BrandLogo.tsx src
  "brand.splash": "/splash.webp", //          Splash.tsx src
  "brand.splashWidth": 920,
  "brand.splashHeight": 717,
  // ?v=2 damgası: eski turuncu "HAK Transport" ikonunu cihazlarda geçersiz
  // kılan sürüm. Düşerse kurulu PWA kısayolları eski ikona döner.
  "brand.favicon": "/favicon.ico?v=2",
  "brand.favicon32": "/favicon-32x32.png?v=2",
  "brand.icon192": "/icon-192.png?v=2",
  "brand.icon512": "/icon-512.png?v=2",
  "brand.appleTouch": "/apple-touch-icon.png?v=2",
  "brand.cityLine": "HAK61 · Wien", //        brandCityLine()
  "brand.copyright2026": "© 2026 HAK61 GmbH", // brandCopyright(2026)

  // ── lib/report-de.ts — RESMÎ BELGE ANTETİ ────────────────────────────────
  "company.name": "HAK61 GmbH",
  "company.address": "Josef-Ganahl-Straße 4, 6850 Dornbirn, Österreich",
  "company.regLine": "UID-Nr.: ATU79519228",
  "company.extraLine": "", //                 böyle bir satır YOKTU
  "company.brandMark": "HAK", //              PDF amblem kutusu
  "company.logoRatio": 915 / 300, //          BrandLogo.tsx: height * (915/300)
  // İndirilen PDF dosya adlarının öneki. 31.07.2026 öncesi ALTI çağrı yerinde
  // düz metin yazılıydı: `HAK_AZG_…` · `HAK_CO2_…` · `hak-kraftstoff-…` ·
  // `hak-fahrerleistung-…` · `hak-report-…` · `hak-<isim>-…`. Artık amblemden
  // türetiliyor; bu iki satır HAK61'de adların DEĞİŞMEDİĞİNİ denetler.
  "company.filePrefixUpper": "HAK",
  "company.filePrefixLower": "hak",
};

/**
 * Modülleri env'SİZ yükleyip değerleri toplayan geçici betik.
 *
 * Ayrı bir süreçte çalışır ve o sürecin ortamı BOŞALTILIR: bu betiği çalıştıran
 * geliştiricinin .env.local'i (ör. NEXT_PUBLIC_TENANT=sendigo denemesi) sonucu
 * kirletmemeli. Denetimin sorusu "env yokken ne oluyor" — o yüzden env yok.
 *
 * TypeScript modülleri doğrudan içe aktarılamadığı için Node'un yerleşik tip
 * soyma desteğiyle (--experimental-strip-types, Node 22.6+) yüklenir.
 */
const PROBE = `
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

// "@/lib/format" gibi tsconfig yol takma adlarını çözer. Next derleyicisi bunu
// kendisi yapıyor; ham Node yapmıyor ve lib/report-de.ts o takma adla
// lib/format'ı içe aktarıyor. Uzantı da eklenir (.ts / .tsx).
const ROOT = process.argv[5];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = join(ROOT, specifier.slice(2));
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const load = async (p) => import(pathToFileURL(p).href);
const tenant = await load(process.argv[2]);
const brand = await load(process.argv[3]);
const report = await load(process.argv[4]);
const out = {
  "tenant.FUEL_ENABLED": tenant.FUEL_ENABLED,
  "tenant.EXPENSE_ENABLED": tenant.EXPENSE_ENABLED,
  "tenant.MAINTENANCE_ENABLED": tenant.MAINTENANCE_ENABLED,
  "tenant.LEAVES_ENABLED": tenant.LEAVES_ENABLED,
  "tenant.DRIVER_PANEL_ENABLED": tenant.DRIVER_PANEL_ENABLED,
  "tenant.PACKAGES_ENABLED": tenant.PACKAGES_ENABLED,
  "tenant.LENKZEIT_WARNING_ENABLED": tenant.LENKZEIT_WARNING_ENABLED,
  "tenant.SAFETY_SCORE_CALIBRATED": tenant.SAFETY_SCORE_CALIBRATED,
  "tenant.SHIFT_START_TRIGGER": tenant.SHIFT_START_TRIGGER,
  "tenant.SHIFT_AUTO_END": tenant.SHIFT_AUTO_END,
  "tenant.SHIFT_AUTO_END_IDLE_MIN": tenant.SHIFT_AUTO_END_IDLE_MIN,
  "tenant.FLEET_EPOCH_ISO": tenant.FLEET_EPOCH_ISO,
  "tenant.ACTIVE_FLEETS": tenant.ACTIVE_FLEETS.join(","),
  "brand.tenant": brand.BRAND.tenant,
  "brand.name": brand.BRAND.name,
  "brand.legalName": brand.BRAND.legalName,
  "brand.city": brand.BRAND.city,
  "brand.appTitle": brand.BRAND.appTitle,
  "brand.description": brand.BRAND.description,
  "brand.shortName": brand.BRAND.shortName,
  "brand.themeColor": brand.BRAND.themeColor,
  "brand.backgroundColor": brand.BRAND.backgroundColor,
  "brand.logo": brand.BRAND.assets.logo,
  "brand.splash": brand.BRAND.assets.splash,
  "brand.splashWidth": brand.BRAND.assets.splashWidth,
  "brand.splashHeight": brand.BRAND.assets.splashHeight,
  "brand.favicon": brand.BRAND.assets.favicon,
  "brand.favicon32": brand.BRAND.assets.favicon32,
  "brand.icon192": brand.BRAND.assets.icon192,
  "brand.icon512": brand.BRAND.assets.icon512,
  "brand.appleTouch": brand.BRAND.assets.appleTouch,
  "brand.cityLine": brand.brandCityLine(),
  "brand.copyright2026": brand.brandCopyright(2026),
  "company.name": report.COMPANY.name,
  "company.address": report.COMPANY.address,
  "company.regLine": report.COMPANY_UID_LINE,
  "company.extraLine": report.COMPANY_EXTRA_LINE,
  "company.brandMark": report.BRAND_MARK,
  "company.logoRatio": brand.BRAND.logoRatio,
  "company.filePrefixUpper": report.FILE_PREFIX_UPPER,
  "company.filePrefixLower": report.FILE_PREFIX_LOWER,
};
process.stdout.write(JSON.stringify(out));
`;

// lib/report-de.ts "server-only" içe aktarmıyor ama lib/brand.ts ve
// lib/tenant.ts de aktarmıyor — üçü de saf modül, bu yüzden doğrudan
// yüklenebiliyorlar. (Yüklenemeselerdi bu denetim de yazılamazdı; saf
// tutulmaları bilinçli bir tasarım kararı.)
const dir = mkdtempSync(join(tmpdir(), "tenant-defaults-"));
const probePath = join(dir, "probe.mjs");
writeFileSync(probePath, PROBE);

// Ortamı boşalt; Node'un çalışması için gereken minimum dışında env yok.
const cleanEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  NODE_OPTIONS: "",
};

const res = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--no-warnings",
    probePath,
    join(ROOT, "lib", "tenant.ts"),
    join(ROOT, "lib", "brand.ts"),
    join(ROOT, "lib", "report-de.ts"),
    ROOT,
  ],
  { encoding: "utf8", env: cleanEnv }
);
rmSync(dir, { recursive: true, force: true });

if (res.status !== 0) {
  console.error("✗ Varsayılanlar okunamadı:\n" + (res.stderr || res.stdout));
  process.exit(1);
}

let actual;
try {
  actual = JSON.parse(res.stdout);
} catch {
  console.error("✗ Beklenmeyen çıktı:\n" + res.stdout);
  process.exit(1);
}

let fail = 0;
for (const [key, want] of Object.entries(EXPECTED)) {
  const got = actual[key];
  const ok =
    typeof want === "number" && typeof got === "number"
      ? Math.abs(want - got) < 1e-9
      : got === want;
  if (!ok) {
    fail++;
    console.error(
      `✗ ${key}\n    beklenen (31.07.2026 öncesi): ${JSON.stringify(want)}\n    bulunan  (env'siz)          : ${JSON.stringify(got)}`
    );
  }
}

const total = Object.keys(EXPECTED).length;
if (fail > 0) {
  console.error(
    `\n${fail}/${total} varsayılan KAYMIŞ. Env tanımlı olmadığında uygulama artık ` +
      "HAK61'in bugünkü davranışını üretmiyor.\n" +
      "Kodu kayda uydurun; kaydı koda değil."
  );
  process.exit(1);
}

console.log(`✓ ${total} varsayılan da 31.07.2026 öncesi değerlerle birebir.`);
