#!/usr/bin/env node
/**
 * SESLİ ASİSTAN MUHAFIZI — kaynak denetimi (Faz 1 web prototipi, 03.10.2026).
 *
 * ═══ NE KORUYOR ═══
 *
 * Prototip bir DIŞ ÇAĞRI (OpenAI) ve bir MALİYET açıyor; üç şey sessizce bozulursa
 * zararı büyük olur:
 *   1) ANAHTAR: `OPENAI_API_KEY` yalnız `lib/asistan-sesli.ts`'te okunur; istemci
 *      bileşeni `process.env`'e hiç dokunmaz; `NEXT_PUBLIC_OPENAI…` yok; sunucu
 *      dosyalarında `console.` yok (hata gövdesi/anahtar loga düşmesin).
 *   2) YAZMA YOK: araç katmanı yalnız `GET` işleyicisi içe aktarır, `supabaseAdmin`
 *      yok, rapor (`/reports`) ve patron (`/guvenlik`) uçları araç değil.
 *   3) KAPI: bayrak → kiracı → oturum sırası; dört uç da (oturum, arac, canli, yazi) ilk iş
 *      `sesliKapi()`; sayfa `sesliAcikMi()` + `notFound()`; bayrak varsayılanı kapalı ("1" dışı).
 * Ayrıca: `gpt-live-1` izin listesinde yok (Realtime API'yi desteklemiyor), 10 dk
 * sınırı, istemde kiracı adı ("HAK61") yok.
 *
 * Faz 1c (03.10.2026, Test 2 düzeltmeleri):
 *   4) RAPOR KAPISI: uç yerine rapor fonksiyonu çağıran araç (`buildPerformanceReport`,
 *      `buildFuelReport`) ÖNCE o raporun ucunun kapısını (`requireMobileAdmin`) koşturur.
 *   5) ÖNBELLEK KİŞİYE ÖZEL: anahtar kiracı + kullanıcı; kimliksiz çağrı önbelleğe girmez.
 *   6) SESLER SABİT: Realtime `marin`, GPT-Live `gleam`; uçlar istemciden ses okumaz.
 *   7) TALİMAT: dil geçişi "aynı cevapta", tek kelimelik dolgu, koordinat okunmaz.
 *   8) AKIŞ: Realtime protokol kararları durum makinesinde (`lib/asistan-sesli-akis.ts`);
 *      istemci `conversation.item.create`'i kendisi yollamaz. Senaryolar ayrı betikte:
 *      `lint:asistan-sesli-akis`.
 *
 * Faz 2a hazırlığı (03.10.2026, bayrak `ASISTAN_SESLI_KAYIT`, migration 110 ÇALIŞTIRILMADI):
 *   9) SINIRLAR OTURUMDAN ÖNCE: oturum/canli uçlarında `oturumAc` OpenAI çağrısından önce.
 *  10) SÜRE SUNUCUDA: araç ucu kayıt açıkken imzalı jeton ister; kalp atışında saniyeyi sunucu
 *      sayar (istemcinin süresi okunmaz).
 *  11) MİGRATION BEKLEMEDE: 110 `_beklemede/` altında, kurulum listesinde yok; saklama süreleri
 *      SQL gövdesinde sabit (2 ay / 90 gün), cron süre seçemez, CRON_SECRET ister.
 *
 * Kurallar önce gerçek dosyalarda geçmeli, sonra her kural için bozulmuş bir kopyada
 * DÜŞMELİ (arıza enjeksiyonu) — geçiyor olması tek başına çalıştığını kanıtlamaz.
 *
 * Kullanım: npm run lint:asistan-sesli
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => readFileSync(path.join(ROOT, p), "utf8");

const D = {
  cekirdek: "lib/asistan-sesli.ts",
  araclar: "lib/asistan-sesli-araclar.ts",
  sabitler: "lib/asistan-sesli-sabitler.ts",
  oturum: "app/api/asistan/oturum/route.ts",
  arac: "app/api/asistan/arac/route.ts",
  canli: "app/api/asistan/canli/route.ts",
  yazi: "app/api/asistan/yazi/route.ts",
  nabiz: "app/api/asistan/nabiz/route.ts",
  bildir: "app/api/asistan/bildir/route.ts",
  kayit: "lib/asistan-sesli-kayit.ts",
  sinir: "lib/asistan-sesli-sinir.ts",
  cron: "app/api/cron/asistan-kayit-temizle/route.ts",
  migration: "db/migrations/_beklemede/110_sesli_asistan_kayit.sql",
  kurulum: "scripts/gen-install-sql.mjs",
  onbellek: "lib/asistan-sesli-onbellek.ts",
  akis: "lib/asistan-sesli-akis.ts",
  sayfa: "app/admin/asistan/page.tsx",
  istemci: "app/admin/asistan/AsistanSesliClient.tsx",
  tenant: "lib/tenant.ts",
};

/** Yorumlar atılır: kurallar KODA bakar, açıklama metnine değil. */
const kod = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function tumKaynak() {
  const cikti = [];
  const gez = (d) => {
    for (const ad of readdirSync(path.join(ROOT, d))) {
      const g = path.join(d, ad);
      if (statSync(path.join(ROOT, g)).isDirectory()) gez(g);
      else if (/\.(ts|tsx)$/.test(ad)) cikti.push(g.split(path.sep).join("/"));
    }
  };
  ["app", "lib", "components"].forEach(gez);
  return cikti;
}

/** Her kural: (dosyalar) → hata metni ya da null. */
const KURALLAR = [
  ["anahtar yalnız çekirdekte", (f) => {
    const yer = Object.entries(f.hepsi).filter(([, s]) => kod(s).includes("OPENAI_API_KEY")).map(([p]) => p);
    return yer.length === 1 && yer[0] === D.cekirdek ? null : `OPENAI_API_KEY okuyan: ${yer.join(", ") || "yok"}`;
  }],
  ["NEXT_PUBLIC_OPENAI yok", (f) =>
    Object.values(f.hepsi).some((s) => /NEXT_PUBLIC_OPENAI/.test(s)) ? "NEXT_PUBLIC_OPENAI bulundu" : null],
  ["istemci process.env okumaz", (f) => (/process\.env/.test(kod(f[D.istemci])) ? "istemcide process.env" : null)],
  ["sunucu dosyalarında console yok", (f) => {
    const kirli = [D.cekirdek, D.araclar, D.oturum, D.arac, D.canli, D.yazi, D.onbellek, D.akis, D.nabiz, D.bildir, D.kayit, D.sinir, D.cron].filter((p) =>
      /\bconsole\./.test(kod(f[p]))
    );
    return kirli.length ? `console: ${kirli.join(", ")}` : null;
  }],
  ["araçlar yalnız GET içe aktarır", (f) => {
    const s = kod(f[D.araclar]);
    if (/import\s*\{[^}]*\b(POST|PATCH|PUT|DELETE)\b[^}]*\}\s*from\s*"@\/app\/api/.test(s)) return "yazma işleyicisi içe aktarılmış";
    if (/supabaseAdmin|@\/lib\/supabase/.test(s)) return "supabaseAdmin içe aktarılmış";
    if (/@\/app\/api\/mobile\/(reports|guvenlik)/.test(s)) return "rapor/güvenlik ucu araç olmuş";
    return null;
  }],
  ["kapı sırası bayrak → kiracı → oturum", (f) => {
    const s = kod(f[D.cekirdek]);
    const govde = s.slice(s.indexOf("export async function sesliKapi"));
    const i = [govde.indexOf("!ASISTAN_SESLI"), govde.indexOf("TENANT !== SESLI_KIRACI"), govde.indexOf("getSession()"), govde.indexOf("requireAdmin()")];
    return i.every((x, k) => x >= 0 && (k === 0 || x > i[k - 1])) ? null : `sıra: ${i.join(",")}`;
  }],
  ["altı uç da önce sesliKapi", (f) => {
    const bozuk = [D.oturum, D.arac, D.canli, D.yazi, D.nabiz, D.bildir].filter((p) => !/export async function POST\([^)]*\)\s*\{\s*const kapi = await sesliKapi\(\);\s*if \(!kapi\.ok\) return kapi\.response;/.test(kod(f[p])));
    return bozuk.length ? `ilk iş kapı değil: ${bozuk.join(", ")}` : null;
  }],
  ["OpenAI uç adresleri yalnız çekirdekte", (f) => {
    const yer = Object.entries(f.hepsi)
      .filter(([, s]) => /realtime\/client_secrets|v1\/live\/sessions|v1\/responses/.test(kod(s)))
      .map(([p]) => p);
    return yer.length === 1 && yer[0] === D.cekirdek
      ? null
      : `client_secrets/live sessions/responses geçen: ${yer.join(", ") || "yok"}`;
  }],
  ["sayfa 404 kapısı", (f) => {
    const s = kod(f[D.sayfa]);
    return /if \(!sesliAcikMi\(\)\) notFound\(\);/.test(s) && /is_admin\) notFound\(\);/.test(s) ? null : "sayfa kapısı eksik";
  }],
  ["bayrak varsayılanı kapalı (katı \"1\")", (f) =>
    /export const ASISTAN_SESLI = process\.env\.ASISTAN_SESLI\?\.trim\(\) === "1";/.test(f[D.tenant]) ? null : "bayrak tanımı değişmiş"],
  ["gpt-live-1 Realtime listesinde değil", (f) =>
    /id:\s*"gpt-live-1"/.test(kod(f[D.sabitler])) ? "gpt-live-1 Realtime listesinde" : null],
  ["10 dk sınırı", (f) => (/SESLI_OTURUM_SINIRI_SN = 600;/.test(f[D.sabitler]) ? null : "oturum sınırı 600 değil")],
  ["istemde kiracı adı yok", (f) => {
    const m = f[D.cekirdek].match(/const SISTEM_ISTEMI = `([\s\S]*?)`;/);
    if (!m) return "istem bulunamadı";
    return /HAK61|Sendigo/i.test(m[1]) ? "istemde kiracı adı" : null;
  }],
  // Faz 1b (03.10 testi): Türkçe soruya İngilizce cevap + robotik anons. Dil kuralı EN ÜSTTE
  // durmalı ve "son mesajın dili" demeli; anons yasağı metinde kalmalı.
  ["istem dil kuralıyla başlar, anons yasağı var", (f) => {
    const m = f[D.cekirdek].match(/const SISTEM_ISTEMI = `([\s\S]*?)`;/);
    if (!m) return "istem bulunamadı";
    if (!m[1].startsWith("# Language")) return "ilk bölüm dil kuralı değil";
    if (!/LAST message/.test(m[1])) return "dil kuralı 'son mesaj' demiyor";
    if (!/Do NOT announce what you are about to do/.test(m[1])) return "anons yasağı yok";
    return null;
  }],
  // Faz 1c (Test 2): Realtime Almanca → Türkçe geçişte Almanca sürdü; GPT-Live "Bir bakayım"
  // dedi ve koordinatı rakam rakam okudu. Üç kural metinde kalmalı.
  ["istem Faz 1c kuralları (dil geçişi, tek kelime dolgu, koordinat)", (f) => {
    const m = f[D.cekirdek].match(/const SISTEM_ISTEMI = `([\s\S]*?)`;/);
    if (!m) return "istem bulunamadı";
    if (!/switch immediately in this same answer/.test(m[1])) return "aynı cevapta dil geçişi kuralı yok";
    if (!/at most ONE word/.test(m[1])) return "tek kelimelik dolgu kuralı yok";
    if (!/Never read coordinates aloud/.test(m[1])) return "koordinat yasağı yok";
    return null;
  }],
  // Rapor fonksiyonu çağıran araç, raporun ucunun kapısını AYNI istekle önce koşturmalı.
  ["rapor çağrısından önce uç kapısı", (f) => {
    const s = kod(f[D.araclar]);
    if (!/async function raporKapisi[\s\S]{0,240}requireMobileAdmin\(/.test(s)) return "raporKapisi requireMobileAdmin çağırmıyor";
    const cagri = (s.match(/await build(Performance|Fuel)Report\(/g) ?? []).length;
    const korunan = (
      s.match(/const kapali = await raporKapisi\([^)]*\);\s*if \(kapali\) return kapali;\s*const rapor = await build(Performance|Fuel)Report\(/g) ?? []
    ).length;
    return cagri > 0 && cagri === korunan ? null : `rapor çağrısı ${cagri}, kapılı ${korunan}`;
  }],
  // Önbellek bir yöneticinin verisini başka birine döndürmemeli.
  ["önbellek kiracı + kullanıcı anahtarlı", (f) => {
    const bozuk = [D.arac, D.yazi].filter((p) => !/kimlik(: |\s*=\s*)`\$\{TENANT\}\|\$\{kapi\.workerId\}`/.test(kod(f[p])));
    if (bozuk.length) return `kimlik anahtarı eksik: ${bozuk.join(", ")}`;
    if (!/if \(!anahtar\) return \{ deger: await uret\(\)/.test(kod(f[D.onbellek]))) return "kimliksiz çağrı önbelleğe giriyor";
    return null;
  }],
  // Volkan kararı (Faz 1c): sesler seçilmez, sabit.
  ["sesler sabit (marin / gleam)", (f) => {
    if (!/export const SESLI_SES = "marin";/.test(f[D.sabitler])) return "Realtime sesi marin değil";
    if (!/export const CANLI_SES = "gleam";/.test(f[D.sabitler])) return "GPT-Live sesi gleam değil";
    const okuyan = [D.oturum, D.canli].filter((p) => /govde\.ses\b/.test(kod(f[p])));
    if (okuyan.length) return `istemciden ses okunuyor: ${okuyan.join(", ")}`;
    const s = kod(f[D.cekirdek]);
    if (!/voice: SESLI_SES/.test(s) || !/voice: CANLI_SES/.test(s)) return "çekirdek sabit sesi kullanmıyor";
    return null;
  }],
  // ── Faz 2a ─────────────────────────────────────────────────────────────
  ["kayıt bayrağı katı \"1\"", (f) =>
    /export const ASISTAN_SESLI_KAYIT = process\.env\.ASISTAN_SESLI_KAYIT\?\.trim\(\) === "1";/.test(f[D.tenant]) ? null : "kayıt bayrağı tanımı değişmiş"],
  ["sınırlar OpenAI oturumundan önce", (f) => {
    const o = kod(f[D.oturum]);
    const c = kod(f[D.canli]);
    const oi = o.indexOf("await oturumAc(");
    const ci = c.indexOf("await oturumAc(");
    if (oi < 0 || ci < 0) return "oturumAc çağrısı yok";
    if (!(oi < o.indexOf("await istemciSirriUret("))) return "oturum: sınır OpenAI'dan sonra";
    if (!(ci < c.indexOf("await canliOturumAc("))) return "canli: sınır OpenAI'dan sonra";
    return null;
  }],
  ["araç ucu kayıt açıkken jeton ister", (f) =>
    /if \(KAYIT_ACIK\) \{\s*const j = jetonDogrula\(req\.headers\.get\("x-sesli-oturum"\), kapi\.workerId\);\s*if \(!j\.ok\) return/.test(kod(f[D.arac])) ? null : "araç ucunda jeton kapısı yok"],
  ["saniyeyi sunucu sayar", (f) => {
    if (!/const saniye = nabizSaniyesi\(p\.jeton, an,/.test(kod(f[D.kayit]))) return "nabız saniyesi sunucuda hesaplanmıyor";
    if (/govde\.saniye|govde\.sureSn|govde\.gecenSn/.test(kod(f[D.nabiz]))) return "nabız ucu istemcinin süresini okuyor";
    return null;
  }],
  ["migration 110 beklemede, kurulumda yok", (f) => {
    if (!f[D.migration]) return "110 taslağı yok";
    if (/"110_/.test(f[D.kurulum])) return "110 kurulum listesinde (onaysız)";
    if (f.kokMigration110) return "110 db/migrations/ köküne alınmış (onaysız)";
    if (!/interval '90 days'/.test(f[D.migration]) || !/interval '2 months'/.test(f[D.migration])) return "saklama süreleri SQL gövdesinde değil";
    if (!/enable row level security/.test(f[D.migration])) return "RLS yok";
    return null;
  }],
  ["temizlik cron'u sır ister, süre seçemez", (f) => {
    const s = kod(f[D.cron]);
    if (!/process\.env\.CRON_SECRET/.test(s) || !/safeEqual\(/.test(s)) return "CRON_SECRET/safeEqual yok";
    if (!/if \(!authorized\(req\)\)/.test(s)) return "yetki denetimi yok";
    if (/p_gun|p_days|interval/.test(s)) return "cron saklama süresi seçiyor";
    return null;
  }],
  ["Faz 2a sınır sabitleri (20 dk / 60 dk / 25 $)", (f) => {
    const s = f[D.sabitler];
    return /SESLI_GUNLUK_SINIR_SN = 20 \* 60;/.test(s) && /SESLI_AYLIK_SINIR_SN = 60 \* 60;/.test(s) && /SESLI_KIRACI_AYLIK_BUTCE_USD = 25;/.test(s)
      ? null
      : "sınır sabitleri değişmiş";
  }],
  // Test 2 kilitlenmesi istemcinin kendi response.create / item.create kararlarından doğdu.
  ["Realtime akışı durum makinesinde", (f) => {
    const s = kod(f[D.istemci]);
    if (!/realtimeAkis\(/.test(s)) return "istemci durum makinesini kullanmıyor";
    if (/type: "conversation\.item\.create"/.test(s)) return "istemci conversation.item.create'i kendisi yolluyor";
    return null;
  }],
];

function dosyalar() {
  const f = {};
  for (const p of Object.values(D)) f[p] = oku(p);
  f.kokMigration110 = readdirSync(path.join(ROOT, "db/migrations")).some((ad) => /^110_/.test(ad));
  f.hepsi = Object.fromEntries(tumKaynak().map((p) => [p, oku(p)]));
  return f;
}

function denetle(f) {
  return KURALLAR.map(([ad, kural]) => [ad, kural(f)]).filter(([, h]) => h);
}

const gercek = dosyalar();
const dusen = denetle(gercek);
for (const [ad, h] of dusen) console.log(`  ✗ ${ad}  —  ${h}`);

// ── Arıza enjeksiyonu: her biri kendi kuralını DÜŞÜRMELİ.
const BOZMALAR = [
  ["anahtar yalnız çekirdekte", (f) => { f.hepsi[D.istemci] += "\nconst k = process.env.OPENAI_API_KEY;"; }],
  ["istemci process.env okumaz", (f) => { f[D.istemci] += "\nconst x = process.env.X;"; }],
  ["araçlar yalnız GET içe aktarır", (f) => { f[D.araclar] += '\nimport { POST as y } from "@/app/api/mobile/sefer/route";'; }],
  ["kapı sırası bayrak → kiracı → oturum", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("if (!ASISTAN_SESLI) return", "if (false) return");
  }],
  ["altı uç da önce sesliKapi", (f) => { f[D.canli] = f[D.canli].replace("const kapi = await sesliKapi();", "const kapi = { ok: true };"); }],
  ["altı uç da önce sesliKapi", (f) => { f[D.yazi] = f[D.yazi].replace("const kapi = await sesliKapi();", "const kapi = { ok: true };"); }],
  ["altı uç da önce sesliKapi", (f) => { f[D.nabiz] = f[D.nabiz].replace("const kapi = await sesliKapi();", "const kapi = { ok: true };"); }],
  ["altı uç da önce sesliKapi", (f) => { f[D.bildir] = f[D.bildir].replace("const kapi = await sesliKapi();", "const kapi = { ok: true };"); }],
  ["kayıt bayrağı katı \"1\"", (f) => {
    f[D.tenant] = f[D.tenant].replace('process.env.ASISTAN_SESLI_KAYIT?.trim() === "1";', 'process.env.ASISTAN_SESLI_KAYIT?.trim() !== "0";');
  }],
  ["sınırlar OpenAI oturumundan önce", (f) => {
    f[D.oturum] = f[D.oturum].replace("const kayit = await oturumAc(", "const kayit0 = 0;\n  const r0 = await istemciSirriUret(x);\n  const kayit = await oturumAc(");
  }],
  ["araç ucu kayıt açıkken jeton ister", (f) => { f[D.arac] = f[D.arac].replace("if (KAYIT_ACIK) {", "if (false) {"); }],
  ["saniyeyi sunucu sayar", (f) => { f[D.nabiz] = f[D.nabiz].replace("bitti: govde.bitti === true,", "bitti: govde.bitti === true, saniye: govde.saniye,"); }],
  ["migration 110 beklemede, kurulumda yok", (f) => { f[D.kurulum] += '\nconst x = ["110_sesli_asistan_kayit.sql"];'; }],
  ["migration 110 beklemede, kurulumda yok", (f) => { f[D.migration] = f[D.migration].replace("interval '90 days'", "make_interval(days => p_gun)"); }],
  ["temizlik cron'u sır ister, süre seçemez", (f) => { f[D.cron] = f[D.cron].replace("if (!authorized(req)) {", "if (false) {"); }],
  ["Faz 2a sınır sabitleri (20 dk / 60 dk / 25 $)", (f) => { f[D.sabitler] = f[D.sabitler].replace("SESLI_GUNLUK_SINIR_SN = 20 * 60;", "SESLI_GUNLUK_SINIR_SN = 200 * 60;"); }],
  ["OpenAI uç adresleri yalnız çekirdekte", (f) => {
    f.hepsi[D.istemci] += '\nconst r = "https://api.openai.com/v1/responses";';
  }],
  ["istem Faz 1c kuralları (dil geçişi, tek kelime dolgu, koordinat)", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("switch immediately in this same answer", "switch from the next answer on");
  }],
  ["istem Faz 1c kuralları (dil geçişi, tek kelime dolgu, koordinat)", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("Never read coordinates aloud", "Read coordinates when asked");
  }],
  ["rapor çağrısından önce uç kapısı", (f) => {
    f[D.araclar] = f[D.araclar].replace('const kapali = await raporKapisi(ctx, "/api/mobile/reports/fuel.csv");', "const kapali = null;");
  }],
  ["önbellek kiracı + kullanıcı anahtarlı", (f) => {
    f[D.yazi] = f[D.yazi].replace("${TENANT}|${kapi.workerId}", "${TENANT}");
  }],
  ["sesler sabit (marin / gleam)", (f) => { f[D.sabitler] = f[D.sabitler].replace('SESLI_SES = "marin"', 'SESLI_SES = "alloy"'); }],
  ["sesler sabit (marin / gleam)", (f) => {
    f[D.oturum] = f[D.oturum].replace("const model = govde.model", "const ses = govde.ses;\n  const model = govde.model");
  }],
  ["Realtime akışı durum makinesinde", (f) => {
    f[D.istemci] += '\nconst x = { type: "conversation.item.create" };';
  }],
  ["OpenAI uç adresleri yalnız çekirdekte", (f) => {
    f.hepsi[D.istemci] += '\nconst u = "https://api.openai.com/v1/live/sessions";';
  }],
  ["istem dil kuralıyla başlar, anons yasağı var", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("Do NOT announce what you are about to do", "Briefly say what you will do");
  }],
  ["bayrak varsayılanı kapalı (katı \"1\")", (f) => {
    f[D.tenant] = f[D.tenant].replace('process.env.ASISTAN_SESLI?.trim() === "1";', 'process.env.ASISTAN_SESLI?.trim() !== "0";');
  }],
  ["istemde kiracı adı yok", (f) => {
    f[D.cekirdek] = f[D.cekirdek].replace("You are the voice assistant of Galzura Fleet", "You are the voice assistant of HAK61");
  }],
  ["gpt-live-1 Realtime listesinde değil", (f) => { f[D.sabitler] += '\nconst z = [{ id: "gpt-live-1" }];'; }],
];
let kacan = 0;
for (const [ad, boz] of BOZMALAR) {
  const kopya = structuredClone(gercek);
  boz(kopya);
  if (!denetle(kopya).some(([k]) => k === ad)) {
    kacan++;
    console.log(`  ✗ arıza enjeksiyonu YAKALANMADI: ${ad}`);
  }
}

if (dusen.length > 0 || kacan > 0) {
  console.log(`\n✗ SESLİ ASİSTAN MUHAFIZI — ${dusen.length} kural düştü, ${kacan} arıza kaçtı.\n`);
  process.exit(1);
}
console.log(`✓ sesli asistan muhafızı: ${KURALLAR.length} kural geçti, ${BOZMALAR.length} arıza enjeksiyonunun hepsi yakalandı.`);
