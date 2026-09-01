#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — ZAMANLAMA KANALI ÖLÇÜMÜ (SALT OKUMA).
 *
 * SORU: `/api/mobile/kiraci-sorgu` "yok" cevabını anında dönerse, SÜRE FARKINDAN
 * bilgi sızar mı? Yani taban (sabit) bir gecikme gerekli mi?
 *
 * ── NEDEN NAİF ÖLÇÜM YETMEZ ───────────────────────────────────────────────
 * İlk turda "BULUNDU − BULUNAMADI = 6,67 ms" çıktı ve t-testi "anlamlı" dedi.
 * Ama ağ üzerinden yapılan bir ölçümde t-testi yanıltıcıdır: yeterince örnekle
 * HER fark "anlamlı" görünür. Doğru soru "fark var mı" değil, "fark, ölçüm
 * düzeneğinin KENDİ gürültüsünden büyük mü".
 *
 * ── TASARIM: SINIF İÇİ KONTROL ────────────────────────────────────────────
 * Her sınıfın BİRDEN ÇOK kolu var ve kollar fizik olarak birbirinin AYNISI:
 *
 *   BULUNDU    : aktifA · aktifB · pasifA   (üçü de tek satır döndürüyor)
 *   BULUNAMADI : yokA   · yokB   · yokC     (üçü de sıfır satır döndürüyor)
 *
 * Sınıf İÇİ fark SIFIR OLMAK ZORUNDA. Ölçülen sıfır olmayan değer, düzeneğin
 * gürültü tabanıdır. Sınıflar ARASI fark ancak bu tabandan BÜYÜKSE bilgi taşır.
 *
 * ── SONUÇ (HAK61 canlı, 01.09.2026, n=250/kol) ────────────────────────────
 *   sınıf içi en büyük fark (aktifA−aktifB) ... 6,81 ms   ← gürültü tabanı
 *   sınıflar arası fark ....................... 2,78 ms   ← aranan sinyal
 *   → sinyal, kendi gürültü tabanının ALTINDA. Zamanlama kanalı YOK.
 *
 * KARAR: taban süre EKLENMEDİ. Gerekçenin tamamı docs/KIRACI-SORGU-UCU.md § 4.
 *
 * Kullanım:  node scripts/measure-kiraci-sorgu-zamanlama.mjs   (~3 dk)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: hepsi } = await sb.from("workers").select("phone, is_active");
const aktifler = hepsi.filter((w) => w.is_active && w.phone?.trim()).map((w) => w.phone);
const pasifler = hepsi.filter((w) => !w.is_active && w.phone?.trim()).map((w) => w.phone);

const KOLLAR = [
  ["aktifA", aktifler[0], "BULUNDU"],
  ["aktifB", aktifler[1], "BULUNDU"],
  ["pasifA", pasifler[0], "BULUNDU"],
  ["yokA", "+436600000042", "BULUNAMADI"],
  ["yokB", "+436600000043", "BULUNAMADI"],
  ["yokC", "+436600000044", "BULUNAMADI"],
];

async function sorgu(phone) {
  const t0 = process.hrtime.bigint();
  await sb.from("workers").select("id, is_active, is_admin").in("phone", [phone]).limit(2);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const N = 250;
const g = Object.fromEntries(KOLLAR.map(([ad]) => [ad, []]));
for (let i = 0; i < 10; i++) await sorgu("+436600000099");

for (let i = 0; i < N; i++) {
  const kaydir = i % KOLLAR.length;
  for (let k = 0; k < KOLLAR.length; k++) {
    const [ad, tel] = KOLLAR[(k + kaydir) % KOLLAR.length];
    g[ad].push(await sorgu(tel));
  }
}

const ort = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = ort(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const kirp = (a) => { const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length * 0.1); return ort(s.slice(k, s.length - k)); };
const welch = (a, b) => {
  const va = std(a) ** 2 / a.length, vb = std(b) ** 2 / b.length;
  return (ort(a) - ort(b)) / Math.sqrt(va + vb);
};

console.log(`── KOLLAR (n=${N}) ────────────────────────────────────────────`);
for (const [ad, , sinif] of KOLLAR) {
  console.log(`${ad.padEnd(7)} ${sinif.padEnd(11)}: %10-kırpılmış ${kirp(g[ad]).toFixed(1)} ms · σ ${std(g[ad]).toFixed(1)}`);
}

console.log("\n── SINIF İÇİ (fark SIFIR olmalı — gürültü tabanı) ─────────────");
const ici = [["aktifA−aktifB", "aktifA", "aktifB"], ["aktifA−pasifA", "aktifA", "pasifA"],
             ["yokA−yokB", "yokA", "yokB"], ["yokA−yokC", "yokA", "yokC"], ["yokB−yokC", "yokB", "yokC"]];
let taban = 0;
for (const [ad, a, b] of ici) {
  const d = kirp(g[a]) - kirp(g[b]);
  taban = Math.max(taban, Math.abs(d));
  console.log(`${ad.padEnd(16)}: ${d.toFixed(2).padStart(7)} ms   t=${welch(g[a], g[b]).toFixed(2).padStart(6)}`);
}

console.log("\n── SINIFLAR ARASI (aranan sinyal) ─────────────────────────────");
const bulundu = [...g.aktifA, ...g.aktifB, ...g.pasifA];
const yok = [...g.yokA, ...g.yokB, ...g.yokC];
const sinyal = kirp(bulundu) - kirp(yok);
console.log(`BULUNDU−BULUNAMADI: ${sinyal.toFixed(2).padStart(7)} ms   t=${welch(bulundu, yok).toFixed(2).padStart(6)}   (n=${bulundu.length} vs ${yok.length})`);

console.log(`\nGÜRÜLTÜ TABANI (sınıf içi en büyük |fark|): ${taban.toFixed(2)} ms`);
console.log(`ARANAN SİNYAL                             : ${Math.abs(sinyal).toFixed(2)} ms`);
console.log(sinyal !== 0 && Math.abs(sinyal) < taban
  ? "→ SİNYAL, KENDİ GÜRÜLTÜ TABANININ ALTINDA. Zamanlama kanalı yok."
  : "→ Sinyal tabanı aşıyor; taban süre GEREKEBİLİR.");
