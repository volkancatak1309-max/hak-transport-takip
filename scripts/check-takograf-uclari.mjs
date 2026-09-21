#!/usr/bin/env node
/**
 * TAKOGRAF UÇLARI MUHAFIZI — kaynak denetimi (Faz C-3).
 *
 * ═══ NE KORUYOR ═══
 *
 * 1. **YALNIZ YÖNETİCİ.** Takograf, şirket kartı sahibinin uyum
 *    yükümlülüğü — filo operasyonu değil (`app/actions/takograf.ts`). Dört
 *    ucun dördü de `requireMobileAdmin`. Bir uçta kapının gevşemesi, sürücü
 *    faaliyet geçmişini filo şefine açardı.
 *
 * 2. **ARŞİV SİLİNMEZ (HK091).** Takograf yüzeyinde DELETE handler'ı YOKTUR.
 *    Veritabanı da aynı şeyi söylüyor (`trg_takograf_dosya_silinemez`), yani
 *    kural iki katmanda birden duruyor.
 *
 * 3. **YÜKLEME FRENSİZ KALAMAZ.** `lib/takograf-db.ts` `lib/upload-core.ts`in
 *    gerekçeli istisnası; `yukleVeYaz`ın freni o yoldan geçmiyor. Fren uçta,
 *    çekirdeğin KENDİ fonksiyonlarıyla uygulanmak ZORUNDA.
 *
 * 4. **YETİM DOSYA KALMAZ.** Satır yazılamazsa depoya yazılan dosya geri
 *    alınır — `check-dosya-yukleme.mjs` D1 istisnasının yazılı bedeli buydu
 *    ve bu turda ödendi.
 *
 * 5. **1000 SATIR TAVANI SESSİZ KIRPMAZ.** Uçlarda ham `.limit(` yok;
 *    sayımlar `count: "exact"`, satırlar `.range()` ile.
 *
 * Kullanım: npm run lint:takograf-uclari
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => {
  const tam = path.join(ROOT, p);
  if (!existsSync(tam)) {
    console.error(`✗ dosya yok: ${p}`);
    process.exit(1);
  }
  return readFileSync(tam, "utf8");
};

/**
 * KAYNAKTAN YORUMLARI SÖKER — dize sabitleri KORUNUR.
 *
 * `scripts/check-teslimat-kaniti.mjs`ten alındı ve sebebi orada ölçümle
 * yazılı: ham metne bakan bir denetim, kuralı ANLATAN bir yorumla tatmin olur
 * ve kapı açıkken yeşil kalır. Dizeler korunuyor çünkü bu depoda kuralların
 * çoğu dize sabitidir (`"admin_required"`, `count: "exact"`).
 */
function kodu(kaynak) {
  let cikti = "";
  let d = "kod";
  for (let i = 0; i < kaynak.length; i++) {
    const c = kaynak[i];
    const s2 = kaynak.slice(i, i + 2);
    if (d === "kod") {
      if (s2 === "//") { d = "satir"; i++; continue; }
      if (s2 === "/*") { d = "blok"; i++; continue; }
      if (c === "'") d = "tek";
      else if (c === '"') d = "cift";
      else if (c === "`") d = "sablon";
      cikti += c;
      continue;
    }
    if (d === "satir") { if (c === "\n") { d = "kod"; cikti += c; } continue; }
    if (d === "blok") { if (s2 === "*/") { d = "kod"; i++; } continue; }
    cikti += c;
    if (c === "\\") { cikti += kaynak[i + 1] ?? ""; i++; continue; }
    if ((d === "tek" && c === "'") || (d === "cift" && c === '"') || (d === "sablon" && c === "`")) {
      d = "kod";
    }
  }
  return cikti;
}

/**
 * `export async function AD(...)` gövdesini süslü parantez SAYARAK çıkarır.
 *
 * ⚠️ Gövde süslüsü, PARAMETRE parantezi kapandıktan sonra aranır — imzadaki
 * `{ params }` destructuring'i ilk süslüdür ve onu gövde sanmak iki denetimi
 * sessizce düşürür (teslimat muhafızında bir kez yaşandı).
 */
function fnGovdesi(kod, ad) {
  const m = new RegExp(`export async function ${ad}\\b`).exec(kod);
  if (!m) return "";
  const pb = kod.indexOf("(", m.index);
  if (pb < 0) return "";
  let pd = 0;
  let pe = -1;
  for (let i = pb; i < kod.length; i++) {
    if (kod[i] === "(") pd++;
    else if (kod[i] === ")") {
      pd--;
      if (pd === 0) { pe = i; break; }
    }
  }
  if (pe < 0) return "";
  const bas = kod.indexOf("{", pe);
  if (bas < 0) return "";
  let der = 0;
  for (let i = bas; i < kod.length; i++) {
    if (kod[i] === "{") der++;
    else if (kod[i] === "}") {
      der--;
      if (der === 0) return kod.slice(bas, i + 1);
    }
  }
  return kod.slice(bas);
}

let dusen = 0;
const kontrol = (ad, kosul, kanit) => {
  if (!kosul) {
    dusen++;
    console.log(`  ✗ ${ad}${kanit ? "  —  " + kanit : ""}`);
  }
};

const UCLAR = {
  liste: "app/api/mobile/takograf/route.ts",
  kunye: "app/api/mobile/takograf/[id]/route.ts",
  yenidenOku: "app/api/mobile/takograf/[id]/yeniden-oku/route.ts",
  indir: "app/api/mobile/takograf/[id]/indir/route.ts",
};
const CEKIRDEK = "lib/takograf-db.ts";
const SAF = "lib/takograf.ts";
const PANEL = "app/actions/takograf.ts";

const kod = Object.fromEntries(Object.entries(UCLAR).map(([k, p]) => [k, kodu(oku(p))]));
const cKod = kodu(oku(CEKIRDEK));
const sKod = kodu(oku(SAF));
const pKod = kodu(oku(PANEL));
const hepsi = Object.values(kod).join("\n");

// ══ 1 · YALNIZ YÖNETİCİ ═══════════════════════════════════════════════════
for (const [ad, p] of Object.entries(UCLAR)) {
  kontrol(`${ad}: requireMobileAdmin`, /requireMobileAdmin\(/.test(kod[ad]), p);
  kontrol(
    `${ad}: gevşek kapı (Worker/Scoped/FleetView) KULLANMIYOR`,
    !/requireMobile(Worker|WorkerScoped|FleetView)\(/.test(kod[ad]),
    "🔴 takograf şirket uyum işi — şefe/şoföre açılamaz"
  );
}
kontrol("panelin kapısı da yönetici (requireAdmin)", /requireAdmin\(/.test(pKod));

// ══ 2 · ARŞİV SİLİNMEZ (HK091) ════════════════════════════════════════════
kontrol(
  "takograf uçlarında DELETE handler YOK",
  !/export async function DELETE\b/.test(hepsi),
  "🔴 HK091: arşiv ürünün satış vaadi, denetimde bu kayıttan indirilecek"
);
kontrol(
  "uçlar takograf tablolarından SİLME yapmıyor",
  !/\.from\(\s*["']takograf_[a-z_]+["']\s*\)[\s\S]{0,80}?\.delete\(/.test(hepsi)
);

// ══ 3 · KURAL ÇEKİRDEKTE ══════════════════════════════════════════════════
// Uçlar ham tabloya DOKUNMAZ: okuma da yazma da çekirdekten geçer.
for (const t of ["takograf_dosyalari", "takograf_faaliyetleri", "takograf_olaylari"]) {
  kontrol(`uçlar \`${t}\` tablosuna doğrudan dokunmuyor`, !hepsi.includes(`"${t}"`));
}
kontrol("uçlar çekirdekten besleniyor", /from "@\/lib\/takograf-db"/.test(kod.liste));
for (const fn of ["dosyaListesi", "altSayim", "faaliyetlerSayfali", "olaylarSayfali", "shaIleBul"]) {
  kontrol(`${fn} yalnız çekirdekte tanımlı`, new RegExp(`export async function ${fn}\\b`).test(cKod));
  kontrol(`${fn} uçta yeniden tanımlanmamış`, !new RegExp(`function ${fn}\\b`).test(hepsi));
}

// ══ 4 · YÜKLEME FRENİ ═════════════════════════════════════════════════════
// 🔴 D4 kapsam boşluğu: takograf upload-core'un istisnası olduğu için
// `yukleVeYaz`ın freni o yoldan geçmiyor. Fren uçta olmak ZORUNDA.
const POST_GOVDE = fnGovdesi(kod.liste, "POST");
kontrol("POST gövdesi bulunabildi", POST_GOVDE.length > 0);
kontrol(
  "POST gövdesinde hizSiniriHarca ÇAĞRILIYOR",
  /hizSiniriHarca\(/.test(POST_GOVDE),
  "🔴 dosya yükleyen bir uç frensiz kalamaz (098)"
);
kontrol("kota sunucu kusurunda İADE ediliyor", /hizSiniriIadeEt\(/.test(POST_GOVDE));
kontrol("429 Retry-After başlığıyla dönüyor", /"Retry-After"/.test(POST_GOVDE));
kontrol(
  "fren ÇEKİRDEKTEN (upload-core), ikinci sayaç yok",
  /from "@\/lib\/upload-core"/.test(kod.liste) && !/upload_rate/.test(hepsi)
);
/**
 * SIRA: doğrulama → fren. Ters olsaydı bozuk bir istek (yanlış uzantı) da
 * kullanıcının kotasını yerdi.
 */
kontrol(
  "doğrulama frenden ÖNCE",
  POST_GOVDE.indexOf("yuklemeDenetle(") > -1 &&
    POST_GOVDE.indexOf("yuklemeDenetle(") < POST_GOVDE.indexOf("hizSiniriHarca("),
  "🔴 bozuk istek kullanıcının kotasını yiyor"
);

// ══ 5 · YETİM DOSYA KALMAZ ════════════════════════════════════════════════
// check-dosya-yukleme.mjs D1 istisnasının yazılı bedeli — bu turda ödendi.
kontrol(
  "çekirdek satır yazılamazsa dosyayı GERİ ALIYOR",
  /dosyaSil\(\s*TAKOGRAF_KOVA/.test(cKod),
  "🔴 yetim dosya: depoya yazıldı, satır yazılamadı, kimse bulamaz"
);
kontrol("temizlik sonucu yutulmuyor (dosyaTemizlendi)", /dosyaTemizlendi/.test(cKod));
kontrol("silme ÇEKİRDEKTEN (upload-core dosyaSil)", /from "@\/lib\/upload-core"/.test(cKod));
kontrol(
  "çekirdekte ham storage.remove YOK",
  !/storage[\s\S]{0,60}?\.remove\(/.test(cKod),
  "silme tek kapıdan geçmeli (D2)"
);

// ══ 6 · 1000 SATIR TAVANI SESSİZ KIRPMIYOR ════════════════════════════════
kontrol(
  "uçlarda ham .limit( YOK",
  !/\.limit\(/.test(hepsi),
  "🔴 PostgREST tavanı 1000; .limit() onu AŞMAZ, sessizce kırpar"
);
kontrol("künye sayımı count:exact ile", /count: "exact", head: true/.test(cKod));
kontrol("alt listeler .range() ile sayfalı", /\.range\(/.test(cKod));
kontrol("künye ucu gerçek toplamı taşıyor", /toplam/.test(kod.kunye));

// ══ 7 · TÜR İSTEMCİDEN BELİRLENMEZ ════════════════════════════════════════
// HK091 `tur`u değişmez kılıyor; yanlış yazılan bir tür kalıcı olarak yanlış
// donardı.
kontrol(
  "tur multipart alanından YAZILMIYOR",
  !/tur:\s*(form|govde)\.get/.test(kod.liste),
  "🔴 tur sunucuda turTahmin() ile tespit edilir"
);
kontrol("çekirdek turu baytlardan tespit ediyor", /turTahmin\(/.test(cKod));

// ══ 8 · TAVAN TEK KAYNAK ══════════════════════════════════════════════════
kontrol(
  "uçta ikinci bir boyut sayısı YOK",
  !/5\s*\*\s*1024\s*\*\s*1024/.test(hepsi),
  "tavan yalnız EN_BUYUK_BAYT (lib/takograf.ts)"
);
kontrol("boyut/uzantı denetimi yuklemeDenetle ile", /yuklemeDenetle\(/.test(kod.liste));
kontrol("tür listesi TEK KAYNAK (DOSYA_TURLERI)", /export const DOSYA_TURLERI/.test(sKod));
kontrol(
  "uç tür dizgesini elle yazmıyor",
  !/\[\s*"kart"\s*,\s*"vu"\s*\]/.test(kod.liste),
  "liste çekirdekten gelmeli"
);

// ══ 9 · SESSİZ DÜŞÜŞ YASAK ════════════════════════════════════════════════
kontrol(
  "tanınmayan süzgeç 400 ile reddediliyor",
  /GECERLI_SUZGECLER/.test(kod.liste),
  "sessizce yok saymak, istemciye yanlış listeyi doğru göstermektir"
);
kontrol("dönem süzgecinde gizlenen dosya sayısı bildiriliyor", /donemsizGizlendi/.test(kod.liste));
kontrol("yeniden-oku ayrıştırma SONUCUNU söylüyor", /ayristirma/.test(kod.yenidenOku));

// ══ 10 · İZ ═══════════════════════════════════════════════════════════════
kontrol("indirme izi yazılıyor (tacho_download)", /"tacho_download"/.test(kod.indir));
kontrol("yükleme izi yazılıyor", /takograf_yukle:/.test(kod.liste));
kontrol(
  "izde dosya ADI yazılmıyor",
  !/takograf_yukle:[\s\S]{0,80}?dosyaAdi/.test(kod.liste),
  "dosya adı kişisel ad taşıyabilir (panelin kuralı)"
);

// ══ 11 · SENKRON AYRIŞTIRMA SÜRESİ AÇIK YAZILI ════════════════════════════
kontrol(
  "yükleme ucunda maxDuration açık",
  /export const maxDuration\s*=\s*\d+/.test(kod.liste),
  "🔴 35 sn'lik servis çağrısı varsayılan süreye bırakılamaz"
);
kontrol(
  "yeniden-oku ucunda da maxDuration açık",
  /export const maxDuration\s*=\s*\d+/.test(kod.yenidenOku)
);

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ TAKOGRAF UÇLARI MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log("✓ takograf uçları: yönetici kapısı · HK091 · fren · yetim · 1000 tavanı yerinde.");
