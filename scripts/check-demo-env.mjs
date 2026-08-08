#!/usr/bin/env node
/**
 * GALZURA DEMO ENV MUHAFIZI — "yazdığım env gerçekten okunuyor mu?"
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * lib/tenant.ts'teki `envEnum`/`envBool`/`envInt` yardımcıları TANIMADIKLARI
 * değeri SESSİZCE varsayılana düşürür (tenant.ts:56-63). Yani:
 *
 *   SHIFT_AUTO_END=depot-idle   (alt tire yerine tire)  →  sessizce 'off'
 *   SHIFT_START_TRIGGER=ignition (eksik ad)             →  sessizce 'depot_entry'
 *   NEXT_PUBLIC_FLEETS=galzura   (tanınmayan filo kodu) →  sessizce ['bordo','mavi']
 *
 * Hiçbiri hata vermez. Uygulama açılır, panel çalışır, yalnız DAVRANIŞ yanlıştır
 * ve bunu ancak günler sonra "vardiyalar niye kapanmıyor" diye fark edersin.
 * Bu betik o sessizliği bozar: env setini uygular, modülleri yükler ve ÇÖZÜLMÜŞ
 * değerleri niyetle karşılaştırır.
 *
 * `scripts/check-tenant-defaults.mjs` ile TERS yönde çalışır ve ikisi birlikte
 * anlamlıdır: o "env YOKKEN HAK61 davranışı korunuyor mu", bu "env VARKEN demo
 * davranışı gerçekten kuruluyor mu" sorusunu sorar.
 *
 * Kullanım:
 *   node scripts/check-demo-env.mjs          → doğrula
 *   node scripts/check-demo-env.mjs --print  → Vercel'e yapıştırılacak env bloğu
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * DEMO ENV SETİ — Vercel'e girilecek olanın TEK KAYNAĞI.
 *
 * Sırlar (Supabase anahtarları, SESSION_PASSWORD, FLESPI_TOKEN,
 * FLESPI_SYNC_SECRET, CRON_SECRET) BURADA TUTULMAZ: davranışı etkilemezler ve
 * repoya sır yazılmaz. Onlar docs'taki kurulum listesinde.
 */
const ENV = {
  // ── Kimlik ────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_TENANT: "galzura-demo",
  NEXT_PUBLIC_BRAND_NAME: "Galzura Fleet",
  NEXT_PUBLIC_BRAND_LEGAL_NAME: "Galzura Fleet",
  NEXT_PUBLIC_BRAND_CITY: "Wien",
  NEXT_PUBLIC_BRAND_APP_TITLE: "Galzura Fleet",
  NEXT_PUBLIC_BRAND_DESCRIPTION: "Fuhrpark- und Schichtverfolgung",
  NEXT_PUBLIC_BRAND_SHORT_NAME: "Galzura",

  // ── Filo: TEK filo, adı "Filo", rengi Galzura yeşili ─────────────────────
  // DB kod adı 'mavi' KALIR (migration 023 CHECK yalnız bordo/mavi kabul eder);
  // değişen yalnız etiket ve — app/globals.css'teki [data-tenant] ezmesiyle —
  // renk. 'galzura' gibi yeni bir kod yazmak sessizce iki filoya geri düşerdi.
  NEXT_PUBLIC_FLEETS: "mavi",
  NEXT_PUBLIC_FLEET_MAVI_LABEL: "Filo",

  // ── Kurulum modu ──────────────────────────────────────────────────────────
  NEXT_PUBLIC_DRIVER_PANEL_ENABLED: "true",
  NEXT_PUBLIC_DRIVER_VEHICLE_CHOICE: "free",
  NEXT_PUBLIC_PACKAGES_ENABLED: "false",

  // ── Vardiya otomatı (Volkan'ın kararı, 07.08.2026) ───────────────────────
  // first_ignition: depo tetiğinin seyrek-fix körlüğünü atlar (auto-shift.ts:358).
  // depot_idle + gerçek geofence: kapanış GÜNDÜZ, depoya dönüşte olur.
  SHIFT_START_TRIGGER: "first_ignition",
  SHIFT_AUTO_END: "depot_idle",
  SHIFT_AUTO_END_IDLE_MIN: "20",
  SHIFT_AUTO_END_MIDNIGHT_FALLBACK: "true",

  // Demo'nun kurulum günü. Varsayılan 2026-06-01 olsaydı "tüm zamanlar"
  // aralığı iki ay boş geçmiş gösterirdi.
  FLEET_EPOCH: "2026-08-07T00:00:00.000Z",

  // ── Güvenlik katmanı (045) — demoda AÇIK ────────────────────────────────
  SECURITY_LAYER_ENABLED: "true",
  // Ana şalterin istemciye görünen aynası. Ayrı bir env olmak ZORUNDA: PDF/CSV
  // tarayıcıda üretiliyor, dolayısıyla "indirdi" izini yazacak çağrı istemciden
  // gidiyor ve sunucu-özel bayrağı okuyamıyor. Bu satır unutulursa dışa aktarma
  // izi SESSİZCE tutulmaz — betiğin bunu denetlemesinin tek sebebi bu.
  NEXT_PUBLIC_SECURITY_LAYER_ENABLED: "true",
  SINGLE_SESSION: "true",
  NEXT_PUBLIC_EXPORT_ENABLED: "false",
  NEXT_PUBLIC_PDF_WATERMARK: "GALZURA DEMO",

  // ── Erişim kapıları (046) — demoda AÇIK ─────────────────────────────────
  // Tek şalter dördünü birden açar: cihaz onayı, ülke onayı, saat kilidi,
  // ölü adam anahtarı. Ülke ve saat varsayılanları bilerek env'siz bırakıldı
  // (TR,AT / 07:00-21:00); kişi bazında ayar patron ekranından yapılıyor.
  ACCESS_GATES_ENABLED: "true",
};

/**
 * NİYET — env uygulandıktan sonra modüllerin ÜRETMESİ gereken değerler.
 * Bir env satırı yanlış yazılırsa buradaki karşılığı tutmaz ve betik kırılır.
 */
const EXPECTED = {
  "brand.tenant": "galzura-demo",
  "brand.name": "Galzura Fleet",
  "brand.legalName": "Galzura Fleet",
  "brand.city": "Wien",
  "brand.appTitle": "Galzura Fleet",
  "brand.shortName": "Galzura",
  "brand.cityLine": "Galzura Fleet · Wien",
  // Kayıtsız tenant → görseller public/brands/galzura-demo/ altında beklenir.
  "brand.logo": "/brands/galzura-demo/logo.png",
  "brand.favicon": "/brands/galzura-demo/favicon.ico",

  // 🔴 KİMLİK MASKELEME — demoda kapalı kalırsa gerçek VIN sızar.
  // Bu ikisi env'e DEĞİL müşteri koduna bağlıdır; env unutulsa bile true olmalı.
  "tenant.IDENTITY_MASKED": true,
  "tenant.VIN_BACKFILL_ENABLED": false,
  "tenant.DEMO_BACKFILL_ENABLED": true,
  "tenant.SECURITY_LAYER_ENABLED": true,
  "tenant.SECURITY_LAYER_PUBLIC": true,
  "tenant.ACCESS_GATES_ENABLED": true,
  "tenant.ACCESS_COUNTRIES": "TR,AT",
  "tenant.ACCESS_HOURS_START": "07:00",
  "tenant.ACCESS_HOURS_END": "21:00",
  "tenant.SINGLE_SESSION": true,
  "tenant.EXPORT_ENABLED": false,
  "tenant.PDF_WATERMARK": "GALZURA DEMO",

  // ⚠️ ASIL MESELE — bu üçü sessizce düşerse demo yanlış çalışır:
  "tenant.SHIFT_START_TRIGGER": "first_ignition",
  "tenant.SHIFT_AUTO_END": "depot_idle",
  "tenant.SHIFT_AUTO_END_IDLE_MIN": 20,
  "tenant.SHIFT_AUTO_END_MIDNIGHT_FALLBACK": true,

  // Tek filo — ['bordo','mavi']'ye düşerse "Bordo Filo 0" çipi geri gelir.
  "tenant.ACTIVE_FLEETS": "mavi",
  "tenant.FLEET_LABELS": JSON.stringify({ bordo: "", mavi: "Filo" }),

  "tenant.DRIVER_PANEL_ENABLED": true,
  "tenant.DRIVER_VEHICLE_CHOICE": "free",
  "tenant.PACKAGES_ENABLED": false,
  "tenant.FLEET_EPOCH_ISO": "2026-08-07T00:00:00.000Z",

  // Demo'da dokunulmayan, varsayılanda kalması GEREKENLER — bir env satırı
  // yanlışlıkla bunları kaydırırsa da yakalanır.
  "tenant.FUEL_ENABLED": false,
  "tenant.EXPENSE_ENABLED": false,
  "tenant.MAINTENANCE_ENABLED": false,
  "tenant.LEAVES_ENABLED": true,
  "tenant.ADMIN_DRIVER_PANEL_LINK": false,
  "tenant.LENKZEIT_WARNING_ENABLED": true,
  // Güvenlik skoru K sabiti HAK61 filosuna kalibre; demo AYNI 29 aracı okuyor,
  // dolayısıyla kalibrasyon iddiası burada geçerli — açık kalır.
  "tenant.SAFETY_SCORE_CALIBRATED": true,
};

if (process.argv.includes("--print")) {
  console.log("# Galzura Fleet demo — Vercel env (sırlar HARİÇ)");
  for (const [k, v] of Object.entries(ENV)) console.log(`${k}=${v}`);
  process.exit(0);
}

/** check-tenant-defaults.mjs'deki sondanın aynısı — tek fark: env UYGULANIR. */
const PROBE = `
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[4];
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
process.stdout.write(JSON.stringify({
  "brand.tenant": brand.BRAND.tenant,
  "brand.name": brand.BRAND.name,
  "brand.legalName": brand.BRAND.legalName,
  "brand.city": brand.BRAND.city,
  "brand.appTitle": brand.BRAND.appTitle,
  "brand.shortName": brand.BRAND.shortName,
  "brand.cityLine": brand.brandCityLine(),
  "brand.logo": brand.BRAND.assets.logo,
  "brand.favicon": brand.BRAND.assets.favicon,
  "tenant.IDENTITY_MASKED": tenant.IDENTITY_MASKED,
  "tenant.VIN_BACKFILL_ENABLED": tenant.VIN_BACKFILL_ENABLED,
  "tenant.DEMO_BACKFILL_ENABLED": tenant.DEMO_BACKFILL_ENABLED,
  "tenant.SECURITY_LAYER_ENABLED": tenant.SECURITY_LAYER_ENABLED,
  "tenant.SECURITY_LAYER_PUBLIC": tenant.SECURITY_LAYER_PUBLIC,
  "tenant.ACCESS_GATES_ENABLED": tenant.ACCESS_GATES_ENABLED,
  "tenant.ACCESS_COUNTRIES": tenant.ACCESS_COUNTRIES.join(","),
  "tenant.ACCESS_HOURS_START": tenant.ACCESS_HOURS_START,
  "tenant.ACCESS_HOURS_END": tenant.ACCESS_HOURS_END,
  "tenant.SINGLE_SESSION": tenant.SINGLE_SESSION,
  "tenant.EXPORT_ENABLED": tenant.EXPORT_ENABLED,
  "tenant.PDF_WATERMARK": tenant.PDF_WATERMARK,
  "tenant.SHIFT_START_TRIGGER": tenant.SHIFT_START_TRIGGER,
  "tenant.SHIFT_AUTO_END": tenant.SHIFT_AUTO_END,
  "tenant.SHIFT_AUTO_END_IDLE_MIN": tenant.SHIFT_AUTO_END_IDLE_MIN,
  "tenant.SHIFT_AUTO_END_MIDNIGHT_FALLBACK": tenant.SHIFT_AUTO_END_MIDNIGHT_FALLBACK,
  "tenant.ACTIVE_FLEETS": tenant.ACTIVE_FLEETS.join(","),
  "tenant.FLEET_LABELS": JSON.stringify(tenant.FLEET_LABELS),
  "tenant.DRIVER_PANEL_ENABLED": tenant.DRIVER_PANEL_ENABLED,
  "tenant.DRIVER_VEHICLE_CHOICE": tenant.DRIVER_VEHICLE_CHOICE,
  "tenant.PACKAGES_ENABLED": tenant.PACKAGES_ENABLED,
  "tenant.FLEET_EPOCH_ISO": tenant.FLEET_EPOCH_ISO,
  "tenant.FUEL_ENABLED": tenant.FUEL_ENABLED,
  "tenant.EXPENSE_ENABLED": tenant.EXPENSE_ENABLED,
  "tenant.MAINTENANCE_ENABLED": tenant.MAINTENANCE_ENABLED,
  "tenant.LEAVES_ENABLED": tenant.LEAVES_ENABLED,
  "tenant.ADMIN_DRIVER_PANEL_LINK": tenant.ADMIN_DRIVER_PANEL_LINK,
  "tenant.LENKZEIT_WARNING_ENABLED": tenant.LENKZEIT_WARNING_ENABLED,
  "tenant.SAFETY_SCORE_CALIBRATED": tenant.SAFETY_SCORE_CALIBRATED,
}));
`;

const dir = mkdtempSync(join(tmpdir(), "demo-env-"));
const probePath = join(dir, "probe.mjs");
writeFileSync(probePath, PROBE);

// Geliştiricinin .env.local'i sonucu kirletmesin: yalnız ENV uygulanır.
const res = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--no-warnings",
    probePath,
    join(ROOT, "lib", "tenant.ts"),
    join(ROOT, "lib", "brand.ts"),
    ROOT,
  ],
  {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_OPTIONS: "",
      ...ENV,
    },
  }
);
rmSync(dir, { recursive: true, force: true });

if (res.status !== 0) {
  console.error("✗ Modüller yüklenemedi:\n" + (res.stderr || res.stdout));
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
  if (got !== want) {
    fail++;
    console.error(
      `✗ ${key}\n    niyet  : ${JSON.stringify(want)}\n    çözülen: ${JSON.stringify(got)}`
    );
  } else {
    console.log(`  ✓ ${key.padEnd(42)} = ${JSON.stringify(got)}`);
  }
}

const total = Object.keys(EXPECTED).length;
if (fail > 0) {
  console.error(
    `\n${fail}/${total} ayar niyetten SAPTI. Büyük olasılıkla bir env satırı ` +
      "yanlış yazıldı ve envEnum/envBool onu sessizce varsayılana düşürdü " +
      "(lib/tenant.ts:56-63).\n"
  );
  process.exit(1);
}
console.log(`\n✓ ${total}/${total} ayar niyetle birebir — sessiz düşüş YOK.`);
