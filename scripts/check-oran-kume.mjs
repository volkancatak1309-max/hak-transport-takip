#!/usr/bin/env node
/**
 * ORAN KÜME MUHAFIZI — pay ve payda aynı kümeden gelmeli.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * 31.08.2026'da CO₂ panosunda ölçüldü: `kg` toplamı `kg !== null` araçlardan
 * (24 araç), `km` toplamı AYNI listeden ama `a.km ?? 0` ile — yani km'si
 * olmayan araç **kg'sini paya ekliyor, km'sini paydaya eklemiyordu**.
 * Sonuç: 286,3 g/km yerine 268,3 → **%6,7 şişik**, ve aynı ekranın trend
 * grafiği farklı sayı gösteriyordu. Ayrıntı: `docs/ORAN-KUME-KURALI.md`.
 *
 * Bu bir sayı sorunu değil, MANTIK sorunu: kaç araç olduğu önemsiz, 10'da da
 * 1000'de de, araçların yarısı bakımdayken de aynı hata çıkar.
 *
 * ── NEYİ YAKALAR ──────────────────────────────────────────────────────────
 * `reduce(… ?? 0)` / `reduce(… || 0)` ile üretilen bir toplam, aynı dosyada
 * bir BÖLMEDE ya da bilinen bir oran yardımcısında kullanılıyorsa bulgu verir.
 * `?? 0` orada "bu değer yoksa 0 say" demektir; oranın bir ucunda bu yapılıp
 * diğerinde yapılmazsa kümeler ayrışır ve oran sessizce bozulur.
 *
 * ── BİLİNÇLİ İSTİSNA ──────────────────────────────────────────────────────
 * Küme zaten filtrelenmişse `?? 0` yalnız tür kapısıdır ve güvenlidir. O
 * durumda satırın kendisine ya da üstündeki 6 satıra gerekçe yaz:
 *
 *     // oran-kume: küme yukarıda filtrelendi, ?? 0 yalnız tür kapısı
 *
 * Gerekçesiz muafiyet yok — yorum metni boş olamaz.
 *
 * Kullanım: node scripts/check-oran-kume.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = process.cwd();
const TARANAN = ["lib", "app"];
const UZANTI = /\.(ts|tsx)$/;

/** Oran ürettiği bilinen yardımcılar — bölme kadar tehlikeli. */
const ORAN_YARDIMCILARI = ["gPerKm", "ratio", "per100", "perKm", "yuzde", "oran"];

/** `reduce(...)` içinde `?? 0` ya da `|| 0` — küme sızıntısının klasik izi. */
const REDUCE_SIFIR = /\breduce\s*\(/;
const SIFIR_KAPANI = /(\?\?|\|\|)\s*0\b/;
/** `const ad =` / `let ad =` — toplamın adını almak için. */
const ATAMA = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/;
const MUAFIYET = /\/\/\s*oran-kume:\s*\S+/;

function dosyalar(dizin) {
  const out = [];
  for (const ad of readdirSync(dizin)) {
    if (ad === "node_modules" || ad === ".next" || ad.startsWith(".")) continue;
    const tam = join(dizin, ad);
    const st = statSync(tam);
    if (st.isDirectory()) out.push(...dosyalar(tam));
    else if (UZANTI.test(ad)) out.push(tam);
  }
  return out;
}

/** `ad` bu dosyada bölmede ya da oran yardımcısında geçiyor mu. */
function orandaKullaniliyor(satirlar, ad, tanimSatiri) {
  const kacis = ad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bolme = new RegExp(`(/\\s*\\(?\\s*${kacis}\\b)|(\\b${kacis}\\s*\\)?\\s*/[^/*])`);
  const yardimci = new RegExp(
    `(${ORAN_YARDIMCILARI.join("|")})\\s*\\([^)]*\\b${kacis}\\b`,
    "i"
  );
  for (let i = 0; i < satirlar.length; i++) {
    if (i === tanimSatiri) continue;
    const s = satirlar[i];
    if (s.trimStart().startsWith("//") || s.trimStart().startsWith("*")) continue;
    if (bolme.test(s) || yardimci.test(s)) return i + 1;
  }
  return null;
}

const bulgular = [];
for (const kok of TARANAN) {
  let hedef;
  try {
    hedef = statSync(join(KOK, kok)).isDirectory() ? dosyalar(join(KOK, kok)) : [];
  } catch {
    continue;
  }
  for (const dosya of hedef) {
    const ham = readFileSync(dosya, "utf8");
    if (!REDUCE_SIFIR.test(ham)) continue;
    const satirlar = ham.split(/\r?\n/);
    for (let i = 0; i < satirlar.length; i++) {
      const satir = satirlar[i];
      if (!REDUCE_SIFIR.test(satir) || !SIFIR_KAPANI.test(satir)) continue;

      // Muafiyet: bu satır ya da üstündeki ALTI satır. Altı, çünkü gerekçe çok
      // satırlı olur ve arada `const ad = …` gibi satırlar bulunur; dar pencere
      // gerçek gerekçeyi kaçırıp yanlış bulgu üretiyordu.
      const pencere = satirlar.slice(Math.max(0, i - 6), i + 1).join("\n");
      if (MUAFIYET.test(pencere)) continue;

      // Toplamın adı — aynı satırda ya da bir üstte
      const m = ATAMA.exec(satir) ?? ATAMA.exec(satirlar[i - 1] ?? "");
      if (!m) continue;
      const ad = m[1];

      const kullanim = orandaKullaniliyor(satirlar, ad, i);
      if (kullanim === null) continue;

      bulgular.push({
        dosya: relative(KOK, dosya).replace(/\\/g, "/"),
        satir: i + 1,
        ad,
        kullanim,
        metin: satir.trim().slice(0, 100),
      });
    }
  }
}

if (bulgular.length === 0) {
  console.log("✓ ORAN KÜMESİ — `?? 0` ile toplanıp orana giren değer yok");
  process.exit(0);
}

console.log(`\n✗ ORAN KÜME RİSKİ — ${bulgular.length} bulgu\n`);
console.log("  Bir oranın payı ve paydası AYNI kümeden gelmeli. `?? 0` ile");
console.log("  toplanan bir değer oranda kullanılıyorsa, o kümeye ait olmayan");
console.log("  satırlar bir ucu şişirip diğerini şişirmiyor olabilir.\n");
for (const b of bulgular) {
  console.log(`  ${b.dosya}:${b.satir}  (${b.ad} → satır ${b.kullanim}'de oranda)`);
  console.log(`      ${b.metin}`);
}
console.log("\n  Çözüm: oranı, İKİ değerin de ölçüldüğü kümeden hesapla.");
console.log("         Küme dinamiktir — filtreyle türet, sabit sayı yazma.");
console.log("  Bilinçli istisnaysa gerekçe yaz:");
console.log("         // oran-kume: <küme neden zaten güvenli>\n");
process.exit(1);
