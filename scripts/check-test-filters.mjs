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
const GUARDED = [
  "workers",
  "vehicles",
  "time_entries",
  // 28.07.2026'da EKLENDİ. Üçlü liste yeterli sanılıyordu; app/admin/page.tsx'teki
  // driver_reports sorgusu ne test ne filo kapsamı taşıyordu ve muhafız onu HİÇ
  // görmüyordu — filo şefi karşı filonun bildirimini konum linkiyle görebiliyordu.
  // Ders time_entries'te bir kez öğrenilmişti (yukarıdaki nota bak) ama liste
  // yalnız o tabloyla genişletilmişti. Kural: ŞOFÖR ya da ARAÇ eksenli, yönetici
  // yüzeyinde okunan her tablo bu listeye girer.
  "driver_reports",
  "vehicle_events",
  "idle_episodes",
  "worker_leaves",
];

/** Zincirde bunlardan biri varsa sorgu ANAHTARLI sayılır. */
const KEYED = [
  '.eq("id"',
  '.eq("phone"',
  '.eq("worker_id"',
  '.eq("vehicle_id"',
  '.eq("assigned_worker_id"',
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

/** Bunlardan biri geçiyorsa sorgu test verisine karşı FİLTRELİ sayılır. */
const FILTERED = ["withoutTestRows(", "dropTestRows(", "// test-filtered:"];

/**
 * FİLO KAPSAMI (migration 029). Filo şefi yalnız kendi filosunu görür; bir
 * sorgu kapsamı uygulamayı unutursa şef KARŞI FİLOYU görür. Test verisi
 * sızıntısında yaşadığımız hatanın birebir aynısı, bu yüzden aynı muhafız.
 *
 * Yalnız FİLO YÜZEYLERİ denetlenir: filo şefinin erişebildiği iki sayfa ve
 * onları besleyen paylaşılan fonksiyonlar. Diğer yönetici sayfaları
 * requireAdmin() ile zaten şefe kapalı, oralarda kapsam GEREKMEZ.
 */
const FLEET_SURFACES = [
  "app/admin/page.tsx",
  "app/admin/harita/page.tsx",
  "lib/admin-dashboard.ts",
  // Geçici araç seçicisi burada yaşıyor (22.07.2026). Filo kapsamı BİLEREK
  // uygulanmıyor ama bu kararın gerekçelendirilmiş olması gerekiyor —
  // denetime dahil, istisna `// fleet-scoped:` ile yazılı.
  "lib/vehicles.ts",
];
const FLEET_FILTERED = ["onlyFleet(", "dropOtherFleets(", "// fleet-scoped:"];

/**
 * ŞOFÖR KAPSAMI (28.07.2026, lib/driver-scope.ts). `workers` tablosu TÜM
 * personeli tutar; yöneticiler şoför DEĞİLDİR. Bir şoför yüzeyi kapsamı
 * uygulamayı unutursa yönetici hesapları sayaca, sıralamaya ve skora karışır —
 * Analiz sayfası tam olarak bunu yapıyordu ("ŞOFÖR 33", gerçek 30).
 *
 * Filo kapsamıyla AYNI mantık, ayrı eksen: orada "kim görüyor", burada
 * "kim sayılıyor".
 *
 * Yalnız ŞOFÖR SAYAN/LİSTELEYEN yüzeyler denetlenir. Çalışanlar sayfası,
 * personel dosyası, giriş ve PIN akışları BİLEREK dışarıda:
 * oralarda yönetici GÖRÜNMEYE DEVAM ETMELİ (kural: "yönetici personeldir,
 * şoför değildir"). Listeye eklenen her yeni dosya, o dosyadaki ANAHTARSIZ
 * `workers`/`time_entries` okumalarının şoför kapsamını uygulamasını zorunlu
 * kılar.
 */
const DRIVER_SURFACES = [
  "lib/analytics.ts",
  "lib/reports.ts",
  "lib/admin-dashboard.ts",
  "app/admin/page.tsx",
  "app/admin/harita/page.tsx",
  "app/admin/izinler/page.tsx",
  "app/admin/seferler/page.tsx",
  "app/admin/araclar/page.tsx",
  "app/admin/araclar/[id]/page.tsx",
  "app/actions/azg-report.ts",
];
/**
 * `// driver-scoped:` işareti "bu sorguda şoför kapsamı BİLİNÇLİ olarak ele
 * alındı" demektir — ya uygulandı (eleme başka satırda/dönüşte yapılıyor) ya da
 * gerekçesiyle uygulanmadı (ör. araç eksenli bir raporun isim etiketi sözlüğü).
 * Gerekçe yazmak zorunlu; işaretin tek başına anlamı yok.
 */
const DRIVER_FILTERED = ["onlyDrivers(", "dropNonDrivers(", "// driver-scoped:"];

/**
 * Şoför kuralının KENDİ muafiyet işareti. `// test-visible:` BİLEREK kabul
 * edilmez: tek bir yorum iki bağımsız denetimi birden susturursa, test
 * muafiyeti yazan biri farkında olmadan şoför denetimini de kapatır. Her kural
 * kendi gerekçesini ister.
 */
const DRIVER_EXEMPT = /\/\/\s*driver-scoped:\s*\S/;

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
/** Şoför kuralının GERÇEKTEN baktığı sorgu sayısı — yalnız DRIVER_SURFACES. */
let driverChecked = 0;

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

      const rel = relative(ROOT, file).split(sep).join("/");

      // ── 1) Test verisi kapsamı ─────────────────────────────────────────
      const testOk =
        EXEMPT.test(before) ||
        FILTERED.some((f) => wide.includes(f)) ||
        KEYED.some((k) => stmt.includes(k));
      if (!testOk) {
        findings.push({ file: rel, line: i + 1, table, kind: "test", snippet: lines[i].trim() });
      }

      // ── 2) Şoför kapsamı ───────────────────────────────────────────────
      // Yalnız şoför SAYAN/LİSTELEYEN yüzeylerde ve yalnız ANAHTARSIZ liste
      // okumalarında aranır. `vehicles` hariç: o araç ekseni, şoför değil.
      // `// test-visible:` BURADA muaf tutmaz (bkz. DRIVER_EXEMPT); yalnız
      // `// driver-scoped:` susturur ve gerekçe yazmak zorunludur.
      if (DRIVER_SURFACES.includes(rel) && table !== "vehicles") {
        driverChecked++;
        if (
          !DRIVER_EXEMPT.test(before) &&
          !KEYED.some((k) => stmt.includes(k)) &&
          !DRIVER_FILTERED.some((f) => wide.includes(f))
        ) {
          findings.push({ file: rel, line: i + 1, table, kind: "driver", snippet: lines[i].trim() });
        }
      }

      // ── 3) Filo kapsamı ────────────────────────────────────────────────
      // Yalnız filo şefinin gördüğü yüzeylerde ve yalnız ANAHTARSIZ liste
      // okumalarında aranır.
      if (!FLEET_SURFACES.includes(rel)) continue;
      if (EXEMPT.test(before)) continue;
      if (KEYED.some((k) => stmt.includes(k))) continue;
      if (FLEET_FILTERED.some((f) => wide.includes(f))) continue;
      findings.push({ file: rel, line: i + 1, table, kind: "fleet", snippet: lines[i].trim() });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `✓ kapsam muhafızı: test verisi ${checked} sorgu · şoför ${driverChecked} sorgu ` +
      `(${DRIVER_SURFACES.length} yüzey) · filo ${FLEET_SURFACES.length} yüzey. Filtresiz sorgu yok.`
  );
  process.exit(0);
}

const testFindings = findings.filter((f) => f.kind === "test");
const driverFindings = findings.filter((f) => f.kind === "driver");
const fleetFindings = findings.filter((f) => f.kind === "fleet");

function dump(list) {
  for (const f of list) {
    console.error(`  ${f.file}:${f.line}  (${f.table})`);
    console.error(`      ${f.snippet}`);
  }
}

if (testFindings.length) {
  console.error(
    `\n✗ TEST VERİSİ SIZINTI RİSKİ — ${testFindings.length} anahtarsız liste sorgusu test kayıtlarını elemiyor:\n`
  );
  dump(testFindings);
  console.error(`
  Çözüm: withoutTestRows(query, "id"|"worker_id"|"vehicle_id", scope.*)
         ya da dropTestRows(rows, pick, scope)   [lib/test-data.ts]
         Bilinçli istisnaysa: // test-visible: <gerekçe>
`);
}

if (driverFindings.length) {
  console.error(
    `\n✗ ŞOFÖR KAPSAMI EKSİK — ${driverFindings.length} sorgu yönetici hesaplarını elemiyor.\n` +
      `  Bu yüzeyler ŞOFÖR sayar/listeler; yönetici karışırsa sayaç ve sıralama şişer.\n`
  );
  dump(driverFindings);
  console.error(`
  Çözüm: onlyDrivers(query, "id"|"worker_id", driverScope)
         ya da dropNonDrivers(rows, pickWorkerId, driverScope)   [lib/driver-scope.ts]
         Bilinçli istisnaysa: // driver-scoped: <gerekçe>
         (// test-visible: burada MUAF TUTMAZ — her kural kendi gerekçesini ister)
`);
}

if (fleetFindings.length) {
  console.error(
    `\n✗ FİLO SIZINTI RİSKİ — ${fleetFindings.length} sorgu filo kapsamını uygulamıyor.\n` +
      `  Filo şefi bu sorgular üzerinden KARŞI FİLOYU görür.\n`
  );
  dump(fleetFindings);
  console.error(`
  Çözüm: onlyFleet(query, "vehicle_id"|"id"|"worker_id", fleetScope.*, fleetScope)
         ya da dropOtherFleets(rows, pick, fleetScope)   [lib/fleet-scope.ts]
         Bilinçli istisnaysa: // fleet-scoped: <gerekçe>
`);
}

process.exit(1);
