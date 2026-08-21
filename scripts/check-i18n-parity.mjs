#!/usr/bin/env node
/**
 * i18n ANAHTAR EŞLEŞMESİ — MUHAFIZ. Hiçbir şeye dokunmaz, yalnız denetler.
 *
 * `messages/tr.json` REFERANSTIR. Her dil dosyası onunla BİREBİR aynı anahtar
 * kümesine sahip olmak zorunda.
 *
 * ── NEDEN DERLEME ZİNCİRİNDE ──────────────────────────────────────────────
 * next-intl eksik anahtarda ÇÖKMEZ: anahtarın kendisini basar
 * ("nav.dashboard" gibi) ve konsola uyarı yazar. Yani eksik çeviri CANLIDA
 * ekranda ham anahtar olarak görünür ve kimse fark etmez — üstelik yalnız o
 * dili kullanan müşteride. Bu muhafız o hatayı deploy'dan ÖNCE yakalar.
 *
 * Denetlenenler:
 *   1. EKSİK anahtar  — tr'de var, hedef dilde yok  → o ekran ham anahtar basar
 *   2. FAZLA anahtar  — hedef dilde var, tr'de yok  → ölü çeviri, kimse görmez
 *   3. BOŞ değer      — anahtar var ama metin boş
 *   4. ICU DEĞİŞKENİ  — `{name}` gibi yer tutucular dillerde AYNI olmalı;
 *      biri unutulursa o dilde değişken basılmaz ve cümle anlamsızlaşır
 *   5. ÇEVRİLMEMİŞ    — hedef dildeki metin tr ile BİREBİR aynıysa uyarı
 *      (marka adı, "PIN", "IMEI" gibi kasıtlı aynılar muaf tutulur)
 *
 * Kullanım: node scripts/check-i18n-parity.mjs
 */
import fs from "node:fs";
import path from "node:path";

const KLASOR = "messages";
const REFERANS = "tr";

/** Çeviri gerektirmeyen, iki dilde AYNI kalması normal değerler. */
const AYNILIK_MUAF = new Set([
  "PIN", "IMEI", "LPG", "AZG", "VIN", "GSM", "DTC", "L/100km", "km", "KM",
  "CSV", "PDF", "€", "/", "—", "-", "{v}", "{brand}", "Diesel", "Powered by Galzura",
  "+43 699 1234567", "Analytics", "Status", "Start", "Total", "Filter", "Detail",
]);

function duzles(o, p = "") {
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    const yol = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...duzles(v, yol));
    else out.push([yol, String(v)]);
  }
  return out;
}

/** `{name}` ve `{n, plural, ...}` yer tutucularının AD kümesi. */
function degiskenler(metin) {
  return new Set(
    [...metin.matchAll(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1])
  );
}

const dosyalar = fs
  .readdirSync(KLASOR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const ref = JSON.parse(fs.readFileSync(path.join(KLASOR, `${REFERANS}.json`), "utf8"));
const refDuz = new Map(duzles(ref));

let hata = 0;
let uyari = 0;
const satirlar = [];

for (const dil of dosyalar) {
  if (dil === REFERANS) continue;
  const o = JSON.parse(fs.readFileSync(path.join(KLASOR, `${dil}.json`), "utf8"));
  const duz = new Map(duzles(o));

  const eksik = [...refDuz.keys()].filter((k) => !duz.has(k));
  const fazla = [...duz.keys()].filter((k) => !refDuz.has(k));
  const bos = [...duz].filter(([, v]) => v.trim() === "").map(([k]) => k);

  const degiskenFarki = [];
  for (const [k, v] of duz) {
    const r = refDuz.get(k);
    if (r === undefined) continue;
    const a = degiskenler(r);
    const b = degiskenler(v);
    const eksikD = [...a].filter((x) => !b.has(x));
    const fazlaD = [...b].filter((x) => !a.has(x));
    if (eksikD.length || fazlaD.length) {
      degiskenFarki.push(`${k}  (eksik: ${eksikD.join(",") || "-"} · fazla: ${fazlaD.join(",") || "-"})`);
    }
  }

  const ayni = [...duz]
    .filter(([k, v]) => refDuz.get(k) === v && !AYNILIK_MUAF.has(v.trim()) && v.trim().length > 2)
    .map(([k, v]) => `${k} = "${v.slice(0, 40)}"`);

  hata += eksik.length + fazla.length + bos.length + degiskenFarki.length;
  uyari += ayni.length;

  satirlar.push({ dil, eksik, fazla, bos, degiskenFarki, ayni, toplam: duz.size });
}

console.log("");
for (const s of satirlar) {
  const temiz =
    s.eksik.length === 0 && s.fazla.length === 0 && s.bos.length === 0 && s.degiskenFarki.length === 0;
  console.log(
    `${temiz ? "✓" : "✗"} ${s.dil}.json — ${s.toplam} anahtar · eksik ${s.eksik.length} · fazla ${s.fazla.length} · boş ${s.bos.length} · değişken farkı ${s.degiskenFarki.length}`
  );
  const bas = (ad, ks) => {
    if (!ks.length) return;
    console.log(`    ${ad} (${ks.length}):`);
    for (const k of ks.slice(0, 20)) console.log(`      ${k}`);
    if (ks.length > 20) console.log(`      … ve ${ks.length - 20} tane daha`);
  };
  bas("EKSİK", s.eksik);
  bas("FAZLA", s.fazla);
  bas("BOŞ", s.bos);
  bas("DEĞİŞKEN FARKI", s.degiskenFarki);
  if (s.ayni.length) {
    console.log(`    ⚠ tr ile BİREBİR aynı (${s.ayni.length}) — çevrilmemiş olabilir:`);
    for (const k of s.ayni.slice(0, 12)) console.log(`      ${k}`);
    if (s.ayni.length > 12) console.log(`      … ve ${s.ayni.length - 12} tane daha`);
  }
}

console.log("");
if (hata > 0) {
  console.error(`✗ i18n muhafızı: ${hata} sorun. Referans: ${REFERANS}.json (${refDuz.size} anahtar).`);
  process.exit(1);
}
console.log(
  `✓ i18n muhafızı: ${dosyalar.length} dil · ${refDuz.size} anahtar · hepsi ${REFERANS}.json ile birebir` +
    (uyari ? ` (${uyari} çevrilmemiş olabilecek değer — yalnız uyarı)` : "")
);
