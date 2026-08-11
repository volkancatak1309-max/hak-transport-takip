#!/usr/bin/env node
/**
 * ARIZA BİLDİRİMİ MUHAFIZI (U7) — AĞ YOK, gerçek ayıklama kodunu çalıştırır.
 *
 * NE ÇÖZÜYOR: bu uç mobilin auth dışı İKİNCİ yazma ucu. Girdi ayıklaması
 * gevşerse tabloya boş açıklamalı, yalnız-boşluklu ya da megabaytlık satırlar
 * girer ve bunu tip sistemi YAKALAMAZ — `aciklama` her hâlükârda `string`tir.
 * Kapı gevşerse (requireMobileAdmin → requireMobileWorker) her şoför her araca
 * yazar. İkisi de sessiz kusurlardır; ekranda bir belirti vermezler.
 *
 * NEDEN AĞ YOK: kurallar saf fonksiyonlarda (lib/fault-reports.ts). Girdileri
 * elde; canlı veriye gerek duymadan kırılabilirler, bu yüzden `npm run verify`
 * zincirine giren ucuz bir denetim olabiliyorlar. Canlı karşılığı ayrı betik:
 * `scripts/verify-ariza-bildir.mjs` (gerçek uç + gerçek yazma + temizlik).
 *
 * Çalıştır:  npm run lint:ariza-bildir
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARIZA_ACIKLAMA_MAX,
  arizaAciklamasiniAyikla,
  tabloYokMu,
} from "@/lib/fault-reports";

const ROOT = process.cwd();
let gecen = 0;
const dusen = [];
function kontrol(baslik, kosul, kanit) {
  if (kosul) gecen++;
  else dusen.push({ baslik, kanit });
}

// ══ 1 · ALAN HİÇ YOK ═══════════════════════════════════════════════════════
for (const gövde of [{}, { baska: "x" }, null, undefined]) {
  const r = arizaAciklamasiniAyikla(gövde);
  kontrol(`alan yok → missing_fields: ${JSON.stringify(gövde)}`, !r.ok && r.kod === "missing_fields");
}

// ══ 2 · TİP YANLIŞ ═════════════════════════════════════════════════════════
// `aciklama` VAR ama string değil. "missing_fields" demek yanlış cümle olurdu:
// alan gönderilmiş, kullanılamaz hâlde.
for (const v of [1, 0, true, false, null, [], {}, { toString: 1 }]) {
  const r = arizaAciklamasiniAyikla({ aciklama: v });
  kontrol(`tip yanlış → invalid/tip: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "tip");
}

// ══ 3 · BOŞ ════════════════════════════════════════════════════════════════
// Yalnız boşluk (boşluk, sekme, satır sonu, tarayıcıların ürettiği NBSP-siz
// varyantlar) BOŞ bildirimdir. Tabloya girerse listede tıklanabilir ama
// içeriksiz bir satır olur.
for (const v of ["", " ", "   ", "\t", "\n", "\r\n  \t "]) {
  const r = arizaAciklamasiniAyikla({ aciklama: v });
  kontrol(`boş → invalid/bos: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "bos");
}

// ══ 4 · TRIM ═══════════════════════════════════════════════════════════════
const trimli = arizaAciklamasiniAyikla({ aciklama: "  Motor rölantide titriyor.\n" });
kontrol("baştaki/sondaki boşluk kırpılır", trimli.ok && trimli.aciklama === "Motor rölantide titriyor.", trimli.ok ? JSON.stringify(trimli.aciklama) : "reddedildi");
const icBosluk = arizaAciklamasiniAyikla({ aciklama: "Fren  sesi\nve  titreşim" });
kontrol("İÇ boşluk/satır sonu KORUNUR", icBosluk.ok && icBosluk.aciklama === "Fren  sesi\nve  titreşim");

// ══ 5 · UZUNLUK SINIRI ═════════════════════════════════════════════════════
const tamSinir = "a".repeat(ARIZA_ACIKLAMA_MAX);
kontrol(`tam sınır (${ARIZA_ACIKLAMA_MAX}) KABUL`, arizaAciklamasiniAyikla({ aciklama: tamSinir }).ok);
const birFazla = arizaAciklamasiniAyikla({ aciklama: "a".repeat(ARIZA_ACIKLAMA_MAX + 1) });
kontrol("sınır+1 → too_long", !birFazla.ok && birFazla.kod === "too_long");
kontrol("too_long UZUNLUĞU söyler", !birFazla.ok && birFazla.uzunluk === ARIZA_ACIKLAMA_MAX + 1, String(birFazla.uzunluk));
// Kırpma SINIRDAN ÖNCE: sınırın altına inen metin reddedilmemeli.
const bosluklu = arizaAciklamasiniAyikla({ aciklama: "   " + tamSinir + "   " });
kontrol("kırpınca sınıra sığan metin KABUL", bosluklu.ok && bosluklu.aciklama.length === ARIZA_ACIKLAMA_MAX);
// Sessiz kırpma YASAK: uzun metin kesilip kaydedilmez, REDDEDİLİR.
kontrol("uzun metin KESİLMİYOR (ok:false)", !birFazla.ok);

// ══ 6 · TÜRKÇE / UNICODE ═══════════════════════════════════════════════════
// Karakter sayımı bayt sayımı DEĞİL: "ç" tek karakterdir. Bayt sayılsaydı
// Türkçe bir bildirim İngilizcesinden erken reddedilirdi.
const tr = "Şanzıman çığlık atıyor, debriyaj ağır.";
const rtr = arizaAciklamasiniAyikla({ aciklama: tr });
kontrol("Türkçe metin bozulmadan geçer", rtr.ok && rtr.aciklama === tr);
kontrol("Türkçe sınır KARAKTERLE sayılır", arizaAciklamasiniAyikla({ aciklama: "ç".repeat(ARIZA_ACIKLAMA_MAX) }).ok);
kontrol("emoji tek kod noktası olarak sayılır", arizaAciklamasiniAyikla({ aciklama: "⚠" .repeat(ARIZA_ACIKLAMA_MAX) }).ok);

// ══ 7 · TABLO YOK AYRIMI ═══════════════════════════════════════════════════
// "056 uygulanmamış" ile "yazma düştü" AYNI ŞEY DEĞİL; yöneticiye farklı iş
// yaptırır. Yeni kurulumların install SQL'inde 056 YOK.
for (const e of [
  { code: "42P01", message: 'relation "public.vehicle_fault_reports" does not exist' },
  { code: "PGRST205", message: "Could not find the table 'public.vehicle_fault_reports' in the schema cache" },
  { code: null, message: "relation does not exist" },
]) {
  kontrol(`tablo yok tanınıyor: ${e.code ?? "kodsuz"}`, tabloYokMu(e) === true);
}
for (const e of [
  { code: "57014", message: "canceling statement due to statement timeout" },
  { code: "23503", message: "insert or update violates foreign key constraint" },
  { code: "23514", message: "new row violates check constraint" },
  { code: null, message: null },
]) {
  kontrol(`tablo yok DEĞİL: ${e.code ?? "kodsuz"}`, tabloYokMu(e) === false);
}

// ══ 8 · KAYNAK DENETİMİ ════════════════════════════════════════════════════
const UC = "app/api/mobile/vehicles/[id]/ariza-bildir/route.ts";
const src = readFileSync(path.join(ROOT, UC), "utf8");

// Kapı: kardeş araç uçlarıyla aynı katman. Gevşerse her şoför her araca yazar.
kontrol("requireMobileAdmin kapısı", src.includes("requireMobileAdmin("));
kontrol("daha gevşek kapı KULLANILMIYOR", !/requireMobileWorker\(|requireMobileFleetView\(/.test(src));

// Yazma ANAHTARLI: hedef ve kimlik gövdeden GELMEZ.
kontrol("vehicle_id YOLDAN geliyor", /vehicle_id:\s*id\b/.test(src));
kontrol("reported_by OTURUMDAN geliyor", /reported_by:\s*guard\.actor\.worker\.id/.test(src));
// `durum` gövdeden okunursa bildiren kendi bildirimini doğrudan "kapali"
// açabilirdi — kapatma ayrı bir yüzeydir ve bugün YOK.
// `(body as {...}).durum` gibi sarmalanmış hâlleri de yakalasın diye satırın
// tamamına bakılıyor — enjeksiyon denemesinde dar desen kaçırmıştı.
kontrol("durum gövdeden ALINMIYOR", !/durum:\s*[^,\n}]*\b(input|body|ayikla|req)\b/.test(src));
// Insert'te yalnız üç alan olmalı; dördüncüsü gövdeden sızmış demektir.
const insertBlok = /\.insert\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? "";
kontrol(
  "insert YALNIZ vehicle_id + reported_by + aciklama yazıyor",
  ["vehicle_id", "reported_by", "aciklama"].every((a) => insertBlok.includes(`${a}:`)) &&
    (insertBlok.match(/^\s*\w+:/gm) ?? []).length === 3,
  (insertBlok.match(/^\s*\w+:/gm) ?? []).join(",")
);

// Yanıt kayıt kimliğini TAŞIMALI — istemci bildirimi sonradan gösteremezse
// yazma körleşir.
kontrol("select kayıt id'sini geri okuyor", /\.select\(\s*["'][^"']*\bid\b/.test(src));
kontrol("yanıt gövdesinde id var", /id:\s*row\.id/.test(src));
kontrol("201 döndürüyor", /status:\s*201/.test(src));

// Ayıklama tek kaynaktan: route kendi kurallarını YAZMAMALI, yoksa muhafız
// gerçek kodu değil ölü bir kopyayı sınar.
kontrol("ayıklama lib/fault-reports.ts'ten", src.includes("arizaAciklamasiniAyikla("));
kontrol("route kendi uzunluk sabitini tanımlamıyor", !/const\s+\w*MAX\w*\s*=\s*\d+/.test(src));

// Saf katman gerçekten saf mı — muhafızın çalışabilmesinin ön koşulu.
const lib = readFileSync(path.join(ROOT, "lib/fault-reports.ts"), "utf8");
kontrol("lib/fault-reports.ts server-only DEĞİL", !/^\s*import\s+["']server-only["']/m.test(lib));
kontrol("lib/fault-reports.ts supabase içe aktarmıyor", !/^\s*import\s.*@\/lib\/supabase["']/m.test(lib));

// Migration dosyası duruyor mu (uç onsuz çalışmaz).
const ddl = readFileSync(path.join(ROOT, "db/migrations/056_vehicle_fault_reports.sql"), "utf8");
kontrol("056 tabloyu tanımlıyor", /create table if not exists public\.vehicle_fault_reports/.test(ddl));
kontrol("durum CHECK'i iki değerli", /check\s*\(durum in \('acik',\s*'kapali'\)\)/.test(ddl));
kontrol("aciklama NOT NULL", /aciklama\s+text\s+not null/.test(ddl));

// ── Sonuç ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ arıza bildirimi muhafızı: ${gecen} denetim geçti (girdi + kaynak + DDL).`);
  process.exit(0);
}
console.error(`\n✗ ARIZA BİLDİRİMİ MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.error(`  · ${d.baslik}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.error(`
  Bu denetimler ucun SÖZLERİDİR:
    · boş / yalnız-boşluklu açıklama tabloya GİRMEZ
    · uzun metin sessizce KESİLMEZ, reddedilir ve uzunluğu söylenir
    · hedef araç yoldan, bildiren oturumdan — gövdeden DEĞİL
    · durum gövdeden alınmaz (yeni bildirim daima 'acik')
    · kapı requireMobileAdmin
    · yanıt kayıt kimliğini taşır
`);
process.exit(1);
