#!/usr/bin/env node
/**
 * TELEMETRİ SINIR MUHAFIZI — ham cihaz okuması filtresiz kullanılmasın.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * 31.08.2026'da ölçüldü: cihaz tekil bozuk odometre bildiriyor (114 sıfır +
 * 123 monotonluk ihlali / 1,8M satır). `telemetry_month_spans` ham `min`/`max`
 * aldığı için tek bozuk satır ayın açıklığını götürüyordu:
 *   ölçülebilen araç 23 → 26 · DO-777GS km 36.187 → 1.141 (%3.070 hata)
 * O yanlış değer makullük kapısından GEÇİYORDU — yani sessizdi.
 * Ayrıntı: `docs/BOZUK-TELEMETRI.md`.
 *
 * ── NEYİ YAKALAR ──────────────────────────────────────────────────────────
 * ① SQL'de `min(odometer_km)` / `max(odometer_km)` — ham uç değer, bozuk
 *    okumaya en açık kalıp. 096 bunu pencere fonksiyonlu filtreyle değiştirdi.
 * ② TS/TSX'te `odometer_km` okuyup açıklık hesaplayan (`-` ile çıkaran) kod
 *    `lib/odometre.ts` yardımcılarını kullanmıyorsa.
 *
 * ── BİLİNÇLİ İSTİSNA ──────────────────────────────────────────────────────
 * Tek bir anlık okuma (bakım km'si, vardiya açılış sayacı) açıklık değildir
 * ve seri gerektirmez. O durumda gerekçe yaz:
 *
 *     // telemetri-sinir: tek anlik okuma, aciklik hesabi degil
 *     -- telemetri-sinir: <gerekçe>            (SQL için)
 *
 * Gerekçesiz muafiyet yok. Pencere 8 satır.
 *
 * Kullanım: node scripts/check-telemetri-siniri.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = process.cwd();
const TARANAN = ["lib", "app", "db/migrations"];
const UZANTI = /\.(ts|tsx|sql)$/;
const MUAFIYET = /(\/\/|--)\s*telemetri-sinir:\s*\S+/;

/** Ham uç değer alan SQL kalıbı. */
const SQL_UC = /\b(min|max)\s*\(\s*(?:\w+\.)?odometer_km\s*\)/i;
/** Odometre okuyup fark alan TS kalıbı. */
const TS_FARK = /odometer_km/;
const TS_CIKARMA = /\b\w*(?:odo|km)\w*\s*[-–]\s*\w*(?:odo|km)\w*\b/i;

function dosyalar(dizin) {
  const out = [];
  let girisler;
  try { girisler = readdirSync(dizin); } catch { return out; }
  for (const ad of girisler) {
    if (ad === "node_modules" || ad === ".next" || ad.startsWith(".")) continue;
    const tam = join(dizin, ad);
    const st = statSync(tam);
    if (st.isDirectory()) out.push(...dosyalar(tam));
    else if (UZANTI.test(ad)) out.push(tam);
  }
  return out;
}

/**
 * Bir SQL fonksiyonu birden çok migration'da tanımlanmış olabilir; ÇALIŞAN
 * tanım EN YÜKSEK numaralı olandır. Eski migration'lar tarihî kayıttır ve
 * düzeltilmez — düzeltme yeni migration yazılarak yapılır (096 tam bunu yaptı).
 * Bu yüzden yalnız en yeni tanım denetlenir; eskiler muaf.
 */
function enYeniTanimlar(hepsi) {
  const enYeni = new Map();
  for (const dosya of hepsi) {
    const yol = relative(KOK, dosya).replace(/\\/g, "/");
    if (!yol.startsWith("db/migrations/")) continue;
    const no = Number(/^(\d+)_/.exec(yol.split("/").pop() ?? "")?.[1] ?? -1);
    for (const m of readFileSync(dosya, "utf8").matchAll(
      /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/gi
    )) {
      const ad = m[1].toLowerCase();
      const onceki = enYeni.get(ad);
      if (!onceki || no > onceki.no) enYeni.set(ad, { no, yol });
    }
  }
  return enYeni;
}

/**
 * Bir SQL satırının hangi fonksiyon gövdesinde olduğu: yukarı doğru en yakın
 * `create or replace function`. Eskimişlik DOSYA değil FONKSİYON bazındadır —
 * 090 hem `telemetry_month_spans` (096'da yenilendi) hem `purge_*` (hâlâ
 * güncel) tanımlıyor; dosyayı toptan muaf tutmak ikincisini de kör ederdi.
 */
function satirinFonksiyonu(satirlar, i) {
  for (let j = i; j >= 0; j--) {
    const m = /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/i.exec(satirlar[j]);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

const enYeniTanim = enYeniTanimlar(TARANAN.flatMap((k) => dosyalar(join(KOK, k))));

const bulgular = [];
for (const kok of TARANAN) {
  for (const dosya of dosyalar(join(KOK, kok))) {
    const yol = relative(KOK, dosya).replace(/\\/g, "/");
    // Kuralın kendi evi muaf.
    if (yol === "lib/odometre.ts") continue;
    const ham = readFileSync(dosya, "utf8");
    if (!TS_FARK.test(ham)) continue;
    const satirlar = ham.split(/\r?\n/);
    const sql = yol.endsWith(".sql");

    for (let i = 0; i < satirlar.length; i++) {
      const s = satirlar[i];
      const yorum = s.trimStart().startsWith("//") || s.trimStart().startsWith("*") || s.trimStart().startsWith("--");
      if (yorum) continue;

      let tur = null;
      if (sql && SQL_UC.test(s)) tur = "SQL ham uç değer";
      else if (!sql && TS_FARK.test(s) && TS_CIKARMA.test(s)) tur = "TS açıklık hesabı";
      if (!tur) continue;

      // Eskimiş tanım tarihî kayıttır: aynı fonksiyonu daha yeni bir
      // migration yeniden tanımlamışsa bu satır artık çalışmıyor.
      if (sql) {
        const fn = satirinFonksiyonu(satirlar, i);
        const yeni = fn ? enYeniTanim.get(fn) : null;
        if (yeni && yeni.yol !== yol) continue;
      }

      const pencere = satirlar.slice(Math.max(0, i - 8), i + 1).join("\n");
      if (MUAFIYET.test(pencere)) continue;
      // lib/odometre.ts kullanan dosya zaten kuraldan geçiyor.
      if (!sql && /from ["']@\/lib\/odometre["']/.test(ham)) continue;

      bulgular.push({ yol, satir: i + 1, tur, metin: s.trim().slice(0, 96) });
    }
  }
}

if (bulgular.length === 0) {
  console.log("✓ TELEMETRİ SINIRI — ham odometre uç değeri filtresiz kullanılmıyor");
  process.exit(0);
}

console.log(`\n✗ TELEMETRİ SINIR RİSKİ — ${bulgular.length} bulgu\n`);
console.log("  Cihaz tekil bozuk okuma bildiriyor (ölçüldü: 114 sıfır + 123");
console.log("  monotonluk ihlali). Ham uç değer alan kod, tek bozuk satırdan");
console.log("  yanlış açıklık üretir ve bu SESSİZ olur.\n");
for (const b of bulgular) {
  console.log(`  ${b.yol}:${b.satir}  [${b.tur}]`);
  console.log(`      ${b.metin}`);
}
console.log("\n  Çözüm: seriyi `lib/odometre.ts` → odometreSpani() ile temizle,");
console.log("         SQL'de 096'daki pencere filtresini kullan.");
console.log("  Tek anlık okuma ise gerekçe yaz:");
console.log("         // telemetri-sinir: <neden aciklik degil>\n");
process.exit(1);
