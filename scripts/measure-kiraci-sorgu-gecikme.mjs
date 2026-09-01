#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — GECİKME ÖLÇÜMÜ (SALT OKUMA).
 *
 * Amaç: yönlendirme servisinin ZAMAN AŞIMI değerini tahminle değil ölçümle
 * seçmek. Yanlış seçilirse iki yönden de zarar var:
 *   • çok kısa → yavaş ama sağlıklı bir kiracı "bilinmiyor" sayılır, o kiracının
 *     personeli giriş yapamaz;
 *   • çok uzun → tek bir arızalı kiracı, TÜM girişleri kendi süresi kadar
 *     bekletir (paralel sorulsa bile toplam süreyi en yavaş kiracı belirler).
 *
 * ── ÖLÇÜMÜN AYRIŞTIRILMASI ────────────────────────────────────────────────
 * Buradan yapılan ölçüm ev internetinin gidiş-dönüşünü DE içerir; gerçek
 * çağıran ise Vercel'de koşan bir fonksiyon ve kiracılarla aynı bölgede.
 * Ham toplam süre bu yüzden yanıltıcıdır. İki yol ayrı ayrı ölçülür:
 *
 *   401 yolu (yanlış sır) : sır kapısında çıkar — DB YOK, gövde bile
 *                           ayrıştırılmaz. Ölçtüğü şey ≈ AĞ + soğuk/sıcak
 *                           fonksiyon maliyeti.
 *   200 yolu (doğru sır)  : üstüne BİR Supabase sorgusu biner.
 *
 *   (200 − 401) = kiracının kendi içindeki gerçek iş = ağdan BAĞIMSIZ.
 *
 * Servisin bütçesi bu farkın üstüne, sunucu-sunucu (aynı bölge) küçük bir ağ
 * payı ve soğuk başlangıç marjı eklenerek kurulur.
 *
 * ── HIZ SINIRINA TAKILMAMAK İÇİN ──────────────────────────────────────────
 * 200 yolunda her örnek FARKLI bir kayıtsız numara kullanır: numara başına kova
 * 20/dk ve tek örnekle dolmaz. 401 yolu hiç kova tüketmez (sır kapısı hız
 * sınırından ÖNCE çıkar).
 *
 * ⚠️ SALT OKUMA. Yazma yok, kayıtlı numara kullanılmaz.
 *
 * Kullanım:
 *   SIRLAR_ENV=<depo disi>/sirlar.env \
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/measure-kiraci-sorgu-gecikme.mjs
 */
import { readFileSync } from "node:fs";

const sirlar = Object.fromEntries(
  readFileSync(process.env.SIRLAR_ENV, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const KIRACILAR = [
  { ad: "HAK61", url: "https://hak-transport-takip.vercel.app", sir: sirlar.HAK61_SIR },
  { ad: "Sendigo", url: "https://sendigo-delta.vercel.app", sir: sirlar.SENDIGO_SIR },
  { ad: "galzura-demo", url: "https://demo.galzura.com", sir: sirlar.DEMO_SIR },
];

const N = 40;

async function olc(url, sir, telefon) {
  const t0 = process.hrtime.bigint();
  try {
    const res = await fetch(`${url}/api/mobile/kiraci-sorgu`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sir}` },
      body: JSON.stringify({ telefon }),
      signal: AbortSignal.timeout(30_000),
    });
    await res.text();
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.status };
  } catch (e) {
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: `hata: ${e.message ?? e}` };
  }
}

const p = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))];
};
const f = (n) => n.toFixed(0).padStart(5);

console.log(`── GECİKME · n=${N}/yol/kiracı · ölçüm YERİ: ev interneti (üst sınır) ──\n`);
console.log(
  `${"kiracı".padEnd(14)} ${"yol".padEnd(20)} ${"p50".padStart(6)}${"p90".padStart(7)}` +
    `${"p95".padStart(7)}${"p99".padStart(7)}${"max".padStart(7)}`
);
console.log("─".repeat(70));

const ozet = {};
for (const k of KIRACILAR) {
  const yollar = {};
  // 401 — sır kapısı, DB yok, hız sınırı tüketmez.
  yollar["401 (sır kapısı, DB yok)"] = [];
  // 200 — bir Supabase sorgusu. Her örnek FARKLI kayıtsız numara.
  yollar["200 (+1 Supabase sorgusu)"] = [];

  for (let i = 0; i < N; i++) {
    const yanlisSir = k.sir.slice(0, -1) + (k.sir.slice(-1) === "0" ? "1" : "0");
    const a = await olc(k.url, yanlisSir, "+436600000042");
    if (a.status === 401) yollar["401 (sır kapısı, DB yok)"].push(a.ms);

    // 1000'den başlayan, kayıtlı olmayan numaralar — her biri ayrı kova.
    const b = await olc(k.url, k.sir, `+4366000${String(1000 + i)}`);
    if (b.status === 200) yollar["200 (+1 Supabase sorgusu)"].push(b.ms);
  }

  for (const [ad, a] of Object.entries(yollar)) {
    if (!a.length) {
      console.log(`${k.ad.padEnd(14)} ${ad.padEnd(20)}  ÖRNEK YOK`);
      continue;
    }
    console.log(
      `${k.ad.padEnd(14)} ${ad.padEnd(20)} ${f(p(a, 0.5))}${f(p(a, 0.9))}` +
        `${f(p(a, 0.95))}${f(p(a, 0.99))}${f(Math.max(...a))}`
    );
  }
  ozet[k.ad] = {
    kapi: yollar["401 (sır kapısı, DB yok)"],
    tam: yollar["200 (+1 Supabase sorgusu)"],
  };
}

console.log("\n── AYRIŞTIRMA: kiracının KENDİ işi (ağdan bağımsız) ──");
console.log(`${"kiracı".padEnd(14)} ${"p50 farkı".padStart(11)} ${"p95 farkı".padStart(11)} ${"max farkı".padStart(11)}`);
console.log("─".repeat(52));
let enKotuFark = 0;
let enKotuTam = 0;
for (const [ad, o] of Object.entries(ozet)) {
  if (!o.kapi.length || !o.tam.length) continue;
  const d50 = p(o.tam, 0.5) - p(o.kapi, 0.5);
  const d95 = p(o.tam, 0.95) - p(o.kapi, 0.95);
  const dmax = Math.max(...o.tam) - Math.max(...o.kapi);
  enKotuFark = Math.max(enKotuFark, d95);
  enKotuTam = Math.max(enKotuTam, Math.max(...o.tam));
  console.log(
    `${ad.padEnd(14)} ${d50.toFixed(0).padStart(9)} ms ${d95.toFixed(0).padStart(9)} ms ${dmax.toFixed(0).padStart(9)} ms`
  );
}

console.log(
  `\nEv interneti dahil EN KÖTÜ toplam  : ${enKotuTam.toFixed(0)} ms` +
    `\nKiracının kendi işi (en kötü p95)  : ${enKotuFark.toFixed(0)} ms` +
    `\n\n► Servis Vercel'de kiracılarla AYNI bölgede koşacak, yani yukarıdaki` +
    `\n  toplamın ağ payı büyük ölçüde düşecek. Zaman aşımı yine de EV` +
    `\n  ÖLÇÜMÜNÜN üst sınırına göre seçilmeli: soğuk başlangıç ve geçici ağ` +
    `\n  tıkanması gerçek ve bu ölçüm onları içeriyor.`
);
