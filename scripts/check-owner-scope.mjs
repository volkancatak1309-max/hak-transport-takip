#!/usr/bin/env node
/**
 * PATRON GÖRÜNMEZLİĞİ MUHAFIZI (lib/owner-scope.ts, migration 045).
 *
 * NE YAPAR: is_owner OLMAYAN bir yöneticinin görebildiği KİMLİK YÜZEYLERİNDE
 * `workers` tablosuna giden ANAHTARSIZ liste okumalarını bulur ve patron
 * kapsamını uygulamayanlarda çıkış kodu 1 döner.
 *
 * NEDEN AYRI BİR BETİK: check-test-filters.mjs üç ekseni (test, filo, şoför)
 * denetliyor ve YEŞİL. Ona dokunup sayılarını oynatmak yerine dördüncü eksen
 * kendi kapısını taşıyor — kural değişirse tek dosya okunur.
 *
 * NEDEN GEREKLİ: kolonun (is_owner) ve kapsamın (owner-scope.ts) kendisi hiçbir
 * şey garanti etmez. Altı ay sonra yazılacak yeni bir "personeli listele"
 * sorgusu filtreyi unutur ve patron sessizce Çalışanlar sayfasına geri gelir.
 * Asıl koruma bu betiktir.
 *
 * ── Kural ──────────────────────────────────────────────────────────────────
 * Kapsanan bir dosyadaki her `workers` sorgusu şu üçünden BİRİNİ sağlamalı:
 *
 *   1. ANAHTARLI  — tek bir bilinen kaydı hedefler (.eq("id"...) / .maybeSingle()
 *                   / yazma). Bunlar liste değildir; korumaları ayrı yapılır
 *                   (sayfada notFound(), action'da assertOwnerWritable).
 *   2. FİLTRELİ   — yakınında withoutOwner( / dropOwnerRows( ya da açık bir
 *                   `// owner-filtered:` yorumu var.
 *   3. MUAF       — üstünde `// owner-visible: <gerekçe>` var. Gerekçe zorunlu.
 *
 * Kullanım:  node scripts/check-owner-scope.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { sep } from "node:path";

const ROOT = process.cwd();

/**
 * KİMLİK YÜZEYLERİ — "bu kişi bir kullanıcıdır" diyen listeler.
 *
 * İŞLETME/RAPOR yüzeyleri BİLEREK DIŞARIDA (vardiya geçmişi, AZG, CO₂, yakıt,
 * performans, mesafe, harita izleri). Gerekçe ölçümle verildi (08.08.2026,
 * canlı HAK61): patron `is_admin=true, counts_as_driver=false` olduğu için
 * lib/driver-scope.ts onu o yüzeylerin hepsinden ZATEN eliyor. Yarın muafiyet
 * açılırsa oraya filtre EKLENMEMELİ: AZG raporu Avusturya çalışma süresi
 * kaydıdır ve şirket antetiyle çıkar — direksiyona geçmiş birini rapordan
 * düşürmek raporu yanlış yapar. Ayrıntı: lib/owner-scope.ts başlığı.
 */
const OWNER_SURFACES = [
  "app/admin/workers/page.tsx",
  "app/admin/workers/[id]/page.tsx",
  "app/admin/telegram/page.tsx",
  "app/admin/izinler/page.tsx",
  "app/admin/seferler/page.tsx",
  "app/admin/araclar/page.tsx",
  "app/admin/araclar/[id]/page.tsx",
  "app/api/mobile/workers/route.ts",
  "app/api/mobile/workers/[id]/route.ts",
  "lib/security-read.ts",
];

/** Zincirde bunlardan biri varsa sorgu ANAHTARLI sayılır (liste değildir). */
const KEYED = [
  '.eq("id"',
  '.eq("phone"',
  '.eq("worker_id"',
  '.eq("assigned_worker_id"',
  '.in("id"',
  ".maybeSingle()",
  ".single()",
  ".insert(",
  ".update(",
  ".upsert(",
  ".delete(",
];

const FILTERED = ["withoutOwner(", "dropOwnerRows(", "// owner-filtered:"];

/**
 * Muafiyet işareti. `// test-filtered:` ya da `// driver-scoped:` BİLEREK
 * kabul edilmez: tek bir yorum iki bağımsız denetimi birden susturursa, test
 * muafiyeti yazan biri farkında olmadan patron denetimini de kapatır.
 */
const EXEMPT = "// owner-visible:";

/** Sorgunun başladığı satırdan itibaren zinciri toplar (ilk `;`'e kadar). */
function chainFrom(lines, start) {
  const buf = [];
  for (let i = start; i < Math.min(start + 25, lines.length); i++) {
    buf.push(lines[i]);
    if (lines[i].includes(";")) break;
  }
  return buf.join("\n");
}

/** Sorgudan ÖNCEKİ birkaç satır (yorumlar orada yaşıyor). */
function contextBefore(lines, start) {
  return lines.slice(Math.max(0, start - 8), start + 1).join("\n");
}

let taranan = 0;
let anahtarli = 0;
let filtreli = 0;
let muaf = 0;
const sizinti = [];

for (const rel of OWNER_SURFACES) {
  const abs = `${ROOT}${sep}${rel.split("/").join(sep)}`;
  if (!existsSync(abs)) {
    console.error(`✗ Kapsam listesindeki dosya YOK: ${rel}`);
    console.error("  (dosya taşındıysa listeyi güncelleyin — sessizce düşmesin)");
    process.exit(1);
  }
  const src = readFileSync(abs, "utf8");
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('.from("workers")')) continue;
    taranan++;
    const zincir = chainFrom(lines, i);
    const once = contextBefore(lines, i);
    const hepsi = `${once}\n${zincir}`;

    if (KEYED.some((k) => zincir.includes(k))) {
      anahtarli++;
      continue;
    }
    if (FILTERED.some((f) => hepsi.includes(f))) {
      filtreli++;
      continue;
    }
    if (once.includes(EXEMPT)) {
      muaf++;
      continue;
    }
    sizinti.push(`${rel}:${i + 1}`);
  }
}

if (sizinti.length > 0) {
  console.error("✗ PATRON SIZINTISI — kapsam uygulanmamış sorgular:\n");
  for (const s of sizinti) console.error(`   ${s}`);
  console.error(
    "\n  Düzeltme: sorguyu withoutOwner(...) ile sarın ya da gerçekten tüm\n" +
      "  personel görünmeliyse üstüne `// owner-visible: <gerekçe>` yazın.\n" +
      "  Gerekçesiz muafiyet kabul edilmez."
  );
  process.exit(1);
}

console.log(
  `✓ patron muhafızı: ${OWNER_SURFACES.length} kimlik yüzeyi · ${taranan} workers sorgusu ` +
    `(${anahtarli} anahtarlı · ${filtreli} filtreli · ${muaf} gerekçeli muaf). Kapsamsız liste yok.`
);
