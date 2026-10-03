#!/usr/bin/env node
/**
 * HAFTALIK AKSİYON KARTI DİLİ — UÇ DÜZEYİ KURU KOŞUM (03.10.2026).
 *
 * GERÇEK `GET /api/mobile/haftalik` işleyicisi, GERÇEK mobil jetonla çağrılır; veritabanı
 * kuru koşum şimidir (`scripts/ts-server-kuru.mjs` — gerçek kuruluma bağlanmaz). Tabloda
 * kartlar ESKİ biçimde durur: kural motorunun Türkçe metni, `metinDili` yok.
 *
 *   A) Şirket dili TR (env yok → DEFAULT_LOCALE tr):
 *      Accept-Language en → kart İngilizce · de → Almanca · başlık yok → Türkçe (AYNEN) ·
 *      ?dil=en, başlık tr → İngilizce (açık istek kazanır) · fr → Türkçe (desteklenmeyen dil).
 *      Kanıt şeridinin birimi aynı dilde, ham birim `birimKodu`da.
 *   B) Üretici (`kiracininDilinde`): şirket dili TR → metin aynen, `metinDili: "tr"`;
 *      şirket dili DE (alt süreç, NEXT_PUBLIC_DEFAULT_LOCALE=de) → kayıt metni Almanca,
 *      `metinDili: "de"`.
 *
 * Kullanım: npm run verify:haftalik-dil
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { kuralBelgeBitiyor, kuralSessizArac, kuralYakitSapmasi } from "@/lib/haftalik-aksiyon.ts";

if (supabaseAdmin?.__MOCK__ !== true) {
  console.error("✗ kuru koşum şimi devrede değil — `--import ./scripts/ts-server-kuru.mjs` ile çalıştırın.");
  process.exit(2);
}

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

const YONETICI = "22222222-2222-4222-8222-222222222222";
const SOFOR = "77777777-7777-4777-8777-777777777777";
const ARAC = "55555555-5555-4555-8555-555555555555";
const ARAC2 = "56555555-5555-4555-8555-555555555555";

const kartlar = [
  kuralSessizArac({ vehicleId: ARAC, plaka: "W-GF-117", sessizSaat: 15 * 24 + 3 }),
  kuralBelgeBitiyor({ workerId: SOFOR, ad: "Paul Huber", belgeTuru: "C95", kalanGun: 12, sonTarih: "2026-10-15" }),
  kuralYakitSapmasi({ vehicleId: ARAC2, plaka: "W-GF-113", lPer100Km: 14.6, filoOrtalama: 11.4, ornekSayisi: 120 }),
];

// ── B (alt süreç): şirket dili DE iken üretici
if (process.env.HAFTALIK_DIL_ALT === "uretici") {
  const { kiracininDilinde } = await import("@/lib/haftalik-aksiyon-db.ts");
  const sonuc = await kiracininDilinde(kartlar);
  console.log(JSON.stringify(sonuc.map((a) => ({ baslik: a.baslik, metinDili: a.kanit.metinDili }))));
  process.exit(0);
}

// ── tohum: tablo ESKİ biçimde (Türkçe metin, metinDili yok)
const satirlar = kartlar.map((a, i) => ({
  id: `a${i}`,
  tur_id: "tur1",
  kural: a.kural,
  worker_id: a.workerId,
  vehicle_id: a.vehicleId,
  oncelik: a.oncelik,
  baslik: a.baslik,
  gerekce: a.gerekce,
  kanit: Object.fromEntries(Object.entries(a.kanit).filter(([k]) => !["esikYuzde", "aciklama", "yasalDayanak"].includes(k))),
  hedef_yol: a.hedefYol,
  durum: "acik",
  kapatan: null,
  kapatildi_at: null,
  kapatma_notu: null,
  created_at: "2026-09-28T05:00:00Z",
}));
globalThis.__SENARYO__ = (d) => {
  if (d.table === "workers") {
    if (d.secim?.includes("counts_as_driver") || d.secim?.includes("is_admin")) {
      return {
        data: { id: YONETICI, name: "Kuru Koşum", is_admin: true, is_active: true, must_change_pin: false, counts_as_driver: false, token_version: 7 },
        error: null,
      };
    }
    if (d.secim === "token_version") return { data: { token_version: 7 }, error: null };
    return { data: [{ id: SOFOR, name: "Paul Huber" }], error: null };
  }
  if (d.table === "vehicles") return { data: [{ id: ARAC, plate: "W-GF-117" }, { id: ARAC2, plate: "W-GF-113" }], error: null };
  if (d.table === "haftalik_aksiyon_turlari") {
    return {
      data: [{ id: "tur1", hafta_basi: "2026-09-28", uretildi_at: "2026-09-28T05:00:00Z", tarama: {}, aksiyon_sayisi: 3, elenen_sayisi: 0, bildirim_alici: null, bildirim_jeton: null, bildirim_hata: null, created_at: "2026-09-28T05:00:00Z" }],
      error: null,
    };
  }
  if (d.table === "haftalik_aksiyonlar") return { data: d.secim?.includes("baslik") ? satirlar : [], error: null };
  return { data: null, error: null };
};

const { GET } = await import("@/app/api/mobile/haftalik/route.ts");
const jeton = (await issueTokens(YONETICI, true, 7)).accessToken;
async function cagir(dilBasligi, sorgu = "") {
  const h = { authorization: `Bearer ${jeton}` };
  if (dilBasligi) h["accept-language"] = dilBasligi;
  const { NextRequest } = await import("next/server");
  const r = await GET(new NextRequest(`https://kuru.invalid/api/mobile/haftalik${sorgu}`, { headers: h }));
  return { kod: r.status, govde: await r.json() };
}
const sessiz = (g) => (g.aksiyonlar ?? []).find((a) => a.kural === "sessiz_arac") ?? {};
const yakit = (g) => (g.aksiyonlar ?? []).find((a) => a.kural === "yakit_sapmasi") ?? {};

console.log("\n── A) şirket dili TR (DEFAULT_LOCALE), uç: GET /api/mobile/haftalik");
const en = await cagir("en-US,en;q=0.9");
iddia("A1 en → 200 + dil en", en.kod === 200 && en.govde.dil === "en", `${en.kod} ${en.govde.dil} ${en.govde.error ?? ""}`);
iddia("A1 en → başlık İngilizce", sessiz(en.govde).baslik === "Have the tracker in W-GF-117 checked — no signal for 15 days", sessiz(en.govde).baslik);
iddia("A1 en → birim hours, ham kod saat", sessiz(en.govde).kanit?.birim === "hours" && sessiz(en.govde).kanit?.birimKodu === "saat", JSON.stringify(sessiz(en.govde).kanit));
iddia("A1 en → eski satırda eşik yüzdesi türetildi", /25% above the average/.test(yakit(en.govde).gerekce ?? ""), yakit(en.govde).gerekce);

const de = await cagir("de-AT,de;q=0.9,en;q=0.8");
iddia("A2 de → dil de", de.govde.dil === "de", de.govde.dil);
iddia("A2 de → başlık Almanca", sessiz(de.govde).baslik === "Lassen Sie das Gerät in W-GF-117 prüfen — seit 15 Tagen kein Signal", sessiz(de.govde).baslik);
iddia("A2 de → birim Stunden", sessiz(de.govde).kanit?.birim === "Stunden", sessiz(de.govde).kanit?.birim);

const yok = await cagir(null);
iddia("A3 başlık yok → dil tr", yok.govde.dil === "tr", yok.govde.dil);
iddia("A3 başlık yok → saklanan Türkçe metin AYNEN", sessiz(yok.govde).baslik === kartlar[0].baslik && sessiz(yok.govde).gerekce === kartlar[0].gerekce, sessiz(yok.govde).baslik);
iddia("A3 Türkçe okurda birim gün/saat kalır", sessiz(yok.govde).kanit?.birim === "saat", sessiz(yok.govde).kanit?.birim);

const acik = await cagir("tr-TR", "?dil=en");
iddia("A4 ?dil=en, başlık tr → İngilizce (açık istek kazanır)", acik.govde.dil === "en" && /^Have the tracker/.test(sessiz(acik.govde).baslik ?? ""), sessiz(acik.govde).baslik);

const fr = await cagir("fr-FR,fr;q=0.9");
iddia("A5 fr → şirket dili (tr), metin aynen", fr.govde.dil === "tr" && sessiz(fr.govde).baslik === kartlar[0].baslik, `${fr.govde.dil}`);

iddia("A6 özne adı ve öncelik bozulmadı", sessiz(en.govde).ozne?.ad === "W-GF-117" && sessiz(en.govde).oncelik === kartlar[0].oncelik);

console.log("\n── B) üretici: kayıt metni şirketin dilinde");
const { kiracininDilinde } = await import("@/lib/haftalik-aksiyon-db.ts");
const tr = await kiracininDilinde(kartlar);
iddia("B1 şirket dili tr → metin aynen", tr.every((a, i) => a.baslik === kartlar[i].baslik), "");
iddia("B1 metinDili tr yazıldı", tr.every((a) => a.kanit.metinDili === "tr"));

const alt = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), {
  env: { ...process.env, HAFTALIK_DIL_ALT: "uretici", NEXT_PUBLIC_DEFAULT_LOCALE: "de" },
  encoding: "utf8",
});
let altSonuc = [];
try {
  altSonuc = JSON.parse(alt.stdout.trim().split("\n").pop());
} catch {
  console.log(alt.stdout, alt.stderr);
}
iddia("B2 şirket dili de → kayıt metni Almanca", altSonuc[0]?.baslik === "Lassen Sie das Gerät in W-GF-117 prüfen — seit 15 Tagen kein Signal", altSonuc[0]?.baslik);
iddia("B2 metinDili de yazıldı", altSonuc.length === 3 && altSonuc.every((a) => a.metinDili === "de"), JSON.stringify(altSonuc.map((a) => a.metinDili)));

if (dusen > 0) {
  console.log(`\n✗ HAFTALIK KART DİLİ (uç) — ${dusen} iddia düştü.\n`);
  process.exit(1);
}
console.log("\n✓ haftalık kart dili (uç): şirket dili TR iken EN → İngilizce, DE → Almanca, başlıksız → Türkçe aynen; üretici şirketin dilinde yazıyor.");
