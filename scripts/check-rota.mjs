#!/usr/bin/env node
/**
 * ROTA OPTİMİZASYONU MUHAFIZI — `npm run lint:rota` (verify zincirinde, build'den SONRA).
 *
 * Dokuz kaynak kuralı + bir derleme kuralı. Her biri bir kararın karşılığı;
 * kural düşerse karar sessizce delinmiş demektir.
 *
 *   R1  Sağlayıcı/anahtar/kota/kayıt modülleri `server-only`.
 *   R2  "use client" dosyaları lib/rota'dan YALNIZ `tipler` (tip) ve `polyline`
 *       alabilir — sağlayıcı kodu istemci paketine giremez.
 *   R3  Rota sırları NEXT_PUBLIC_ olamaz (istemciye gömülürdü).
 *   R4  Kaynakta sabit anahtar yok (Google API anahtarı, özel anahtar PEM'i).
 *   R5  Kapı sırası: modül → sağlayıcı → kota → çekirdek (rotaOner); modül →
 *       parmak izi → yazma (rotaUygula).
 *   R6  Harita lisans kapısı: `harita` ve geometri `haritaSerbest`e bağlı;
 *       istemci haritayı yalnız sunucu verisi varsa çiziyor.
 *   R7  Sahte sağlayıcı ÜRETİMDE kurulamaz (VERCEL_ENV denetimi).
 *   R8  "use server" dosyasından tip dışa aktarımı yok (02.10.2026 olayı).
 *   R9  Vekil: sabit süreli sır karşılaştırması, sırsız BAŞLAMAZ, log'da gövde
 *       ve sorgu dizgisi yok.
 *   P1  (build sonrası) istemci paketinde sunucu izleri YOK: env adları,
 *       Google uçları, OAuth akışı, kota anahtarı.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const oku = (p) => readFileSync(join(KOK, p), "utf8").replace(/\r\n/g, "\n");
const bulgular = [];
const bul = (kural, mesaj) => bulgular.push(`${kural} — ${mesaj}`);
let kuralSayisi = 0;
const kural = (ad, fn) => {
  kuralSayisi++;
  const once = bulgular.length;
  fn();
  console.log(`  ${bulgular.length === once ? "✓" : "✗"} ${ad}`);
};

function dosyalar(dizin, uzanti) {
  const out = [];
  const tara = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) tara(p);
      else if (uzanti.some((u) => e.name.endsWith(u))) out.push(p);
    }
  };
  tara(join(KOK, dizin));
  return out;
}

const SUNUCU_MODULLERI = ["vroom", "google", "google-oauth", "saglayici", "kota", "kayit"];

kural("R1 sağlayıcı/anahtar/kota/kayıt modülleri server-only", () => {
  for (const m of SUNUCU_MODULLERI) {
    const s = oku(`lib/rota/${m}.ts`);
    if (!/^import "server-only";/m.test(s.split("\n").slice(0, 3).join("\n"))) {
      bul("R1", `lib/rota/${m}.ts ilk satırlarında import "server-only" yok`);
    }
  }
});

kural("R2 istemci bileşenleri yalnız tipler + polyline alır", () => {
  for (const p of [...dosyalar("app", [".tsx", ".ts"]), ...dosyalar("components", [".tsx", ".ts"])]) {
    const s = readFileSync(p, "utf8");
    if (!/^\s*["']use client["']/.test(s)) continue;
    for (const m of s.matchAll(/from\s+["']@\/lib\/rota\/([\w-]+)["']/g)) {
      const satir = s.slice(s.lastIndexOf("\n", m.index) + 1, m.index + m[0].length);
      const tipMi = /import\s+type\b/.test(satir) || /import\s+type\b/.test(s.slice(Math.max(0, m.index - 400), m.index).split(";").pop() ?? "");
      if (m[1] === "polyline") continue;
      if (m[1] === "tipler" && tipMi) continue;
      bul("R2", `${relative(KOK, p)} istemci dosyası @/lib/rota/${m[1]} içe aktarıyor`);
    }
  }
});

kural("R3 rota sırları NEXT_PUBLIC_ değil", () => {
  for (const p of [...dosyalar("app", [".ts", ".tsx"]), ...dosyalar("lib", [".ts", ".tsx"]), ...dosyalar("components", [".tsx"])]) {
    const s = readFileSync(p, "utf8");
    const m = s.match(/NEXT_PUBLIC_(?:GOOGLE_ROTA|ROTA_)\w*/);
    if (m) bul("R3", `${relative(KOK, p)} → ${m[0]}`);
  }
  if (/^NEXT_PUBLIC_(?:GOOGLE_ROTA|ROTA_)/m.test(oku(".env.example"))) bul("R3", ".env.example'da NEXT_PUBLIC_ rota anahtarı");
});

kural("R4 kaynakta sabit anahtar yok", () => {
  const ADAYLAR = [
    ...dosyalar("lib/rota", [".ts"]),
    join(KOK, "app/actions/rota.ts"),
    ...dosyalar("servis", [".mjs", ".service"]),
    join(KOK, "scripts/seed-demo-rota.mjs"),
  ].filter((p) => existsSync(p));
  for (const p of ADAYLAR) {
    const s = readFileSync(p, "utf8");
    if (/AIza[0-9A-Za-z_-]{30,}/.test(s)) bul("R4", `${relative(KOK, p)} Google API anahtarı biçiminde dizge`);
    if (/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(s)) bul("R4", `${relative(KOK, p)} PEM özel anahtarı`);
    if (/Bearer [0-9a-f]{32,}/i.test(s)) bul("R4", `${relative(KOK, p)} gömülü Bearer sırrı`);
  }
});

kural("R5 kapı sırası (modül → sağlayıcı → kota → çekirdek; Uygula'da parmak izi → yazma)", () => {
  const s = oku("app/actions/rota.ts");
  const oner = s.slice(s.indexOf("export async function rotaOner"), s.indexOf("export async function rotaUygula"));
  const sira = ["ROTA_OPTIMIZASYONU_ENABLED", "rotaSaglayicilari()", "rotaKotaDus(", "rotaCekirdegi("];
  const yer = sira.map((x) => oner.indexOf(x));
  if (yer.some((i) => i < 0)) bul("R5", `rotaOner içinde eksik: ${sira.filter((_, i) => yer[i] < 0).join(", ")}`);
  else if (!yer.every((v, i) => i === 0 || yer[i - 1] < v)) bul("R5", `rotaOner kapı sırası bozuk: ${yer.join(" < ")}`);
  const kapsam = oner.indexOf("kapsamAl()");
  if (kapsam < 0 || kapsam > yer[0]) bul("R5", "rotaOner ilk iş kimlik/kapsam (kapsamAl) değil");
  const uyg = s.slice(s.indexOf("export async function rotaUygula"));
  const u = ["ROTA_OPTIMIZASYONU_ENABLED", "!== parmakIzi", "siralaDuraklar("].map((x) => uyg.indexOf(x));
  if (u.some((i) => i < 0) || !(u[0] < u[1] && u[1] < u[2])) bul("R5", `rotaUygula sırası bozuk: ${u.join(" < ")}`);
});

kural("R6 harita lisans kapısı sunucuda, istemci yalnız veri varsa çiziyor", () => {
  const s = oku("app/actions/rota.ts");
  if (!/harita:\s*haritaSerbest\s*\?/.test(s)) bul("R6", "rotaOner `harita` alanını haritaSerbest'e bağlamıyor");
  if (!/haritaSerbest\s*\?\s*p\s*:\s*\{\s*\.\.\.p,\s*geometri:\s*null\s*\}/.test(s)) bul("R6", "lisanssız sağlayıcıda geometri gövdeden silinmiyor");
  const ui = oku("app/admin/seferler/RotaOptimizasyonu.tsx");
  if (!/\{oneri\.harita \? \(/.test(ui)) bul("R6", "istemci haritayı `oneri.harita` koşulu olmadan çiziyor");
});

kural("R7 sahte sağlayıcı üretimde kurulamaz", () => {
  const s = oku("lib/rota/saglayici.ts");
  const g = s.slice(s.indexOf("function sahteKur"), s.indexOf("export function rotaSaglayicilari"));
  if (!/process\.env\.VERCEL_ENV === "production"\s*\?\s*null/.test(g)) bul("R7", "sahteKur VERCEL_ENV=production kilidini taşımıyor");
});

kural("R8 \"use server\" dosyasında tip dışa aktarımı yok, yalnız async fonksiyon", () => {
  const s = oku("app/actions/rota.ts");
  if (/^export\s+type\b/m.test(s) || /^export\s*\{/m.test(s)) bul("R8", "app/actions/rota.ts tip/isim dışa aktarıyor");
  for (const m of s.matchAll(/^export\s+(?!async function)(\w+)/gm)) bul("R8", `app/actions/rota.ts → export ${m[1]}`);
});

kural("R9 vekil: sabit süreli karşılaştırma, sırsız başlamaz, log'da gövde/sorgu yok", () => {
  const s = oku("servis/rota-vekil/rota-vekil.mjs");
  if (!/timingSafeEqual\(/.test(s)) bul("R9", "timingSafeEqual yok");
  if (!/SIR\.length < 32[\s\S]{0,300}process\.exit\(1\)/.test(s)) bul("R9", "kısa/boş sırla başlamayı engelleyen çıkış yok");
  const log = s.slice(s.indexOf('res.on("finish"'), s.indexOf('res.on("finish"') + 400);
  if (/u\.search|parcalar|req\.url/.test(log)) bul("R9", "log satırı sorgu dizgisi/gövde/ham yol içeriyor");
});

kural("R10 i18n: rota ad alanı üç dilde", () => {
  for (const dil of ["tr", "de", "en"]) {
    const j = JSON.parse(oku(`messages/${dil}.json`));
    if (!j.rota?.dugme || !j.rota?.servis_yok) bul("R10", `messages/${dil}.json rota.dugme/servis_yok yok`);
  }
});

// ── P1: build sonrası istemci paketi ─────────────────────────────────────────
const STATIK = join(KOK, ".next", "static");
kural("P1 istemci paketinde sunucu izi yok (env adları, Google uçları, OAuth, kota anahtarı)", () => {
  if (!existsSync(STATIK)) {
    bul("P1", ".next/static yok — önce `npm run build` (verify zincirinde build bu muhafızdan önce gelir)");
    return;
  }
  const yasak = [
    "GOOGLE_ROTA_ANAHTARI",
    "ROTA_SERVIS_SIRRI",
    "ROTA_VROOM_URL",
    "routeoptimization.googleapis.com",
    "routes.googleapis.com",
    "oauth2.googleapis.com",
    "jwt-bearer",
    "rota:gunluk",
  ];
  const kaynakSon = Math.max(...[...dosyalar("lib/rota", [".ts"]), join(KOK, "app/actions/rota.ts")].map((p) => statSync(p).mtimeMs));
  // dosyalar() nokta ile başlayan dizinleri (.next) atlıyor — paket ayrıca taranır.
  const paket = [];
  const tara = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const q = join(d, e.name);
      if (e.isDirectory()) tara(q);
      else if (e.name.endsWith(".js")) paket.push(q);
    }
  };
  tara(STATIK);
  let enYeni = 0;
  for (const p of paket) {
    enYeni = Math.max(enYeni, statSync(p).mtimeMs);
    const s = readFileSync(p, "utf8");
    for (const y of yasak) if (s.includes(y)) bul("P1", `${relative(KOK, p)} → "${y}"`);
  }
  if (enYeni < kaynakSon) bul("P1", ".next/static rota kaynaklarından ESKİ — build yeniden alınmalı (bayat paket denetlenemez)");
});

console.log(
  bulgular.length === 0
    ? `\n✓ rota muhafızı: ${kuralSayisi} kural yeşil`
    : `\n✗ ROTA MUHAFIZI — ${bulgular.length} bulgu:\n  ${bulgular.join("\n  ")}`
);
process.exit(bulgular.length === 0 ? 0 : 1);
