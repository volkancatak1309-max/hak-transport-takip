#!/usr/bin/env node
/**
 * KONTRAST MUHAFIZI — uyarı (amber) metinleri WCAG AA tutuyor mu?
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * 27.08.2026'da CANLIDA yakalandı: takograf uyarı şeridi `text-amber-200`
 * kullanıyordu. Koyu temada 14.43:1 (kusursuz), AÇIK TEMADA 1.02:1 — yani
 * metin görünmüyordu. Kusur "amber üstüne amber" değil TEMA KÖRLÜĞÜYDÜ:
 * sınıf tek temaya göre seçilmiş, öbürünün karşılığı hiç yazılmamıştı.
 * Beş dosyada birden aynı hata vardı ve hiçbir denetimden geçmemişti.
 *
 * ── NE DENETLER ────────────────────────────────────────────────────────────
 *   1. TEMA ÇİFTİ  — `text-amber-N` varsa `dark:text-amber-M` de olmalı
 *                    (ya da tersi). Tek başına bir ton, öbür temada ölçülmemiş
 *                    demektir.
 *   2. KONTRAST    — her iki tema için oran ≥ 4.5:1 (WCAG AA, normal metin).
 *                    Zemin, aynı className'deki `bg-amber-N/A` dolgusuyla
 *                    birlikte hesaplanır; dolgu yoksa tema zemini alınır.
 *   3. ÖLÜ SINIF   — `text-accent-*` gibi tanımsız bir renk sınıfı. Tailwind
 *                    onu hiç üretmez, metin sessizce renksiz kalır. İki
 *                    ekranda tam olarak bu vardı (`text-accent-amber-text`).
 *
 * ── ÖLÇÜM NEREDEN ──────────────────────────────────────────────────────────
 * Palet `node_modules/tailwindcss/theme.css`ten (oklch), tema zeminleri
 * `app/globals.css`ten okunur — ikisi de ÜRÜNÜN GERÇEK KAYNAĞI. Sabit
 * kopyalanmış renk yok, bayatlamaz.
 *
 * ⚠️ canvas.fillStyle KULLANILMAZ: bu depoda ölçüldü, lab()/oklch değerlerini
 * normalize etmiyor ve SAHTE oran veriyor (1.38 yerine gerçeği 10.64'tü).
 * Çevirim burada elle yapılıyor.
 *
 * Kullanım: node scripts/check-kontrast.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const AA = 4.5;

// ── Palet: tailwindcss/theme.css (oklch) ──────────────────────────────────
const TW = path.join(ROOT, "node_modules", "tailwindcss", "theme.css");
if (!existsSync(TW)) {
  console.error("✗ tailwindcss/theme.css yok — palet okunamadı.");
  process.exit(1);
}
const PALET = new Map();
for (const m of readFileSync(TW, "utf8").matchAll(
  /--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g
)) {
  PALET.set(`${m[1]}-${m[2]}`, [Number(m[3]), Number(m[4]), Number(m[5])]);
}

// ── Tema zeminleri: app/globals.css ───────────────────────────────────────
const G = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
function tokenOku(secici, ad) {
  const blok = G.split(secici)[1];
  if (!blok) return null;
  const m = blok.match(new RegExp(`--${ad}:\\s*(#[0-9a-fA-F]{3,8})`));
  return m ? m[1] : null;
}
const ZEMIN = {
  acik: tokenOku(":root {", "background") ?? "#ffffff",
  koyu: tokenOku(".dark {", "background") ?? "#000000",
};
const KART = {
  acik: tokenOku(":root {", "card") ?? "#ffffff",
  koyu: tokenOku(".dark {", "card") ?? "#000000",
};

/**
 * TANIMLI aksan renkleri — `@theme inline` bloğundaki `--color-accent-*`.
 *
 * ⚠️ Bu liste OKUNUR, varsayılmaz. İlk yazımda "text-accent-* = ölü sınıf"
 * diye kestirme yapıldı ve muhafız 160 YANLIŞ POZİTİF üretti: `accent-gold-text`,
 * `accent-sky-text`, `accent-claret-text` … hepsi tanımlı ve derlenmiş CSS'te
 * gerçekten üretiliyor. Gerçekten ölü olan yalnız listede BULUNMAYANLAR.
 */
const TANIMLI_AKSAN = new Set(
  [...G.matchAll(/--color-accent-([a-z-]+)\s*:/g)].map((m) => m[1])
);

// ── Renk matematiği ───────────────────────────────────────────────────────
const kanal = (u) => {
  const s = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};
function oklch2rgb([Lp, C, H]) {
  const L = Lp / 100, h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    kanal(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    kanal(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    kanal(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const hex2rgb = (h) => {
  const v = h.replace("#", "");
  const t = v.length === 3 ? v.split("").map((c) => c + c).join("") : v.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16));
};
const bindir = (ust, alt, a) => ust.map((c, i) => Math.round(a * c + (1 - a) * alt[i]));
const lum = (rgb) =>
  rgb
    .map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
    .reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0);
const oran = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// ── Dosyaları tara ────────────────────────────────────────────────────────
function tsxDosyalar(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) tsxDosyalar(p, out);
    else if (e.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const bulgular = [];
const IZLENEN = /\btext-amber-\d+\b/;

for (const yol of [path.join(ROOT, "app"), path.join(ROOT, "components")].flatMap((d) =>
  existsSync(d) ? tsxDosyalar(d) : []
)) {
  const satirlar = readFileSync(yol, "utf8").split(/\r?\n/);
  const goreli = path.relative(ROOT, yol).replace(/\\/g, "/");

  satirlar.forEach((satir, i) => {
    const no = i + 1;

    // 3 · ÖLÜ SINIF — yalnız globals.css'te TANIMLI OLMAYANLAR
    for (const m of satir.matchAll(/\btext-accent-([a-z-]+)\b/g)) {
      if (TANIMLI_AKSAN.has(m[1])) continue;
      bulgular.push({
        yol: goreli, no,
        mesaj: `ÖLÜ SINIF "text-accent-${m[1]}" — globals.css'te "--color-accent-${m[1]}" YOK. Tailwind sınıfı üretmez, metin sessizce renksiz kalır.`,
      });
    }

    if (!IZLENEN.test(satir)) return;

    const acikTon = satir.match(/(?<!dark:)\btext-(amber-\d+)\b/)?.[1] ?? null;
    const koyuTon = satir.match(/\bdark:text-(amber-\d+)\b/)?.[1] ?? null;

    // 1 · TEMA ÇİFTİ
    if (!acikTon || !koyuTon) {
      bulgular.push({
        yol: goreli, no,
        mesaj: `TEMA KÖRÜ — ${acikTon ? `"text-${acikTon}" var ama "dark:text-…" yok` : `yalnız "dark:text-${koyuTon}" var, açık tema karşılığı yok`}. Öbür temada ölçülmemiş demektir.`,
      });
      return;
    }

    // Aynı className'deki amber dolgusu (varsa) zemine katılır
    const dolgu = satir.match(/\bbg-(amber-\d+)\/(\d+)\b/);
    const uzerinde = /\bbg-card\b/.test(satir) ? KART : ZEMIN;

    for (const [tema, ton] of [["acik", acikTon], ["koyu", koyuTon]]) {
      if (!PALET.has(ton)) {
        bulgular.push({ yol: goreli, no, mesaj: `"${ton}" palette yok.` });
        continue;
      }
      let arka = hex2rgb(uzerinde[tema]);
      if (dolgu && PALET.has(dolgu[1])) {
        arka = bindir(oklch2rgb(PALET.get(dolgu[1])), arka, Number(dolgu[2]) / 100);
      }
      const on = oklch2rgb(PALET.get(ton));
      const r = oran(on, arka);
      if (r < AA) {
        bulgular.push({
          yol: goreli, no,
          mesaj: `${tema.toUpperCase()} temada kontrast ${r.toFixed(2)}:1 — WCAG AA eşiği ${AA}:1. (text-${ton} · zemin rgb(${arka.join(",")}))`,
        });
      }
    }
  });
}

if (bulgular.length) {
  console.error(`\n✗ KONTRAST MUHAFIZI — ${bulgular.length} bulgu:\n`);
  for (const b of bulgular) console.error(`  ${b.yol}:${b.no}\n      ${b.mesaj}`);
  console.error(
    `\n  Çözüm: uyarı metnini İKİ TEMAYA birden yaz, ör.\n` +
      `      text-amber-800 dark:text-amber-200\n` +
      `  (ölçüldü: açık 5.80:1 · koyu 14.43:1, bg-amber-500/10 üzerinde)\n`
  );
  process.exit(1);
}
console.log(
  `✓ kontrast muhafızı: amber uyarı metinleri iki temada da ≥ ${AA}:1 ` +
    `(zemin açık ${ZEMIN.acik} · koyu ${ZEMIN.koyu}, palet ${PALET.size} ton)`
);
