#!/usr/bin/env node
/**
 * "USE SERVER" TİP DIŞA AKTARIMI MUHAFIZI — kaynak denetimi.
 *
 * ═══ NE KORUYOR ═══
 *
 * 02.10.2026, demo: "Yeni sefer" 500 — `ReferenceError: KanitGorunum is not
 * defined` (modül YÜKLENİRKEN). Sebep `app/actions/teslimat.ts`teki
 * `export type { KanitGorunum };` satırıydı: Next 16.2.6'nın sunucu eylemi
 * dönüşümü "use server" dosyasındaki KAYNAKSIZ tip dışa aktarımını değer
 * sanıp `ensureServerEntryExports([…, KanitGorunum])` üretiyor; tip derlemede
 * silindiği için modül yüklenirken patlıyor. Sayfanın eylem yükleyicisi tüm
 * eylem modüllerini BİRLİKTE yüklediğinden sayfadaki HER eylem düşüyordu
 * (`seferOlustur`un kendisi sağlamdı). Aynı kalıp `app/actions/leaves.ts`te
 * de vardı (/admin/izinler).
 *
 * tsc ve `next build` bunu YAKALAMIYOR; yalnız eylem çağrılınca, canlıda
 * patlıyor. Bu yüzden kaynakta yasak:
 *
 *   ✗ export type { X };              kaynaksız tip dışa aktarımı
 *   ✗ export { type X } [from "…"];   satır içi `type`
 *   ✗ export { X };                   X yerel type/interface ya da tip importu
 *   ✓ export type X = …;              dönüşüm bunu doğru atlıyor
 *   ✓ export type { X } from "…";     derlenmiş çıktıda değere DÖNMÜYOR —
 *                                     azg-report.ts kaydı `[x]` (ölçüldü 03.10.2026)
 *
 * Tip paylaşılacaksa tüketici onu doğrudan çekirdekten alır:
 * `import type { KanitGorunum } from "@/lib/teslimat-db"`.
 *
 * Kullanım: npm run lint:use-server-tip
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIZINLER = ["app", "lib", "components"];
const USE_SERVER = /^\s*["']use server["']/;

// Yorumlar satır sayısı korunarak boşaltılır (bulgu satırı doğru çıksın).
const yorumsuz = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/.*$/gm, "");

const adlar = (liste) => liste.split(",").map((x) => x.trim()).filter(Boolean);

/** "use server" kaynağındaki yasak tip dışa aktarımları: [{ satir, neden }]. */
function denetle(kaynak) {
  const s = yorumsuz(kaynak);
  if (!USE_SERVER.test(s)) return [];

  const tipler = new Set();
  for (const m of s.matchAll(/^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:type|interface)[ \t]+([A-Za-z_$][\w$]*)/gm)) {
    tipler.add(m[1]);
  }
  for (const m of s.matchAll(/^[ \t]*import[ \t]+(type[ \t]+)?(?:[A-Za-z_$][\w$]*[ \t]*,[ \t]*)?\{([^}]*)\}/gm)) {
    for (const a of adlar(m[2])) {
      if (m[1] || /^type\s/.test(a)) tipler.add(a.replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim());
    }
  }

  const bulgular = [];
  for (const m of s.matchAll(/^[ \t]*export[ \t]+(type[ \t]*)?\{([^}]*)\}[ \t]*(from\b)?/gm)) {
    const satir = s.slice(0, m.index).split("\n").length;
    const liste = adlar(m[2]);
    if (m[1] && !m[3]) bulgular.push({ satir, neden: `kaynaksız export type { ${liste.join(", ")} }` });
    for (const a of liste) {
      if (/^type\s/.test(a)) bulgular.push({ satir, neden: `satır içi tip: export { ${a} }` });
      else if (!m[1] && !m[3] && tipler.has(a.split(/\s+as\s+/)[0].trim())) {
        bulgular.push({ satir, neden: `tip bağı değer gibi: export { ${a} }` });
      }
    }
  }
  return bulgular;
}

// ── Öz-sınama: kural seti bozulursa muhafız sessizce yeşil yanmasın.
const ORNEKLER = [
  ['"use server";\nimport { a, type T } from "x";\nexport type { T };', 1],
  ['"use server";\nexport { type T } from "x";', 1],
  ['"use server";\ntype T = 1;\nexport { T };', 1],
  ['"use server";\nexport type T = { a: 1 };', 0],
  ['"use server";\nexport type { T } from "x";', 0],
  ['import type { T } from "x";\nexport type { T };', 0],
];
for (const [kod, beklenen] of ORNEKLER) {
  if (denetle(kod).length !== beklenen) {
    console.error(`✗ öz-sınama düştü (beklenen ${beklenen}): ${JSON.stringify(kod)}`);
    process.exit(1);
  }
}

const dosyalar = [];
const gez = (d) => {
  for (const ad of readdirSync(path.join(ROOT, d))) {
    const g = path.join(d, ad);
    if (statSync(path.join(ROOT, g)).isDirectory()) gez(g);
    else if (/\.tsx?$/.test(ad)) dosyalar.push(g);
  }
};
DIZINLER.forEach(gez);

let useServer = 0;
const satirlar = [];
for (const f of dosyalar) {
  const kaynak = readFileSync(path.join(ROOT, f), "utf8");
  if (!USE_SERVER.test(yorumsuz(kaynak))) continue;
  useServer++;
  for (const b of denetle(kaynak)) satirlar.push(`  ✗ ${f.split(path.sep).join("/")}:${b.satir} — ${b.neden}`);
}

if (satirlar.length > 0) {
  console.log(satirlar.join("\n"));
  console.log(`\n✗ "USE SERVER" TİP MUHAFIZI — ${satirlar.length} bulgu (${useServer} "use server" dosyası tarandı).`);
  console.log('  Çözüm: satırı sil; tüketici tipi çekirdekten alsın → import type { X } from "@/lib/…"\n');
  process.exit(1);
}
console.log(`✓ "use server" tip muhafızı: ${useServer} dosya tarandı, tip dışa aktarımı yok.`);
