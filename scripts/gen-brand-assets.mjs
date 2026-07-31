#!/usr/bin/env node
/**
 * MÜŞTERİ MARKA GÖRSELLERİ — tek kaynak logodan türetir.
 *
 * `scripts/gen-icons.mjs` HAK61'e özeldi (kök public/, sabit turuncu zemin,
 * sabit dosya adları). Bu betik müşteri parametrik çalışır ve çıktıyı
 * `public/brands/<tenant>/` altına yazar — lib/brand.ts'in beklediği yer.
 *
 * Kaynak: public/brands/<tenant>/logo-source.png (dokunulmaz orijinal).
 * Çıktılar HER ZAMAN küçük harfle yazılır — Vercel'in Linux dosya sistemi
 * büyük/küçük harfi ayırt eder, Windows etmez.
 *
 * Üretilenler: logo.png (normalize), splash.png, icon-192/512, favicon-32x32,
 * favicon.ico, apple-touch-icon.
 *
 * Kullanım:
 *   node scripts/gen-brand-assets.mjs sendigo
 *   node scripts/gen-brand-assets.mjs sendigo --bg "#0a0d16"
 */

import sharp from "sharp";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const tenant = process.argv[2];
if (!tenant || tenant.startsWith("--")) {
  console.error("Kullanım: node scripts/gen-brand-assets.mjs <tenant> [--bg \"#rrggbb\"]");
  process.exit(1);
}

const bgIdx = process.argv.indexOf("--bg");
// Varsayılan zemin, Splash bileşeninin kullandığı koyu zeminle aynı (#0a0d16):
// ikon köşeleri splash ekranıyla aynı tonda kalsın diye.
const BG = bgIdx > -1 ? process.argv[bgIdx + 1] : "#0a0d16";

const DIR = join(process.cwd(), "public", "brands", tenant);
if (!existsSync(DIR)) {
  console.error(`✗ Klasör yok: public/brands/${tenant}/ — logoyu oraya koyun.`);
  process.exit(1);
}

/**
 * Kaynak logoyu bul. SIRA ÖNEMLİ: `logo-source.png` önce gelir.
 *
 * ⚠️ 31.07.2026'da bu betik kaynak dosyayı BOZDU. Sebep: Volkan logoyu
 * `Logo.png` adıyla koymuştu; betik onu okurken çıktıyı `logo.png` olarak
 * yazdı ve Windows dosya adlarında büyük/küçük harfi ayırt etmediği için ikisi
 * AYNI dosyaydı — sharp okuma akışının altından dosya değişti, PNG veri
 * parçaları yarıda kesildi (başlık sağlam kaldığı için metadata() çalışmaya
 * devam etti, tam çözme "libspng read error" verdi).
 *
 * Kalıcı çözüm iki katmanlı:
 *   1. Kaynak için AYRI bir ad (`logo-source.png`) — çıktı adıyla asla
 *      çakışmaz, ne Windows'ta ne Linux'ta.
 *   2. Kaynak yine de çıktı adıyla aynıysa (eski kurulumlar), tüm görüntü
 *      belleğe alındıktan SONRA yazılır (main() içinde SOURCE buffer'ı).
 */
function findSource() {
  const files = readdirSync(DIR);
  const preferred = files.find((f) => f.toLowerCase() === "logo-source.png");
  if (preferred) return join(DIR, preferred);
  const exact = files.find((f) => f === "logo.png");
  if (exact) return join(DIR, exact);
  const loose = files.find((f) => /logo\.png$/i.test(f));
  if (loose) return join(DIR, loose);
  return null;
}

let SOURCE = null;
const SOURCE_BUFFER = () => SOURCE;

const SRC = findSource();
if (!SRC) {
  console.error(`✗ public/brands/${tenant}/logo.png bulunamadı.`);
  process.exit(1);
}

/** Şeffaf logoyu markalı kare zemine, %18 boşlukla oturtur. */
async function icon(size, out) {
  const pad = Math.round(size * 0.18);
  const inner = size - pad * 2;
  const logo = await sharp(SOURCE_BUFFER())
    .resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(join(DIR, out));
  console.log(`  ✓ ${out} (${size}×${size})`);
}

async function main() {
  await mkdir(DIR, { recursive: true });
  const meta = await sharp(SRC).metadata();
  SOURCE = await sharp(SRC).png().toBuffer();
  console.log(`Kaynak: ${SRC.replace(process.cwd(), ".")} (${meta.width}×${meta.height})`);
  console.log(`Oran   : ${(meta.width / meta.height).toFixed(4)}  → NEXT_PUBLIC_BRAND_LOGO_RATIO`);

  // logo.png — küçük harfli kanonik ad.
  //
  // ⚠️ Kaynak ÖNCE belleğe alınır. Windows dosya adlarında büyük/küçük harfi
  // ayırt etmediği için "Logo.png" okurken "logo.png" yazmak AYNI dosyaya
  // yazmaktır: sharp okuma akışının altından dosyayı çeker ve "libspng read
  // error" ile patlar (ilk denemede yaşandı). Buffer'a alınca kaynak serbest
  // kalır ve aynı-dosya durumu zararsızlaşır.
  await sharp(SOURCE_BUFFER()).png({ compressionLevel: 9 }).toFile(join(DIR, "logo.png"));
  console.log("  ✓ logo.png (küçük harfli kanonik ad — Linux dosya sistemi için)");

  // splash.png — saydam, geniş; Splash bileşeni kendi koyu zeminini basıyor.
  const splashW = 920;
  const splashH = Math.round(splashW * (meta.height / meta.width));
  await sharp(SOURCE_BUFFER())
    .resize({ width: splashW, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(DIR, "splash.png"));
  console.log(`  ✓ splash.png (${splashW}×${splashH})  → brand.ts splashWidth/Height`);

  await icon(192, "icon-192.png");
  await icon(512, "icon-512.png");
  await icon(180, "apple-touch-icon.png");
  await icon(32, "favicon-32x32.png");
  // .ico: 32px PNG içeriğiyle; modern tarayıcılar PNG-in-ICO'yu okur ve
  // metadata zaten favicon-32x32'yi de bildiriyor.
  await icon(32, "favicon.ico");

  console.log(`\nlib/brand.ts'e eklenecek splash boyutu: ${splashW} × ${splashH}`);
}

main().catch((e) => {
  console.error("✗", e?.message ?? e);
  process.exit(1);
});
