#!/usr/bin/env node
/**
 * ÇOKLU "EVET" ÖLÇÜMÜ — canlı uçlar üzerinden (SALT OKUMA).
 *
 * § 7.1'de HAK61 ∩ Sendigo = 2 numara ölçülmüştü; o ölçüm iki veritabanını
 * doğrudan karşılaştırıyordu ve galzura-demo'yu KAPSAYAMIYORDU (anahtarı yok).
 *
 * Uç canlıya çıktığına göre artık demo da ölçülebilir: numarayı UCUN KENDİSİNE
 * sorarız. Yönlendirme servisinin göreceği cevabın BİREBİR aynısı — yani bu,
 * "kaç kiracı evet der" sorusunun tek gerçek ölçümü.
 *
 * ⚠️ NUMARA BASILMAZ. Yalnız maskeli desen ve kaç kiracının "evet" dediği.
 * ⚠️ Hız sınırı: numara başına dakikada 20. Kiracı başına 1 istek atılır.
 *
 * Kullanım:
 *   SIRLAR_ENV=<depo disi>/sirlar.env \
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-alias.mjs \
 *     scripts/measure-kiraci-sorgu-caprazlama.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envOku = (f) =>
  Object.fromEntries(
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );

const sirlar = envOku(process.env.SIRLAR_ENV);
const HEDEFLER = [
  { ad: "HAK61", url: "https://hak-transport-takip.vercel.app", sir: sirlar.HAK61_SIR },
  { ad: "Sendigo", url: "https://sendigo-delta.vercel.app", sir: sirlar.SENDIGO_SIR },
  { ad: "galzura-demo", url: "https://demo.galzura.com", sir: sirlar.DEMO_SIR },
];

/** Numara ASLA basılmaz. Ülke kodu + uzunluk yeter. */
const maske = (p) => `${p.slice(0, 3)}…${String(p.length).padStart(2)} hane`;

async function sor(h, telefon) {
  try {
    const res = await fetch(`${h.url}/api/mobile/kiraci-sorgu`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${h.sir}` },
      body: JSON.stringify({ telefon }),
      signal: AbortSignal.timeout(25_000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return { durum: "JSON DEĞİL" };
    const j = await res.json();
    if (res.status !== 200) return { durum: `${res.status} ${j.hata}` };
    return { durum: j.var === true ? "EVET" : "hayır", kod: j.kod };
  } catch (e) {
    return { durum: `ağ: ${e.message ?? e}` };
  }
}

// Adaylar HAK61 kadrosundan (SALT OKUMA). Yalnız AKTİF kayıtlar.
const env = envOku(".env.local");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await sb.from("workers").select("phone, is_active, is_admin, is_test");
if (error) {
  console.error("HATA:", error.message);
  process.exit(1);
}

// Yöneticiler + birkaç şoför: "çoklu evet" beklentisi yöneticilerde yüksek
// (aynı kişi birden çok kurulumu yönetiyor), şoförlerde sıfır olmalı.
const adaylar = [
  ...data.filter((w) => w.is_active && w.is_admin && w.phone?.trim()),
  ...data.filter((w) => w.is_active && !w.is_admin && !w.is_test && w.phone?.trim()).slice(0, 3),
];

console.log(`── ÇOKLU "EVET" ÖLÇÜMÜ · ${adaylar.length} numara × ${HEDEFLER.length} kiracı ──\n`);
console.log(
  `${"numara".padEnd(16)} ${"rol".padEnd(9)} ` +
    HEDEFLER.map((h) => h.ad.padEnd(14)).join("") + "evet sayısı"
);
console.log("─".repeat(78));

const dagilim = new Map();
for (const w of adaylar) {
  const tel = w.phone.trim();
  const sonuc = [];
  for (const h of HEDEFLER) sonuc.push(await sor(h, tel));
  const evet = sonuc.filter((s) => s.durum === "EVET").length;
  const olculemedi = sonuc.filter((s) => /^50\d|JSON DEĞİL|^ağ/.test(s.durum)).length;
  const anahtar = olculemedi ? `${evet}+? (${olculemedi} ölçülemedi)` : String(evet);
  dagilim.set(anahtar, (dagilim.get(anahtar) ?? 0) + 1);
  console.log(
    `${maske(tel).padEnd(16)} ${(w.is_admin ? "yönetici" : "şoför").padEnd(9)} ` +
      sonuc.map((s) => s.durum.padEnd(14)).join("") +
      anahtar
  );
}

console.log("\n── DAĞILIM ──");
for (const [k, v] of [...dagilim.entries()].sort()) {
  console.log(`  ${v} numara → ${k} kiracı "evet" diyor`);
}
console.log(
  "\n► Birden fazla \"evet\" GERÇEK. Yönlendirme servisi ilk evette DURAMAZ;\n" +
    "  hepsini paralel sorup eşleşenlerin TAMAMINI toplamalı (docs § 7.1/7.2)."
);
