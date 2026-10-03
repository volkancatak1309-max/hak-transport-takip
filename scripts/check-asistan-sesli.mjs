#!/usr/bin/env node
/**
 * SESLİ ASİSTAN MUHAFIZI — kaynak denetimi (Faz 1 web prototipi, 03.10.2026).
 *
 * ═══ NE KORUYOR ═══
 *
 * Prototip bir DIŞ ÇAĞRI (OpenAI) ve bir MALİYET açıyor; üç şey sessizce bozulursa
 * zararı büyük olur:
 *   1) ANAHTAR: `OPENAI_API_KEY` yalnız `lib/asistan-sesli.ts`'te okunur; istemci
 *      bileşeni `process.env`'e hiç dokunmaz; `NEXT_PUBLIC_OPENAI…` yok; sunucu
 *      dosyalarında `console.` yok (hata gövdesi/anahtar loga düşmesin).
 *   2) YAZMA YOK: araç katmanı yalnız `GET` işleyicisi içe aktarır, `supabaseAdmin`
 *      yok, rapor (`/reports`) ve patron (`/guvenlik`) uçları araç değil.
 *   3) KAPI: bayrak → kiracı → oturum sırası; iki uç da ilk iş `sesliKapi()`;
 *      sayfa `sesliAcikMi()` + `notFound()`; bayrak varsayılanı kapalı ("1" dışı).
 * Ayrıca: `gpt-live-1` izin listesinde yok (Realtime API'yi desteklemiyor), 10 dk
 * sınırı, istemde kiracı adı ("HAK61") yok.
 *
 * Kurallar önce gerçek dosyalarda geçmeli, sonra her kural için bozulmuş bir kopyada
 * DÜŞMELİ (arıza enjeksiyonu) — geçiyor olması tek başına çalıştığını kanıtlamaz.
 *
 * Kullanım: npm run lint:asistan-sesli
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => readFileSync(path.join(ROOT, p), "utf8");

const D = {
  cekirdek: "lib/asistan-sesli.ts",
  araclar: "lib/asistan-sesli-araclar.ts",
  sabitler: "lib/asistan-sesli-sabitler.ts",
  oturum: "app/api/asistan/oturum/route.ts",
  arac: "app/api/asistan/arac/route.ts",
  sayfa: "app/admin/asistan/page.tsx",
  istemci: "app/admin/asistan/AsistanSesliClient.tsx",
  tenant: "lib/tenant.ts",
};

/** Yorumlar atılır: kurallar KODA bakar, açıklama metnine değil. */
const kod = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function tumKaynak() {
  const cikti = [];
  const gez = (d) => {
    for (const ad of readdirSync(path.join(ROOT, d))) {
      const g = path.join(d, ad);
      if (statSync(path.join(ROOT, g)).isDirectory()) gez(g);
      else if (/\.(ts|tsx)$/.test(ad)) cikti.push(g.split(path.sep).join("/"));
    }
  };
  ["app", "lib", "components"].forEach(gez);
  return cikti;
}

/** Her kural: (dosyalar) → hata metni ya da null. */
const KURALLAR = [
  ["anahtar yalnız çekirdekte", (f) => {
    const yer = Object.entries(f.hepsi).filter(([, s]) => kod(s).includes("OPENAI_API_KEY")).map(([p]) => p);
    return yer.length === 1 && yer[0] === D.cekirdek ? null : `OPENAI_API_KEY okuyan: ${yer.join(", ") || "yok"}`;
  }],
  ["NEXT_PUBLIC_OPENAI yok", (f) =>
    Object.values(f.hepsi).some((s) => /NEXT_PUBLIC_OPENAI/.test(s)) ? "NEXT_PUBLIC_OPENAI bulundu" : null],
  ["istemci process.env okumaz", (f) => (/process\.env/.test(kod(f[D.istemci])) ? "istemcide process.env" : null)],
  ["sunucu dosyalarında console yok", (f) => {
    const kirli = [D.cekirdek, D.araclar, D.oturum, D.arac].filter((p) => /\bconsole\./.test(kod(f[p])));
    return kirli.length ? `console: ${kirli.join(", ")}` : null;
  }],
  ["araçlar yalnız GET içe aktarır", (f) => {
    const s = kod(f[D.araclar]);
    if (/import\s*\{[^}]*\b(POST|PATCH|PUT|DELETE)\b[^}]*\}\s*from\s*"@\/app\/api/.test(s)) return "yazma işleyicisi içe aktarılmış";
    if (/supabaseAdmin|@\/lib\/supabase/.test(s)) return "supabaseAdmin içe aktarılmış";
    if (/@\/app\/api\/mobile\/(reports|guvenlik)/.test(s)) return "rapor/güvenlik ucu araç olmuş";
    return null;
  }],
  ["kapı sırası bayrak → kiracı → oturum", (f) => {
    const s = kod(f[D.cekirdek]);
    const govde = s.slice(s.indexOf("export async function sesliKapi"));
    const i = [govde.indexOf("!ASISTAN_SESLI"), govde.indexOf("TENANT !== SESLI_KIRACI"), govde.indexOf("getSession()"), govde.indexOf("requireAdmin()")];
    return i.every((x, k) => x >= 0 && (k === 0 || x > i[k - 1])) ? null : `sıra: ${i.join(",")}`;
  }],
  ["iki uç da önce sesliKapi", (f) => {
    const bozuk = [D.oturum, D.arac].filter((p) => !/export async function POST\([^)]*\)\s*\{\s*const kapi = await sesliKapi\(\);\s*if \(!kapi\.ok\) return kapi\.response;/.test(kod(f[p])));
    return bozuk.length ? `ilk iş kapı değil: ${bozuk.join(", ")}` : null;
  }],
  ["sayfa 404 kapısı", (f) => {
    const s = kod(f[D.sayfa]);
    return /if \(!sesliAcikMi\(\)\) notFound\(\);/.test(s) && /is_admin\) notFound\(\);/.test(s) ? null : "sayfa kapısı eksik";
  }],
  ["bayrak varsayılanı kapalı (katı \"1\")", (f) =>
    /export const ASISTAN_SESLI = process\.env\.ASISTAN_SESLI\?\.trim\(\) === "1";/.test(f[D.tenant]) ? null : "bayrak tanımı değişmiş"],
  ["gpt-live-1 izin listesinde değil", (f) =>
    /id:\s*"gpt-live-1"/.test(kod(f[D.sabitler])) ? "gpt-live-1 listede" : null],
  ["10 dk sınırı", (f) => (/SESLI_OTURUM_SINIRI_SN = 600;/.test(f[D.sabitler]) ? null : "oturum sınırı 600 değil")],
  ["istemde kiracı adı yok", (f) => {
    const m = f[D.cekirdek].match(/const SISTEM_ISTEMI = `([\s\S]*?)`;/);
    if (!m) return "istem bulunamadı";
    return /HAK61|Sendigo/i.test(m[1]) ? "istemde kiracı adı" : null;
  }],
];

function dosyalar() {
  const f = {};
  for (const p of Object.values(D)) f[p] = oku(p);
  f.hepsi = Object.fromEntries(tumKaynak().map((p) => [p, oku(p)]));
  return f;
}

function denetle(f) {
  return KURALLAR.map(([ad, kural]) => [ad, kural(f)]).filter(([, h]) => h);
}

const gercek = dosyalar();
const dusen = denetle(gercek);
for (const [ad, h] of dusen) console.log(`  ✗ ${ad}  —  ${h}`);

// ── Arıza enjeksiyonu: her biri kendi kuralını DÜŞÜRMELİ.
const BOZMALAR = [
  ["anahtar yalnız çekirdekte", (f) => { f.hepsi[D.istemci] += "\nconst k = process.env.OPENAI_API_KEY;"; }],
  ["istemci process.env okumaz", (f) => { f[D.istemci] += "\nconst x = process.env.X;"; }],
  ["araçlar yalnız GET içe aktarır", (f) => { f[D.araclar] += '\nimport { POST as y } from "@/app/api/mobile/sefer/route";'; }],
  ["kapı sırası bayrak → kiracı → oturum", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("if (!ASISTAN_SESLI) return", "if (false) return");
  }],
  ["iki uç da önce sesliKapi", (f) => { f[D.arac] = f[D.arac].replace("const kapi = await sesliKapi();", "const kapi = { ok: true };"); }],
  ["bayrak varsayılanı kapalı (katı \"1\")", (f) => {
    f[D.tenant] = f[D.tenant].replace('process.env.ASISTAN_SESLI?.trim() === "1";', 'process.env.ASISTAN_SESLI?.trim() !== "0";');
  }],
  ["istemde kiracı adı yok", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("You are the voice assistant of Galzura Fleet", "You are the voice assistant of HAK61");
  }],
  ["gpt-live-1 izin listesinde değil", (f) => { f[D.sabitler] += '\nconst z = [{ id: "gpt-live-1" }];'; }],
];
let kacan = 0;
for (const [ad, boz] of BOZMALAR) {
  const kopya = structuredClone(gercek);
  boz(kopya);
  if (!denetle(kopya).some(([k]) => k === ad)) {
    kacan++;
    console.log(`  ✗ arıza enjeksiyonu YAKALANMADI: ${ad}`);
  }
}

if (dusen.length > 0 || kacan > 0) {
  console.log(`\n✗ SESLİ ASİSTAN MUHAFIZI — ${dusen.length} kural düştü, ${kacan} arıza kaçtı.\n`);
  process.exit(1);
}
console.log(`✓ sesli asistan muhafızı: ${KURALLAR.length} kural geçti, ${BOZMALAR.length} arıza enjeksiyonunun hepsi yakalandı.`);
