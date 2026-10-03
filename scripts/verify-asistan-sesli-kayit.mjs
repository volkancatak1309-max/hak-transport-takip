#!/usr/bin/env node
/**
 * SESLİ ASİSTAN FAZ 2a — KAYIT + SUNUCU SINIRLARI, UÇ DÜZEYİ KURU KOŞUM (03.10.2026).
 *
 * GERÇEK uç işleyicileri (`/api/asistan/{oturum,arac,nabiz,bildir,yazi}`, cron
 * `/api/cron/asistan-kayit-temizle`), GERÇEK oturum kapısı (mühürlü yönetici çerezi,
 * `QA_SESSION_COOKIE`); veritabanı kuru koşum şimi, OpenAI sahte cevap (ağa çıkılmaz).
 * Migration 110 ÇALIŞTIRILMADI — bu betik kodun KARAR AKIŞINI ve ürettiği yükü ölçer.
 *
 *   A) gün sınırı dolu → 429 gun_siniri, OpenAI'a HİÇ istek yok
 *   B) bütçe dolu → 429 butce · C) açık oturum → 409 oturum_acik
 *   D) sınır altı → 200 + imzalı jeton + sinirSn = kalan gün; kayıt satırı yazıldı
 *   E) araç: jetonsuz 401 · süresi dolmuş jeton 401 · geçerli jetonla kapı geçildi
 *   F) kalp atışı: saniyeyi SUNUCU sayar (istemcinin gönderdiği süre yok sayılır);
 *      bitti → kayıt kapanır, `bitir: true`
 *   G) Bildir → asistan_bildirimleri'ne soru/cevap/araçlar, oturuma bağlı
 *   H) yazılı yol: bütçe dolu → 429, OpenAI'a istek yok
 *   I) cron: sırsız 401 · tur toplamı · migration yok → 503
 *   J) bayrak KAPALI (alt süreç): nabiz/bildir 404, oturum asistan_kullanim'a DOKUNMUYOR
 *
 * Kullanım: npm run verify:asistan-sesli-kayit
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ALT = process.env.SESLI_KAYIT_ALT === "kapali";
process.env.ASISTAN_SESLI = "1";
process.env.NEXT_PUBLIC_TENANT = "galzura-demo";
process.env.OPENAI_API_KEY = "sk-kuru-sahte";
process.env.CRON_SECRET = "kuru-cron-sirri";
if (ALT) delete process.env.ASISTAN_SESLI_KAYIT;
else process.env.ASISTAN_SESLI_KAYIT = "1";

const { supabaseAdmin } = await import("@/lib/supabase");
if (supabaseAdmin?.__MOCK__ !== true) {
  console.error("✗ kuru koşum şimi devrede değil — `--import ./scripts/ts-server-kuru.mjs` ile çalıştırın.");
  process.exit(2);
}
const { sealData } = await import("iron-session");
const { NextRequest } = await import("next/server");

const YONETICI = "22222222-2222-4222-8222-222222222222";
process.env.QA_SESSION_COOKIE = await sealData(
  { worker_id: YONETICI, name: "Kuru Yönetici", phone: "+430000000999", is_admin: true },
  { password: process.env.SESSION_PASSWORD, ttl: 0 }
);

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined && kanit !== "" ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

// ── OpenAI sahte: ağa çıkılmaz, çağrılar sayılır
let openaiCagri = 0;
const asilFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.openai.com/")) {
    openaiCagri++;
    if (u.includes("/realtime/client_secrets")) {
      return Response.json({ value: "ek_kuru", expires_at: Math.floor(Date.now() / 1000) + 60 });
    }
    if (u.includes("/v1/responses")) {
      return Response.json({
        output: [{ type: "message", content: [{ type: "output_text", text: "Kuru cevap." }] }],
        usage: { input_tokens: 1200, output_tokens: 80 },
      });
    }
    return Response.json({ error: { message: "kuru" } }, { status: 500 });
  }
  return asilFetch(url, init);
};

// ── senaryo
let plan = {};
function senaryo(p) {
  plan = p;
  globalThis.__CAGRILAR__ = [];
  globalThis.__SENARYO__ = (d) => {
    const f = plan[d.table];
    const r = typeof f === "function" ? f(d) : f;
    return r ?? { data: null, error: null };
  };
}
const cagrilar = (tablo, op) => (globalThis.__CAGRILAR__ ?? []).filter((c) => c.table === tablo && (!op || c.op === op));
const AN = Date.now();
const iso = (ms) => new Date(ms).toISOString();
/** Ayın içinde, bugünün kaydı: verilen saniye kadar kullanılmış, kapanmış. */
const kapali = (sn, maliyet = 0.1, worker = YONETICI) => ({
  id: `k${Math.random()}`,
  worker_id: worker,
  motor: "live",
  model: "gpt-live-1",
  basladi_at: iso(AN - (sn + 60) * 1000),
  son_nabiz_at: iso(AN - 60_000),
  bitti_at: iso(AN - 60_000),
  saniye: sn,
  tahmini_maliyet_usd: maliyet,
});
const kullanimPlani = (satirlar, ek = {}) => ({
  asistan_kullanim: (d) => {
    if (d.op === "insert") return { data: { id: "yeni-kayit-1" }, error: null };
    if (d.op === "update") return { data: null, error: null };
    if (d.secim?.includes("arka_girdi_token") && ek.nabizSatiri) return { data: ek.nabizSatiri, error: null };
    return { data: satirlar, error: null };
  },
  asistan_bildirimleri: (d) => (d.op === "insert" ? { data: { id: "bildirim-1" }, error: null } : { data: null, error: null }),
  workers: (d) => (d.secim === "token_version" ? { data: { token_version: 7 }, error: null } : { data: null, error: null }),
});

async function post(yol, govde, basliklar = {}) {
  const { POST } = await import(`@/app/api/asistan/${yol}/route.ts`);
  const r = await POST(
    new NextRequest(`https://kuru.invalid/api/asistan/${yol}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...basliklar },
      body: JSON.stringify(govde),
    })
  );
  return { kod: r.status, govde: await r.json().catch(() => null) };
}

if (ALT) {
  // ── J) bayrak kapalı
  senaryo(kullanimPlani([]));
  const n = await post("nabiz", { oturumJetonu: "x" });
  const b = await post("bildir", { motor: "live", soru: "s" });
  const o = await post("oturum", {});
  console.log(JSON.stringify({ nabiz: n.kod, bildir: b.kod, oturum: o.kod, kullanimCagrisi: cagrilar("asistan_kullanim").length, jeton: o.govde?.oturumJetonu ?? null }));
  process.exit(0);
}

console.log("\n── Faz 2a kayıt + sunucu sınırları (bayrak AÇIK, kiracı galzura-demo)");

// A) gün sınırı
senaryo(kullanimPlani([kapali(1190)]));
openaiCagri = 0;
let r = await post("oturum", {});
iddia("A gün sınırı dolu → 429 gun_siniri", r.kod === 429 && r.govde?.error === "gun_siniri", `${r.kod} ${r.govde?.error}`);
iddia("A OpenAI'a istek GİTMEDİ", openaiCagri === 0, `${openaiCagri}`);
iddia("A kayıt satırı açılmadı", cagrilar("asistan_kullanim", "insert").length === 0);

// B) bütçe
senaryo(kullanimPlani([kapali(60, 24.6, "baska"), kapali(30, 0.5)]));
r = await post("oturum", {});
iddia("B kiracı/ay bütçesi dolu (25,1 $) → 429 butce", r.kod === 429 && r.govde?.error === "butce", `${r.kod} ${r.govde?.error}`);

// C) açık oturum
senaryo(kullanimPlani([{ ...kapali(0), bitti_at: null, son_nabiz_at: iso(AN - 10_000), basladi_at: iso(AN - 100_000), saniye: 90 }]));
r = await post("oturum", {});
iddia("C başka sekmede canlı oturum → 409 oturum_acik", r.kod === 409 && r.govde?.error === "oturum_acik", `${r.kod} ${r.govde?.error}`);

// D) sınır altı
senaryo(kullanimPlani([kapali(1000)]));
openaiCagri = 0;
r = await post("oturum", {});
const jeton = r.govde?.oturumJetonu;
iddia("D sınır altı → 200, jeton var", r.kod === 200 && typeof jeton === "string" && jeton.includes("."), `${r.kod} ${r.govde?.error ?? ""}`);
iddia("D sinirSn = kalan gün (1200 − 1000 = 200)", r.govde?.sinirSn === 200, `${r.govde?.sinirSn}`);
iddia("D kayit: true döndü", r.govde?.kayit === true);
const ekleme = cagrilar("asistan_kullanim", "insert")[0]?.payload ?? {};
iddia("D kayıt satırı: kiracı/motor/model/ses", ekleme.kiraci === "galzura-demo" && ekleme.motor === "realtime" && ekleme.model === "gpt-realtime-2.1" && ekleme.ses === "marin", JSON.stringify(ekleme));
iddia("D OpenAI'a tek istek (client_secrets)", openaiCagri === 1, `${openaiCagri}`);

// E) araç ucu jeton kapısı
const { jetonImzala } = await import("@/lib/asistan-sesli-sinir.ts");
const { createHash } = await import("node:crypto");
const sir = createHash("sha256").update(`galzura-sesli-oturum:${process.env.SESSION_PASSWORD}`).digest("hex");
senaryo(kullanimPlani([]));
r = await post("arac", { ad: "aksiyon_merkezi", girdi: "{}" });
iddia("E jetonsuz araç → 401 oturum_gecersiz", r.kod === 401 && r.govde?.error === "oturum_gecersiz", `${r.kod} ${r.govde?.error}`);
const eski = jetonImzala({ k: "yeni-kayit-1", w: YONETICI, b: AN - 700_000, s: 600 }, sir);
r = await post("arac", { ad: "aksiyon_merkezi", girdi: "{}" }, { "x-sesli-oturum": eski });
iddia("E süresi dolmuş jeton → 401 oturum_suresi_doldu", r.kod === 401 && r.govde?.error === "oturum_suresi_doldu", `${r.kod} ${r.govde?.error}`);
const baskasi = jetonImzala({ k: "yeni-kayit-1", w: "33333333-3333-4333-8333-333333333333", b: AN, s: 600 }, sir);
r = await post("arac", { ad: "aksiyon_merkezi", girdi: "{}" }, { "x-sesli-oturum": baskasi });
iddia("E başka kullanıcının jetonu → 401", r.kod === 401, `${r.kod} ${r.govde?.error}`);
r = await post("arac", { ad: "aksiyon_merkezi", girdi: "{}" }, { "x-sesli-oturum": jeton });
iddia("E geçerli jeton → kapı geçildi (araç çalıştı)", r.kod === 200 && r.govde?.ad === "aksiyon_merkezi", `${r.kod} ${r.govde?.error ?? ""}`);

// F) kalp atışı
const yuzYirmiOnce = jetonImzala({ k: "yeni-kayit-1", w: YONETICI, b: AN - 120_000, s: 600 }, sir);
senaryo(kullanimPlani([], { nabizSatiri: { id: "yeni-kayit-1", worker_id: YONETICI, motor: "live", model: "gpt-live-1", saniye: 90, bitti_at: null, arka_girdi_token: 0, arka_cikti_token: 0 } }));
r = await post("nabiz", { oturumJetonu: yuzYirmiOnce, saniye: 5, tahminiMaliyetUsd: 0.01, arkaToken: { girdi: 5000, cikti: 300 } });
let guncelleme = cagrilar("asistan_kullanim", "update")[0]?.payload ?? {};
iddia("F atış → 200, bitir yok, kalan ~480", r.kod === 200 && r.govde?.bitir === false && r.govde?.kalanSn >= 478 && r.govde?.kalanSn <= 480, JSON.stringify(r.govde));
iddia("F saniyeyi SUNUCU yazdı (~120; istemcinin 5'i yok sayıldı)", guncelleme.saniye >= 120 && guncelleme.saniye <= 122, `${guncelleme.saniye}`);
iddia("F maliyet = taban (2 dk × 0,05 + arka tokenlar) > istemcinin 0,01'i", guncelleme.tahmini_maliyet_usd > 0.1, `${guncelleme.tahmini_maliyet_usd}`);
iddia("F kayıt açık kaldı", !("bitti_at" in guncelleme));
r = await post("nabiz", { oturumJetonu: yuzYirmiOnce, bitti: true, sebep: "kullanici" });
guncelleme = cagrilar("asistan_kullanim", "update").at(-1)?.payload ?? {};
iddia("F bitti → kayıt kapandı (bitti_at + sebep kullanici), bitir: true", r.govde?.bitir === true && typeof guncelleme.bitti_at === "string" && guncelleme.bitis_sebebi === "kullanici", JSON.stringify(guncelleme));
const dolmus = jetonImzala({ k: "yeni-kayit-1", w: YONETICI, b: AN - 900_000, s: 600 }, sir);
r = await post("nabiz", { oturumJetonu: dolmus });
guncelleme = cagrilar("asistan_kullanim", "update").at(-1)?.payload ?? {};
iddia("F süre aşıldıysa sunucu kapatır (saniye 600, sure_doldu)", r.govde?.bitir === true && guncelleme.saniye === 600 && guncelleme.bitis_sebebi === "sure_doldu", JSON.stringify({ r: r.govde, g: guncelleme }));

// G) Bildir
senaryo(kullanimPlani([]));
r = await post("bildir", {
  oturumJetonu: yuzYirmiOnce,
  motor: "live",
  model: "gpt-live-1",
  dil: "tr",
  soru: "Bugün kaç araç yolda?",
  cevap: "Şu an on iki araç yolda.",
  araclar: [{ ad: "arac_listesi", sureMs: 210, onbellek: "tam", sonuc: { gizli: true } }],
});
const bildirim = cagrilar("asistan_bildirimleri", "insert")[0]?.payload ?? {};
iddia("G Bildir → 200 + kayıt", r.kod === 200 && r.govde?.id === "bildirim-1", `${r.kod} ${r.govde?.error ?? ""}`);
iddia("G soru/cevap/dil yazıldı, oturuma bağlı", bildirim.soru === "Bugün kaç araç yolda?" && bildirim.cevap === "Şu an on iki araç yolda." && bildirim.dil === "tr" && bildirim.kullanim_id === "yeni-kayit-1", JSON.stringify(bildirim));
iddia("G araç SONUCU yazılmadı (yalnız ad/süre/önbellek)", JSON.stringify(bildirim.arac_cagrilari) === JSON.stringify([{ ad: "arac_listesi", sureMs: 210, onbellek: "tam" }]), JSON.stringify(bildirim.arac_cagrilari));

// H) yazılı yol bütçesi
senaryo(kullanimPlani([kapali(60, 30)]));
openaiCagri = 0;
r = await post("yazi", { metin: "Bugün kaç araç yolda?" });
iddia("H yazılı yol: bütçe dolu → 429 butce, OpenAI'a istek yok", r.kod === 429 && r.govde?.error === "butce" && openaiCagri === 0, `${r.kod} ${r.govde?.error} openai=${openaiCagri}`);
senaryo(kullanimPlani([]));
r = await post("yazi", { metin: "Merhaba" });
const yaziKaydi = cagrilar("asistan_kullanim", "insert")[0]?.payload ?? {};
iddia("H yazılı yol: cevap + kullanım kaydı (motor yazi, tokenlar)", r.kod === 200 && yaziKaydi.motor === "yazi" && yaziKaydi.arka_girdi_token === 1200 && yaziKaydi.arka_cikti_token === 80, JSON.stringify(yaziKaydi));

// I) cron
const { GET: CRON } = await import("@/app/api/cron/asistan-kayit-temizle/route.ts");
const cron = async (sorgu) => {
  const res = await CRON(new NextRequest(`https://kuru.invalid/api/cron/asistan-kayit-temizle${sorgu}`));
  return { kod: res.status, govde: await res.json() };
};
senaryo({});
r = await cron("");
iddia("I cron sırsız → 401", r.kod === 401);
let tur = 0;
senaryo({ "rpc:asistan_kayit_temizle": () => ({ data: tur++ === 0 ? { bildirim: 5000, kullanim: 12 } : { bildirim: 7, kullanim: 0 }, error: null }) });
r = await cron("?secret=kuru-cron-sirri");
iddia("I cron: dolu turda devam, toplam doğru", r.kod === 200 && r.govde.bildirim === 5007 && r.govde.kullanim === 12 && r.govde.tur === 2, JSON.stringify(r.govde));
senaryo({ "rpc:asistan_kayit_temizle": () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.asistan_kayit_temizle" } }) });
r = await cron("?secret=kuru-cron-sirri");
iddia("I cron: migration yok → 503 migration_110_yok", r.kod === 503 && r.govde.error === "migration_110_yok", JSON.stringify(r.govde));

// J) bayrak kapalı — alt süreç
const alt = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), {
  env: { ...process.env, SESLI_KAYIT_ALT: "kapali" },
  encoding: "utf8",
});
let k = {};
try {
  k = JSON.parse(alt.stdout.trim().split("\n").pop());
} catch {
  console.log(alt.stdout, alt.stderr);
}
iddia("J bayrak kapalı: nabiz 404, bildir 404", k.nabiz === 404 && k.bildir === 404, JSON.stringify(k));
iddia("J bayrak kapalı: oturum 200, jeton yok, asistan_kullanim'a HİÇ çağrı yok", k.oturum === 200 && k.jeton === null && k.kullanimCagrisi === 0, JSON.stringify(k));

globalThis.fetch = asilFetch;
if (dusen > 0) {
  console.log(`\n✗ SESLİ ASİSTAN FAZ 2a (uç) — ${dusen} iddia düştü.\n`);
  process.exit(1);
}
console.log("\n✓ sesli asistan Faz 2a (uç): sınırlar oturumdan önce, saniye sunucuda, jetonsuz araç yok, Bildir tabloda, bayrak kapalıyken tabloya dokunulmuyor.");
