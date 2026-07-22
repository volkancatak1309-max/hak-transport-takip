#!/usr/bin/env node
/**
 * TEST VERİSİ SIZINTI MUHAFIZI (migration 028 / lib/test-data.ts).
 *
 * NE YAPAR: `workers` ya da `vehicles` tablosuna giden HER sorguyu bulur ve
 * ANAHTARSIZ liste okuması olanların test kayıtlarını eleyip elemediğine bakar.
 * Elemiyorsa çıkış kodu 1 — yani `npm run lint:test-filters` (ve dolayısıyla
 * `npm run verify`) kırılır.
 *
 * NEDEN VAR: is_test kolonunun kendisi hiçbir şeyi garanti etmez. Altı ay sonra
 * yazılacak yeni bir "araçları listele" sorgusu filtreyi unutur ve test kaydı
 * sessizce panoya, rapora, PDF'e sızar. Asıl koruma bu betiktir; kolon yalnız
 * onun dayanağı.
 *
 * ── Kural ──────────────────────────────────────────────────────────────────
 * Bir sorgu şu üç durumdan BİRİNİ sağlamalı:
 *
 *   1. ANAHTARLI  — zincirinde .eq("id"/"phone"/"worker_id"/... ya da .in("id")
 *                   ya da .maybeSingle()/.single() var; veya bir yazma işlemi
 *                   (insert/update/upsert/delete). Bunlar tek bir bilinen
 *                   kaydı hedefler; filtre koymak test hesabını KIRAR.
 *   2. FİLTRELİ   — yakınında withoutTestRows( / dropTestRows( ya da açık bir
 *                   `// test-filtered:` yorumu var.
 *   3. MUAF       — sorgunun hemen üstünde `// test-visible: <gerekçe>` yorumu
 *                   var. Bilinçli istisnalar için; gerekçe yazmak zorunlu.
 *
 * Hiçbiri yoksa: SIZINTI ADAYI → hata.
 *
 * Kullanım:  node scripts/check-test-filters.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib"];
const EXT = /\.(ts|tsx)$/;

/**
 * Bu tablolara giden sorgular denetlenir.
 *
 * `time_entries` 22.07.2026'da EKLENDİ: yalnız workers/vehicles denetlenirken
 * app/admin/page.tsx'teki "Kapanmamış Vardiyalar" sorgusu (ikinci, ayrı bir
 * time_entries okuması) gözden kaçtı ve test vardiyası yönetici panosunda
 * göründü. Test kaydı üç tablodan da sızabilir.
 */
const GUARDED = ["workers", "vehicles", "time_entries"];

/** Zincirde bunlardan biri varsa sorgu ANAHTARLI sayılır. */
const KEYED = [
  '.eq("id"',
  '.eq("phone"',
  '.eq("worker_id"',
  '.eq("vehicle_id"',
  '.eq("assigned_worker_id"',
  '.eq("telegram_chat_id"',
  '.eq("plate"',
  '.eq("imei"',
  '.eq("flespi_device_id"',
  '.in("id"',
  '.in("imei"',
  '.in("phone"',
  ".eq(field,",
  ".maybeSingle()",
  ".single()",
  ".insert(",
  ".update(",
  ".upsert(",
  ".delete(",
];

/** Bunlardan biri geçiyorsa sorgu FİLTRELİ sayılır. */
const FILTERED = ["withoutTestRows(", "dropTestRows(", "// test-filtered:"];

/** Muafiyet yorumu. Gerekçe zorunlu: `// test-visible: <neden>`. */
const EXEMPT = /\/\/\s*test-visible:\s*\S/;

/** Sorgu zincirinin kaç satır ileriye kadar taranacağı. */
const LOOKAHEAD = 26;
/** Sarmalayan çağrı (withoutTestRows(...)) ve yorumlar için kaç satır geriye. */
const LOOKBEHIND = 8;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

const findings = [];
let checked = 0;

for (const d of SCAN_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const table = GUARDED.find((t) => lines[i].includes(`.from("${t}")`));
      if (!table) continue;
      checked++;

      // ── İFADE penceresi (KEYED için) ───────────────────────────────────
      // YALNIZ bu sorgunun kendi zinciri: .from() satırından ifade sonuna (`;`)
      // kadar. Geriye BAKMAZ — aksi hâlde bir önceki fonksiyonun `.in("id")`
      // filtresi bu sorguyu yanlışlıkla "anahtarlı" gösteriyordu (canlı yakalandı).
      let end = i;
      for (let j = i; j < Math.min(lines.length, i + LOOKAHEAD); j++) {
        end = j;
        if (/;\s*$/.test(lines[j])) break;
      }
      const stmt = lines.slice(i, end + 1).join("\n");

      // ── Geri pencere (EXEMPT için) ─────────────────────────────────────
      // Yalnız ifadenin hemen üstündeki yorum bloğu. Boş satıra, blok sınırına
      // ya da bir önceki ifadenin sonuna varınca durur.
      let bStart = i;
      for (let j = i - 1; j >= 0 && i - j <= LOOKBEHIND; j--) {
        const t = lines[j].trim();
        if (t === "") break;
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
          bStart = j;
          continue;
        }
        if (/[;{}]$/.test(t)) break;
        bStart = j;
      }
      const before = lines.slice(bStart, i + 1).join("\n");

      // ── Geniş pencere (FILTERED için) ──────────────────────────────────
      // Eleme sorgudan SONRA gelebilir (dropTestRows satırları çektikten sonra
      // çalışır); sarmalayan withoutTestRows( ise ÖNCE gelir.
      const wide = lines
        .slice(Math.max(0, i - LOOKBEHIND), Math.min(lines.length, end + 6))
        .join("\n");

      if (EXEMPT.test(before)) continue;
      if (FILTERED.some((f) => wide.includes(f))) continue;
      if (KEYED.some((k) => stmt.includes(k))) continue;

      findings.push({
        file: relative(ROOT, file).split(sep).join("/"),
        line: i + 1,
        table,
        snippet: lines[i].trim(),
      });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `✓ test-filtre muhafızı: ${checked} sorgu denetlendi, anahtarsız+filtresiz sorgu yok.`
  );
  process.exit(0);
}

console.error(
  `\n✗ TEST VERİSİ SIZINTI RİSKİ — ${findings.length} anahtarsız liste sorgusu test kayıtlarını elemiyor:\n`
);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  (${f.table})`);
  console.error(`      ${f.snippet}`);
}
console.error(`
Çözüm — üçünden biri:
  1) Liste okumasıysa  → withoutTestRows(query, "id"|"worker_id"|"vehicle_id", scope.*)
                          ya da dropTestRows(rows, pick, scope)   [lib/test-data.ts]
  2) Tek kaydı hedefliyorsa (id/phone ile) → zaten güvenli; anahtar filtresini ekle.
  3) Bilinçli istisnaysa → sorgunun üstüne  // test-visible: <gerekçe>
`);
process.exit(1);
