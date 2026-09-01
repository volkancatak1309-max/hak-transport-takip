#!/usr/bin/env node
/**
 * KİRACI SORGU UCU — SIZINTI VE AYRIŞMA MUHAFIZI.
 *
 * ═══ NEDEN VAR ═══
 *
 * `/api/mobile/kiraci-sorgu` iki söz veriyor ve ikisi de KODUN ŞEKLİNE bağlı,
 * çalışma anında görünmüyor:
 *
 *   1. "Kişisel veri dönmez." Bugün doğru. Yarın biri hata ayıklarken cevaba
 *      `ad` ekler, bir hafta sonra kimse fark etmez — uç çalışmaya devam eder,
 *      yalnız girişsiz/uzak bir servise isim akmaya başlar.
 *   2. "Eşleştirme girişin AYNISI." Bugün doğru, çünkü ikisi de
 *      `findWorkerByPhone` + `workerCanSignIn` çağırıyor. Yarın biri sorgu ucuna
 *      "hızlı olsun" diye düz bir `eq("phone", …)` yazar; o an "sorguda var,
 *      girişte yok" (ya da tersi) durumu doğar ve kullanıcı sonsuz döngüye
 *      düşer: yönlendirme "buraya git" der, giriş "sen kimsin" der.
 *
 * Hiçbiri tsc'nin, build'in ya da mevcut muhafızların yakalayabileceği bir
 * kusur değil. Bu betik o boşluğu kapatıyor.
 *
 * Altı denetim, hepsi KAYNAK üzerinde (veritabanı gerekmez):
 *   K1 — Cevap gövdesinin ALAN LİSTESİ. Her alan bir KARAR; yenisi muhafızı
 *        kırar ve karar yeniden verilir.
 *   K2 — Uç, `workers`tan yalnız KİMLİK KAPISININ okuduğu bayrakları seçer.
 *        `pin_hash`, `name`, `plate`, `phone` seçilmesi yasak.
 *   K3 — Uç kendi eşleştirmesini KURMAZ: `findWorkerByPhone` çağırır, doğrudan
 *        `.from("workers")` yazmaz.
 *   K4 — Kurulum kapısı TEK KAYNAKTAN: hem uç hem `lib/auth-core.ts`
 *        `workerCanSignIn` çağırır ve kural başka yerde tekrar yazılmaz.
 *   K5 — PIN reddi yerinde (`pin` alanı 400 ile geri çevriliyor) ve uç
 *        `bcrypt`/`verifyCredentials` zincirine HİÇ dokunmaz.
 *   K6 — Cevaba bağlı ERKEN ÇIKIŞ yok: `findWorkerByPhone` çağrısından sonra
 *        yalnız TEK bir dönüş noktası kalır (zamanlama kanalı açılmasın).
 *
 * Kullanım:  npm run lint:kiraci-sorgu
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UC = "app/api/mobile/kiraci-sorgu/route.ts";
const CEKIRDEK = "lib/auth-core.ts";

const hatalar = [];
const notlar = [];

function oku(p) {
  const tam = join(ROOT, p);
  if (!existsSync(tam)) {
    hatalar.push(`DOSYA YOK: ${p}`);
    return null;
  }
  return readFileSync(tam, "utf8");
}

const uc = oku(UC);
const cekirdek = oku(CEKIRDEK);

/** Yorum satırlarını düşür — denetimler KODA bakmalı, açıklamaya değil. */
function kodu(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

if (uc && cekirdek) {
  const ucKod = kodu(uc);
  const cekKod = kodu(cekirdek);

  // ── K1 · CEVAP GÖVDESİNİN ALAN LİSTESİ ─────────────────────────────────
  /**
   * Bu liste beyaz liste değil, KARAR KAYDI. Üçü de kişisel veri taşımaz:
   *   ok   — istek işlendi mi (protokol).
   *   var  — aranan cevap; TEK BİT.
   *   kod  — kiracı kodu (NEXT_PUBLIC_TENANT). Zaten her kiracının açılış
   *          sayfasında görünür; yanlış kiracıya bağlanmış bir yönlendirme
   *          kaydını teşhis etmek için duruyor.
   *   hata — yalnız hata gövdesinde; sabit kod dizesi (kişiye ait değil).
   */
  const IZINLI_ALANLAR = new Set(["ok", "var", "kod", "hata"]);

  // `cevap({ ... })` ve `Response.json({ ... })` çağrılarındaki üst düzey anahtarlar.
  const govdeler = [...ucKod.matchAll(/\bcevap\(\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const alanlar = new Set();
  for (const g of govdeler) {
    for (const m of g.matchAll(/(?:^|,)\s*([A-Za-zçğıöşüÇĞİÖŞÜ_][\w]*)\s*(?::|,|$)/g)) {
      alanlar.add(m[1]);
    }
  }
  if (alanlar.size === 0) {
    hatalar.push("K1 — cevap gövdesi bulunamadı; muhafız kör kalıyor (cevap(...) çağrısı arandı).");
  }
  const kacak = [...alanlar].filter((a) => !IZINLI_ALANLAR.has(a));
  if (kacak.length > 0) {
    hatalar.push(
      `K1 — cevap gövdesinde İZİNSİZ alan: ${kacak.join(", ")}\n` +
        "  Bu uç girişsiz/uzak bir servise cevap veriyor ve YALNIZ evet/hayır dönmeli.\n" +
        `  Alan gerçekten gerekiyorsa ${UC.split("/").pop()} için kararı bu betikteki\n` +
        "  IZINLI_ALANLAR listesine gerekçesiyle yaz."
    );
  } else {
    notlar.push(`K1 ✓ cevap alanları: ${[...alanlar].sort().join(", ")}`);
  }

  // ── K2 · SEÇİLEN KOLONLAR ──────────────────────────────────────────────
  const YASAK_KOLON = ["pin_hash", "name", "plate", "phone", "counts_as_driver", "token_version"];
  const secimler = [...ucKod.matchAll(/findWorkerByPhone\(\s*[^,]+,\s*"([^"]*)"/g)].map((m) => m[1]);
  if (secimler.length === 0) {
    hatalar.push("K2 — uçta findWorkerByPhone(…, \"kolonlar\") çağrısı bulunamadı.");
  }
  for (const s of secimler) {
    const kolonlar = s.split(",").map((c) => c.trim());
    const kotu = kolonlar.filter((c) => YASAK_KOLON.includes(c));
    if (kotu.length > 0) {
      hatalar.push(
        `K2 — uç kişisel/gizli kolon seçiyor: ${kotu.join(", ")}\n` +
          "  Kimlik kapısı yalnız is_active + is_admin okur. Hash'i hiç çekmemek,\n" +
          "  çekip atmaktan iyidir: ileride eklenecek bir teşhis logu onu basamaz."
      );
    } else {
      notlar.push(`K2 ✓ seçilen kolonlar: ${kolonlar.join(", ")}`);
    }
  }

  // ── K3 · İKİNCİ EŞLEŞTİRME YOK ─────────────────────────────────────────
  if (/\.from\(\s*["']workers["']\s*\)/.test(ucKod)) {
    hatalar.push(
      "K3 — uç doğrudan `.from(\"workers\")` sorgusu kuruyor.\n" +
        "  Eşleştirme TEK KAYNAKTAN olmalı (lib/auth-core.ts → findWorkerByPhone).\n" +
        "  İkinci bir sorgu, giriş varyant listesini değiştirdiğinde sessizce ayrışır."
    );
  } else if (!/findWorkerByPhone\(/.test(ucKod)) {
    hatalar.push("K3 — uç findWorkerByPhone çağırmıyor; eşleştirme girişten ayrışmış olabilir.");
  } else {
    notlar.push("K3 ✓ eşleştirme findWorkerByPhone üzerinden (girişle ortak).");
  }
  if (/phoneVariants\(/.test(ucKod)) {
    hatalar.push(
      "K3 — uç phoneVariants'ı KENDİ kuruyor. Varyant listesini uygulamak\n" +
        "  findWorkerByPhone'un işi; burada tekrarlamak iki yolun ayrışma noktasıdır."
    );
  }

  // ── K4 · KURULUM KAPISI TEK KAYNAKTAN ──────────────────────────────────
  if (!/workerCanSignIn\(/.test(ucKod)) {
    hatalar.push("K4 — uç workerCanSignIn çağırmıyor; kurulum kapısı girişten ayrışır.");
  }
  if (!/workerCanSignIn\(/.test(cekKod)) {
    hatalar.push(`K4 — ${CEKIRDEK} workerCanSignIn çağırmıyor; kural iki yerde ayrı yazılmış.`);
  }
  // Kuralın kendisi (DRIVER_PANEL_ENABLED + is_admin bileşimi) YALNIZ
  // workerCanSignIn gövdesinde geçmeli. Başka bir yerde tekrarı, iki tanımın
  // sessizce ayrışacağı andır.
  const kapiTekrar = [];
  for (const [ad, src] of [[UC, ucKod], [CEKIRDEK, cekKod]]) {
    for (const satir of src.split(/\r?\n/)) {
      if (/DRIVER_PANEL_ENABLED/.test(satir) && /is_admin/.test(satir)) {
        // workerCanSignIn'in KENDİ gövdesindeki tek satır meşru.
        if (!/return\s+w\.is_active\s*===\s*true/.test(satir)) kapiTekrar.push(`${ad}: ${satir.trim()}`);
      }
    }
  }
  if (kapiTekrar.length > 0) {
    hatalar.push(
      "K4 — kurulum kapısı workerCanSignIn DIŞINDA tekrar yazılmış:\n  " +
        kapiTekrar.join("\n  ")
    );
  } else if (!hatalar.some((h) => h.startsWith("K4"))) {
    notlar.push("K4 ✓ kurulum kapısı tek kaynakta (workerCanSignIn), iki taraf da çağırıyor.");
  }

  // ── K5 · PIN BU UCA GELMEZ ─────────────────────────────────────────────
  if (!/"pin"\s+in\s+g/.test(ucKod) || !/pin_gonderilmemeli/.test(ucKod)) {
    hatalar.push(
      "K5 — PIN reddi kaldırılmış. Gövdede `pin` gelirse uç 400 dönmeli:\n" +
        "  sessizce yok saymak, PIN'i buraya göndermeye başlayan bir istemciyi\n" +
        "  fark edilmez kılar (yayılmada PIN, kişinin üye OLMADIĞI kiracılara gider)."
    );
  } else {
    notlar.push("K5 ✓ gövdede pin/sifre/password gelirse 400.");
  }
  if (/bcrypt|verifyCredentials|loginSchema/.test(ucKod)) {
    hatalar.push(
      "K5 — uç kimlik DOĞRULAMA zincirine dokunuyor (bcrypt/verifyCredentials/loginSchema).\n" +
        "  Bu uç yalnız adres bulur; PIN doğrulaması /api/mobile/auth/login'in işi."
    );
  }

  // ── K6 · CEVABA BAĞLI ERKEN ÇIKIŞ YOK ──────────────────────────────────
  const i = ucKod.indexOf("findWorkerByPhone(");
  if (i >= 0) {
    // Yalnız POST gövdesinin kuyruğu: sonraki `export` (GET vb.) sayıma girmez.
    const sonrasi = ucKod.slice(i);
    const kes = sonrasi.search(/\bexport\s+(async\s+)?function\b/);
    const kuyruk = kes > 0 ? sonrasi.slice(0, kes) : sonrasi;
    // DB hatası dönüşü (db_hatasi) meşru: cevabın DEĞERİNE değil, sorgunun
    // BAŞARISIZLIĞINA bağlı. Onun dışında tek bir dönüş kalmalı.
    const donusler = [...kuyruk.matchAll(/\breturn\s+/g)].length;
    const dbHatasi = /db_hatasi/.test(kuyruk) ? 1 : 0;
    if (donusler - dbHatasi > 1) {
      hatalar.push(
        `K6 — findWorkerByPhone sonrası ${donusler - dbHatasi} dönüş noktası var (1 olmalı).\n` +
          "  Cevabın DEĞERİNE bağlı bir erken çıkış, bugün ölçülerek gürültünün altında\n" +
          "  kaldığı gösterilen zamanlama farkını gerçek bir kanala çevirir."
      );
    } else {
      notlar.push("K6 ✓ sorgudan sonra tek dönüş noktası (zamanlama kanalı açılmıyor).");
    }
  }
}

// ── SONUÇ ────────────────────────────────────────────────────────────────
if (hatalar.length > 0) {
  console.error(`\n✗ KİRACI SORGU MUHAFIZI — ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
console.log("✓ kiracı sorgu muhafızı: 6 denetim geçti.");
for (const n of notlar) console.log("  " + n);
