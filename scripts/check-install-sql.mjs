#!/usr/bin/env node
/**
 * KURULUM SQL'İ MUHAFIZI — "yeni müşteri şemayı TAM alır".
 *
 * ═══ NEDEN VAR ═══
 *
 * `scripts/gen-install-sql.mjs` içindeki `ORDER` listesi ELLE tutuluyor ve
 * 24.08.2026'da bayat olduğu fark edildi: liste 043'te bitiyordu, oysa depoda
 * 078'e kadar migration vardı. Yani o gün yeni bir müşteri açılsaydı şema
 * **35 migration eksik** kurulacaktı — ve kimse fark etmeyecekti, çünkü hata
 * kurulumda değil, AYLAR SONRA "şu ekran neden boş" diye çıkardı.
 *
 * Bu muhafız o sessizliği kapatır. Dört şeyi denetler:
 *
 *   K1 — KAPSAMA: `db/migrations` altındaki HER dosya ya `ORDER`da ya
 *        `HARIC`tedir. Yeni migration ekleyip listeyi güncellemeyi unutmak
 *        `npm run verify`i KIRAR. Atlamak serbesttir ama SESSİZ değildir:
 *        `HARIC`e bir cümle gerekçe yazmak zorundasın.
 *
 *   K2 — TAZELİK: `ORDER`/`HARIC`/dönüşümler ya da bir migration DEĞİŞTİĞİ
 *        hâlde `db/install/*-full.sql` **ve** `*-hizalama-078.sql` yeniden
 *        üretilmediyse kırar. Üreticiler bellekte yeniden koşturulur ve
 *        diskteki dosyayla BAYT BAYT karşılaştırılır. "Üretmeyi unuttum" da
 *        sessiz kalamaz. Hizalama dosyaları da kapsanır: onlar mevcut
 *        kiracıların veritabanına uygulanıyor, bayat kalmaları daha pahalı.
 *
 *   K3 — TEK İŞLEM: üretilen dosyada tam olarak BİR `begin;` ve BİR `commit;`
 *        olmalı. İçeride kalmış bir `commit;` dış transaction'ı erken kapatır
 *        ve hata hâlinde YARIM ŞEMA bırakır — kurulum dosyasının tek vaadi
 *        ("hepsi ya da hiçbiri") tam olarak budur.
 *
 *   K4 — SIZINTI: başka bir müşterinin veritabanına gerçek telefon numarası,
 *        bcrypt sır hash'i ya da telegram_* kolonu taşınmamalı. Üçü de bu
 *        dosyada bir kez GERÇEKTEN vardı; dönüşümler onları çıkarıyor, bu
 *        denetim dönüşümlerin çalışmaya devam ettiğini ölçüyor.
 *
 * NEDEN TEST DEĞİL BETİK: projede test koşucusu yok; muhafızlar
 * (check-test-filters.mjs, check-tenant-defaults.mjs …) `npm run verify`
 * zincirinin parçası ve bu betik aynı kalıbı izliyor.
 *
 * Kullanım:  npm run lint:install-sql
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build, ORDER, HARIC, SENTETIK } from "./gen-install-sql.mjs";
import { hizalama } from "./gen-align-sql.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "db", "migrations");
const OUT_DIR = join(ROOT, "db", "install");

/** Üretilen kurulum dosyası olan müşteriler — hepsi denetlenir. */
const MUSTERILER = ["sendigo", "galzura"];

/** Hizalama dosyası üretilen kiracılar (MEVCUT, canlı verisi olan kurulumlar). */
const HIZALAMALAR = ["sendigo", "galzura-demo"];

const hatalar = [];
const notlar = [];

// ── K1 · KAPSAMA ───────────────────────────────────────────────────────────
const diskteki = readdirSync(SRC)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const listede = new Set(ORDER);
const haricte = new Set(Object.keys(HARIC));

const eksik = diskteki.filter((f) => !listede.has(f) && !haricte.has(f));
if (eksik.length > 0) {
  hatalar.push(
    `K1 — ${eksik.length} migration NE listede NE hariç kümesinde:\n    ` +
      eksik.join("\n    ") +
      "\n\n  Bunlar yeni müşterinin veritabanına HİÇ uygulanmaz; şema eksik kurulur." +
      "\n  Çözüm: scripts/gen-install-sql.mjs → ORDER'a ekle (numara sırasıyla)," +
      "\n         bilerek dışarıda kalacaksa HARIC'e GEREKÇESİYLE yaz;" +
      "\n         sonra: node scripts/gen-install-sql.mjs && node scripts/gen-install-sql.mjs galzura"
  );
}

const hayalet = [...listede, ...haricte].filter((f) => !existsSync(join(SRC, f)));
if (hayalet.length > 0) {
  hatalar.push(
    `K1 — listede olup DİSKTE OLMAYAN dosya (${hayalet.length}): ${hayalet.join(", ")}`
  );
}

const tekrar = ORDER.filter((f, i) => ORDER.indexOf(f) !== i);
if (tekrar.length > 0) {
  hatalar.push(`K1 — ORDER'da tekrarlanan dosya: ${[...new Set(tekrar)].join(", ")}`);
}

const ikisindeDe = ORDER.filter((f) => haricte.has(f));
if (ikisindeDe.length > 0) {
  hatalar.push(`K1 — hem ORDER'da hem HARIC'te: ${ikisindeDe.join(", ")}`);
}

const gerekcesiz = Object.entries(HARIC)
  .filter(([, sebep]) => !sebep || String(sebep).trim().length < 40)
  .map(([f]) => f);
if (gerekcesiz.length > 0) {
  hatalar.push(
    `K1 — HARIC girişinin gerekçesi yok ya da çok kısa: ${gerekcesiz.join(", ")}\n` +
      "  Bir migration'ı atlamak serbest, SESSİZCE atlamak değil."
  );
}

// Sıra: dosya adındaki numara artan olmalı (013/014 çiftleri eşit olabilir).
let oncekiNo = 0;
for (const f of ORDER) {
  const no = Number(f.slice(0, 3));
  if (!Number.isFinite(no)) {
    hatalar.push(`K1 — numarası okunamayan dosya: ${f}`);
    break;
  }
  if (no < oncekiNo) {
    hatalar.push(
      `K1 — SIRA BOZUK: ${f} (${no}) kendinden büyük numaradan (${oncekiNo}) sonra geliyor.\n` +
        "  Migration'lar birbirinin üstüne kuruluyor; sıra dosya adındaki numaradır."
    );
    break;
  }
  oncekiNo = no;
}
if (hatalar.length === 0) {
  notlar.push(
    `K1 ✓ ${diskteki.length} migration dosyasının hepsi kapsandı ` +
      `(${ORDER.length} kurulumda · ${haricte.size} gerekçeli hariç), sıra artan.`
  );
}

// ── K2 · TAZELİK ───────────────────────────────────────────────────────────
// Hem SIFIRDAN kurulum dosyaları hem MEVCUT kiracıyı hizalama dosyaları.
// İkincisi de elle üretiliyor ve aynı şekilde bayatlayabilir.
const URETIMLER = [
  ...MUSTERILER.map((m) => ({
    ad: m,
    dosya: `${m}-full.sql`,
    uret: () => build(m).sql,
    komut: `node scripts/gen-install-sql.mjs ${m}`,
  })),
  ...HIZALAMALAR.map((m) => ({
    ad: `${m} (hizalama)`,
    dosya: `${m}-hizalama-078.sql`,
    uret: () => hizalama(m).sql,
    komut: `node scripts/gen-align-sql.mjs ${m}`,
  })),
];

const uretilen = new Map();
for (const { ad: m, dosya: dosyaAd, uret, komut } of URETIMLER) {
  const dosya = join(OUT_DIR, dosyaAd);
  if (!existsSync(dosya)) {
    hatalar.push(`K2 — ${dosyaAd} YOK. Üret: ${komut}`);
    continue;
  }
  const sql = uret();
  uretilen.set(m, sql);
  const diskte = readFileSync(dosya, "utf8").replace(/\r\n/g, "\n");
  if (diskte !== sql) {
    // Farkın NEREDE olduğunu söyle: "dosya bayat" demek yetmez.
    const a = diskte.split("\n");
    const b = sql.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    hatalar.push(
      `K2 — db/install/${dosyaAd} BAYAT (ilk fark ${i + 1}. satırda):\n` +
        `    diskte : ${(a[i] ?? "(dosya bitti)").trim().slice(0, 90)}\n` +
        `    olması : ${(b[i] ?? "(dosya bitti)").trim().slice(0, 90)}\n` +
        `  Çözüm: ${komut}`
    );
  } else {
    notlar.push(`K2 ✓ ${dosyaAd} güncel (${sql.length} bayt).`);
  }
}

// ── K3 · TEK İŞLEM ─────────────────────────────────────────────────────────
for (const [m, sql] of uretilen) {
  const bas = (sql.match(/^\s*begin\s*;\s*$/gim) ?? []).length;
  const bit = (sql.match(/^\s*commit\s*;\s*$/gim) ?? []).length;
  if (bas !== 1 || bit !== 1) {
    hatalar.push(
      `K3 — ${m}: transaction bütünlüğü bozuk (begin=${bas}, commit=${bit}; ikisi de 1 olmalı).\n` +
        "  İçeride kalan bir commit; dış transaction'ı erken kapatır ve hata hâlinde\n" +
        "  YARIM ŞEMA bırakır. transform() içindeki iç begin/commit temizliğine bak."
    );
  } else {
    notlar.push(`K3 ✓ ${m}: tek transaction (1 begin · 1 commit).`);
  }
}

// ── K4 · SIZINTI ───────────────────────────────────────────────────────────
// 028'in test hesabına ait sahte numara ve sıfırlardan oluşan parola yeri
// tutucusu DURMALI — üreticiyle aynı listeden okunuyor, iki yerde tanımlanıp
// ayrışmasın.
const izinliLiteral = new Set([
  ...SENTETIK.telefonlar.map((t) => `'${t}'`),
  ...SENTETIK.hashler,
]);

const SIZINTI = [
  [/'\+\d{8,}'/g, "gerçek telefon numarası"],
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/g, "bcrypt sır hash'i"],
  [/^[^-\n]*\btelegram_[a-z_]+\b/gim, "telegram_* şema kalıntısı"],
];
for (const [m, sql] of uretilen) {
  for (const [desen, ad] of SIZINTI) {
    const bulunan = (sql.match(desen) ?? []).filter((x) => !izinliLiteral.has(x.trim()));
    if (bulunan.length > 0) {
      hatalar.push(
        `K4 — ${m}: ${ad} kurulum dosyasına sızmış (${bulunan.length} yer): ` +
          `${[...new Set(bulunan)].slice(0, 3).join(" · ").slice(0, 160)}\n` +
          "  Bu dosya BAŞKA bir müşterinin veritabanına çalıştırılıyor."
      );
    }
  }
}
if (uretilen.size > 0 && !hatalar.some((h) => h.startsWith("K4"))) {
  notlar.push("K4 ✓ telefon · bcrypt hash · telegram kalıntısı yok.");
}

// ── SONUÇ ──────────────────────────────────────────────────────────────────
if (hatalar.length > 0) {
  console.error("\n✗ KURULUM SQL'İ MUHAFIZI — " + hatalar.length + " bulgu:\n");
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}

console.log(
  `✓ kurulum SQL muhafızı: ${diskteki.length} migration · ${MUSTERILER.length} müşteri dosyası · ` +
    `4 denetim geçti.`
);
for (const n of notlar) console.log("  " + n);
