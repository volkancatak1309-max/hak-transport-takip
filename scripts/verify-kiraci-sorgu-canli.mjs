#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — CANLI KABUL TESTİ (SALT OKUMA).
 *
 * `KIRACI_SORGU_SECRET` üç kiracıya da girildikten SONRA koşulur. Uçun kendisi
 * canlıda, gerçek sırla, gerçek verisiyle sınanır — süreç içi taklit yok.
 *
 * ── 🔴 NEDEN "false" YOLU TEK BAŞINA YETMEZ ───────────────────────────────
 * Kayıtsız bir numaraya `{"var":false}` dönmesi şunları kanıtlar: rota
 * dağıtıldı, env girildi, sır uyuşuyor, kiracı kodu doğru. Kanıtlamadığı tek
 * şey: sorgunun DOĞRU Supabase projesine gittiği. Yanlış projeye bağlı bir
 * kurulum da her numaraya "false" derdi ve test yeşil görünürdü. Bu yüzden
 * her kiracıda GERÇEKTEN KAYITLI bir numarayla `{"var":true}` de aranır.
 *
 * ── NUMARALAR NEREDEN GELİYOR ─────────────────────────────────────────────
 * HAK61 ve Sendigo: kendi veritabanlarından SELECT ile (anahtarlar .env
 * dosyalarında). galzura-demo'nun service_role anahtarı VERİLMİYOR — oranın
 * "true" yolu, HAK61'de yönetici olan numaralar demo ucuna sorularak aranır
 * (aynı kişi üç kurulumda da yönetici olabilir). Bulunamazsa test bunu
 * KANITLANMADI diye bildirir; "muhtemelen çalışıyor" demez.
 *
 * ── ⚠️ NUMARA BASILMAZ ────────────────────────────────────────────────────
 * Ne ekrana ne dosyaya. Yalnız maskeli desen ve sonuç.
 *
 * ── SIR NEREDEN GELİYOR ───────────────────────────────────────────────────
 * `SIRLAR_ENV` ile gösterilen, DEPO DIŞINDAKİ bir dosyadan. Bu betiğin içinde
 * sır YOKTUR ve komut satırına da geçmez.
 *
 * Kullanım:
 *   SIRLAR_ENV=<depo disi yol>/sirlar.env \
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-alias.mjs \
 *     scripts/verify-kiraci-sorgu-canli.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function envOku(dosya) {
  return Object.fromEntries(
    readFileSync(dosya, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

const sirlar = envOku(process.env.SIRLAR_ENV);

/** Numara ASLA basılmaz — yalnız uzunluk ve ülke kodu. */
const maske = (p) => `${p.slice(0, 3)}…(${p.length} hane)`;

const KIRACILAR = [
  {
    ad: "HAK61",
    url: "https://hak-transport-takip.vercel.app",
    kod: "hak61",
    sir: sirlar.HAK61_SIR,
    envDosya: ".env.local",
    panelAcik: true,
  },
  {
    ad: "Sendigo",
    url: "https://sendigo-delta.vercel.app",
    kod: "sendigo",
    sir: sirlar.SENDIGO_SIR,
    envDosya: ".env.sendigo",
    panelAcik: false,
  },
  {
    ad: "galzura-demo",
    url: "https://demo.galzura.com",
    kod: "galzura-demo",
    sir: sirlar.DEMO_SIR,
    envDosya: null, // service_role anahtarı verilmiyor
    panelAcik: null,
  },
];

/** Kayıtlı OLMADIĞI bilinen numara — "false" yolu için. */
const YOK = "+436600000042";

async function sor(url, sir, govde) {
  const bas = { "content-type": "application/json" };
  if (sir) bas.authorization = `Bearer ${sir}`;
  const t0 = Date.now();
  let res, metin;
  try {
    res = await fetch(`${url}/api/mobile/kiraci-sorgu`, {
      method: "POST",
      headers: bas,
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(25_000),
    });
    metin = await res.text();
  } catch (e) {
    return { ag: String(e.message ?? e) };
  }
  const ct = res.headers.get("content-type") ?? "";
  let json = null;
  if (ct.includes("application/json")) {
    try {
      json = JSON.parse(metin);
    } catch { /* JSON degil */ }
  }
  return {
    status: res.status,
    ct: ct.split(";")[0],
    json,
    ms: Date.now() - t0,
    cache: res.headers.get("cache-control"),
  };
}

const satirlar = [];
const return_olculemedi = [];
const hatalar = [];
const not = (k, d, s, ok) => satirlar.push({ k, d, s, ok });

// ── HAK61 ve Sendigo'nun kadrolarını oku (SALT OKUMA) ────────────────────
const kadro = {};
for (const k of KIRACILAR) {
  if (!k.envDosya) continue;
  const env = envOku(k.envDosya);
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("workers")
    .select("phone, is_active, is_admin, is_test");
  if (error) {
    hatalar.push(`${k.ad}: kadro okunamadı — ${error.message}`);
    continue;
  }
  kadro[k.ad] = data
    .filter((w) => w.phone?.trim())
    .map((w) => ({ ...w, phone: w.phone.trim() }));
}

for (const k of KIRACILAR) {
  console.log(`\n═══ ${k.ad} · ${k.url} ═══`);
  if (!k.sir) {
    hatalar.push(`${k.ad}: sır bulunamadı (${process.env.SIRLAR_ENV})`);
    continue;
  }

  // ── 1 · DOĞRU SIR + KAYITSIZ NUMARA → 200 / var:false ─────────────────
  const a = await sor(k.url, k.sir, { telefon: YOK });
  const aOk =
    a.status === 200 && a.ct === "application/json" &&
    a.json?.ok === true && a.json?.var === false && a.json?.kod === k.kod;
  console.log(
    `  1 · doğru sır · kayıtsız numara : HTTP ${a.status} · ${a.ct} · ` +
      `${JSON.stringify(a.json)} · ${a.ms} ms`
  );
  not(k.ad, "doğru sır · kayıtsız numara", `HTTP ${a.status} → ${JSON.stringify(a.json)}`, aOk);
  if (!aOk) {
    hatalar.push(
      `${k.ad} · 1: beklenen 200 {"ok":true,"var":false,"kod":"${k.kod}"} — ` +
        `bulunan HTTP ${a.status} ${a.ct} ${JSON.stringify(a.json)}` +
        (a.status === 503 ? "  → env girilmemiş ya da REDEPLOY edilmemiş" : "") +
        (a.status === 401 ? "  → sır uyuşmuyor" : "")
    );
  }

  // ── 2 · 🔴 "true" YOLU — gerçekten kayıtlı numara ──────────────────────
  let adaylar = [];
  let kaynak = "";
  if (kadro[k.ad]) {
    // Kendi kadrosu: ucun "evet" demesi GEREKEN kayıtlar.
    adaylar = kadro[k.ad]
      .filter((w) => w.is_active && (k.panelAcik || w.is_admin))
      .map((w) => w.phone);
    kaynak = `kendi veritabanı (${adaylar.length} uygun kayıt)`;
  } else {
    // galzura-demo: anahtar yok. HAK61'in YÖNETİCİ numaraları denenir —
    // aynı kişi birden çok kurulumda yönetici olabilir (ölçüldü: HAK61 ∩
    // Sendigo = 2 numara).
    adaylar = (kadro["HAK61"] ?? [])
      .filter((w) => w.is_active && w.is_admin)
      .map((w) => w.phone);
    kaynak = `HAK61 yönetici numaraları (${adaylar.length} aday) — demo'nun anahtarı yok`;
  }

  let bulundu = null;
  let denenen = 0;
  for (const tel of adaylar.slice(0, 6)) {
    denenen++;
    const r = await sor(k.url, k.sir, { telefon: tel });
    if (r.status === 200 && r.json?.var === true && r.json?.kod === k.kod) {
      bulundu = { tel, r };
      break;
    }
    if (r.status !== 200) {
      hatalar.push(`${k.ad} · 2: beklenmedik HTTP ${r.status} ${JSON.stringify(r.json)}`);
      break;
    }
  }
  console.log(`  2 · kaynak                      : ${kaynak}`);
  if (bulundu) {
    console.log(
      `  2 · KAYITLI numara · var:true   : HTTP ${bulundu.r.status} · ` +
        `${JSON.stringify(bulundu.r.json)} · numara ${maske(bulundu.tel)} · ` +
        `${denenen}. denemede · ${bulundu.r.ms} ms`
    );
    not(k.ad, "KAYITLI numara → var:true", `HTTP 200 → var:true, kod:${bulundu.r.json.kod}`, true);
  } else {
    console.log(`  2 · KAYITLI numara · var:true   : ✗ BULUNAMADI (${denenen} aday denendi)`);
    not(k.ad, "KAYITLI numara → var:true", `${denenen} aday denendi, hiçbiri true dönmedi`, false);
    hatalar.push(
      `${k.ad} · 2: "true" yolu KANITLANAMADI. ${denenen} aday denendi.` +
        (kadro[k.ad]
          ? " Kendi kadrosundan gelen numara bile bulunamadı — sorgu YANLIŞ Supabase projesine gidiyor olabilir."
          : " Bu kiracıda kayıtlı bir numara gerekiyor (anahtarı yok).")
    );
  }

  // ── 3 · YANLIŞ SIR → 401 (asla "hayır" değil) ─────────────────────────
  const y = await sor(k.url, k.sir.slice(0, -1) + (k.sir.slice(-1) === "0" ? "1" : "0"), {
    telefon: YOK,
  });
  const yOk = y.status === 401 && y.json?.hata === "yetkisiz" && y.json?.var === undefined;
  console.log(
    `  3 · YANLIŞ sır                  : HTTP ${y.status} · ${JSON.stringify(y.json)}` +
      (yOk ? "  ✓ 401, gövdede 'var' YOK" : "  ✗")
  );
  not(k.ad, "yanlış sır", `HTTP ${y.status} → ${JSON.stringify(y.json)}`, yOk);
  if (!yOk) hatalar.push(`${k.ad} · 3: yanlış sır 401 yetkisiz dönmedi — ${y.status} ${JSON.stringify(y.json)}`);

  // ── 4 · SIRSIZ → 401 ──────────────────────────────────────────────────
  const s0 = await sor(k.url, null, { telefon: YOK });
  const s0Ok = s0.status === 401 && s0.json?.hata === "yetkisiz";
  console.log(`  4 · sır YOK                     : HTTP ${s0.status} · ${JSON.stringify(s0.json)}`);
  not(k.ad, "sır yok", `HTTP ${s0.status} → ${JSON.stringify(s0.json)}`, s0Ok);
  if (!s0Ok) hatalar.push(`${k.ad} · 4: sırsız istek 401 dönmedi`);

  // ── 5 · PIN reddi (env girildikten SONRA artık 400 olmalı) ────────────
  const p = await sor(k.url, k.sir, { telefon: YOK, pin: "123456" });
  const pOk = p.status === 400 && p.json?.hata === "pin_gonderilmemeli";
  console.log(`  5 · gövdede PIN                 : HTTP ${p.status} · ${JSON.stringify(p.json)}`);
  not(k.ad, "gövdede PIN", `HTTP ${p.status} → ${JSON.stringify(p.json)}`, pOk);
  if (!pOk) hatalar.push(`${k.ad} · 5: PIN'li gövde 400 pin_gonderilmemeli dönmedi`);
}

// ── 6 · ÇAPRAZ SIR — bir kiracının sırrı başkasında geçmemeli ────────────
console.log(`\n═══ ÇAPRAZ SIR DENETİMİ ═══`);
const caprazlar = [
  ["HAK61 sırrı", "Sendigo'ya", sirlar.HAK61_SIR, KIRACILAR[1]],
  ["Sendigo sırrı", "HAK61'e", sirlar.SENDIGO_SIR, KIRACILAR[0]],
  ["Demo sırrı", "HAK61'e", sirlar.DEMO_SIR, KIRACILAR[0]],
  ["HAK61 sırrı", "demo'ya", sirlar.HAK61_SIR, KIRACILAR[2]],
];
for (const [kimin, nereye, sir, hedef] of caprazlar) {
  const r = await sor(hedef.url, sir, { telefon: YOK });
  // ⚠️ ÜÇ SONUÇ VAR, İKİ DEĞİL. 503 "yapilandirilmadi" bir BAŞARISIZLIK DEĞİL,
  // ÖLÇÜLEMEDİ demektir: env'i olmayan kiracı sırra hiç BAKMADAN çıkar, yani
  // çapraz sızıntı ne kanıtlanır ne çürütülür. İlk yazımda bu 503'ler
  // "SIRLAR KARIŞIYOR" diye raporlanıyordu — kendi ölçemediği şeyi bulgu
  // sanan bir test, bulgusuz bir testten daha zararlıdır.
  const gecti = r.status === 401 && r.json?.hata === "yetkisiz";
  const olculemedi = r.status === 503 && r.json?.hata === "yapilandirilmadi";
  console.log(
    `  ${kimin} → ${nereye.padEnd(12)} : HTTP ${r.status} · ${JSON.stringify(r.json)}` +
      (gecti ? "  ✓ reddedildi" : olculemedi ? "  ⏳ ÖLÇÜLEMEDİ (hedefte env yok)" : "  ✗ SIRLAR KARIŞIYOR")
  );
  if (olculemedi) {
    not("çapraz", `${kimin} → ${nereye}`, `HTTP ${r.status} → ölçülemedi (hedefte env yok)`, null);
    return_olculemedi.push(`${kimin} → ${nereye}`);
  } else {
    not("çapraz", `${kimin} → ${nereye}`, `HTTP ${r.status} → ${JSON.stringify(r.json)}`, gecti);
    if (!gecti) hatalar.push(`ÇAPRAZ: ${kimin} ${nereye} geçti (HTTP ${r.status}) — sırlar izole DEĞİL`);
  }
}
if (return_olculemedi.length) {
  console.log(
    `\n  ⏳ ${return_olculemedi.length} çapraz denetim ÖLÇÜLEMEDİ (hedef kiracıda env yok):`
  );
  for (const c of return_olculemedi) console.log(`     ${c}`);
  console.log("     Hedef kiracı redeploy edildikten sonra tekrar koşulmalı.");
}

// ── SONUÇ ────────────────────────────────────────────────────────────────
console.log(`\n═══ SONUÇ ═══`);
const gecen = satirlar.filter((s) => s.ok === true).length;
const kalan = satirlar.filter((s) => s.ok === null).length;
console.log(
  `${gecen}/${satirlar.length - kalan} denetim geçti` +
    (kalan ? ` · ${kalan} denetim ÖLÇÜLEMEDİ (hedefte env yok — başarısız DEĞİL)` : "")
);
if (hatalar.length) {
  console.error(`\n✗ ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h);
  process.exit(1);
}
console.log("✓ hepsi geçti — salt okuma, hiçbir yazma yapılmadı.");
