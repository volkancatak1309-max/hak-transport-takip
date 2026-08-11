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
  ARIZA_DURUMLARI,
  arizaAciklamasiniAyikla,
  arizaDurumunuAyikla,
  kolonYokMu,
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

// ══ 7b · KOLON YOK AYRIMI (migration 057) ══════════════════════════════════
// "057 uygulanmamış" ile "tablo yok" ve "sorgu düştü" ÜÇ AYRI şey. İlkinde uç
// çalışmaya devam eder, yalnız kapatma izi tutulmaz ve bunu SÖYLER.
for (const e of [
  { code: "42703", message: 'column vehicle_fault_reports.closed_at does not exist' },
  { code: "PGRST204", message: "Could not find the 'closed_by' column of 'vehicle_fault_reports'" },
  { code: null, message: "column closed_at does not exist" },
]) {
  kontrol(`kolon yok tanınıyor: ${e.code ?? "kodsuz"}`, kolonYokMu(e) === true);
}
for (const e of [
  { code: "42P01", message: 'relation "public.vehicle_fault_reports" does not exist' },
  { code: "57014", message: "canceling statement due to statement timeout" },
  { code: null, message: null },
]) {
  kontrol(`kolon yok DEĞİL: ${e.code ?? "kodsuz"}`, kolonYokMu(e) === false);
}
// İki ayrım BİRBİRİNE karışmamalı: tablo yokken "kolon yok" demek, yöneticiye
// 057'yi çalıştırtır ve asıl eksik 056 gizlenirdi.
kontrol(
  "tablo yok ↔ kolon yok ayrımı karışmıyor",
  tabloYokMu({ code: "42P01", message: "relation does not exist" }) === true &&
    kolonYokMu({ code: "42P01", message: "relation does not exist" }) === false &&
    kolonYokMu({ code: "42703", message: "column closed_at does not exist" }) === true &&
    tabloYokMu({ code: "42703", message: "column closed_at does not exist" }) === false
);

// ══ 8 · DURUM AYIKLAMA (PATCH ucu) ═════════════════════════════════════════
kontrol("durum kümesi iki değerli", ARIZA_DURUMLARI.length === 2, ARIZA_DURUMLARI.join("/"));
kontrol("küme 'acik' ve 'kapali'", ARIZA_DURUMLARI.includes("acik") && ARIZA_DURUMLARI.includes("kapali"));
// Ara durum eklenirse (Volkan 11.08: EKLENMEYECEK) bu denetim düşer ve karar
// yeniden konuşulur — sessizce genişlemesin.
kontrol("ara durum EKLENMEMİŞ", !ARIZA_DURUMLARI.includes("islemde"));

for (const gövde of [{}, { baska: "x" }, null, undefined]) {
  const r = arizaDurumunuAyikla(gövde);
  kontrol(`durum alanı yok → missing_fields: ${JSON.stringify(gövde)}`, !r.ok && r.kod === "missing_fields");
}
for (const v of [1, true, null, [], {}, ["kapali"]]) {
  const r = arizaDurumunuAyikla({ durum: v });
  kontrol(`durum tipi yanlış → invalid/tip: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "tip");
}
// Şema CHECK'i bu değerleri reddediyor; uç ondan GEVŞEK olmamalı, yoksa
// yazma 23514 ile düşer ve kullanıcı "sunucu arızası" görür.
for (const v of ["", " ", "Kapali", "KAPALI", "islemde", "kapandi", "closed", "acik ve kapali"]) {
  const r = arizaDurumunuAyikla({ durum: v });
  kontrol(`geçersiz durum → invalid/deger: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "deger");
}
for (const v of ["acik", "kapali", "  kapali  "]) {
  const r = arizaDurumunuAyikla({ durum: v });
  kontrol(`geçerli durum KABUL: ${JSON.stringify(v)}`, r.ok && r.durum === v.trim(), r.ok ? r.durum : "reddedildi");
}
// TEK YÖNLÜ DEĞİL: yeniden açma da geçerli. Kapalıyı geri açmanın yolu
// olmasaydı tek çare kaydı silmek, yani geçmişi yok etmek olurdu.
kontrol("yeniden açma ('acik') geçerli", arizaDurumunuAyikla({ durum: "acik" }).ok === true);

// ══ 9 · KAYNAK DENETİMİ ════════════════════════════════════════════════════
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

// ── PATCH ucu (kapatma / yeniden açma) ─────────────────────────────────────
const patchSrc = readFileSync(path.join(ROOT, "app/api/mobile/fault-reports/[id]/route.ts"), "utf8");
kontrol("PATCH kapısı requireMobileAdmin", patchSrc.includes("requireMobileAdmin("));
kontrol("PATCH daha gevşek kapı KULLANMIYOR", !/requireMobileWorker\(|requireMobileFleetView\(/.test(patchSrc));
kontrol("PATCH ayıklaması lib/fault-reports.ts'ten", patchSrc.includes("arizaDurumunuAyikla("));
kontrol("PATCH kendi durum listesini yazmıyor", !/\[\s*["']acik["']\s*,\s*["']kapali["']\s*\]/.test(patchSrc));
// KISMİ güncelleme: yalnız `durum` yazılır. `aciklama`/`reported_by` gövdeden
// güncellenebilseydi bildirim geçmişe dönük olarak DEĞİŞTİRİLEBİLİRDİ.
// Değerin TAMAMINA bakılır, ilk kelimesine değil: `(body as {...}).aciklama`
// sarmalını dar desen kaçırıyordu (arıza enjeksiyonu gösterdi, 11.08.2026).
kontrol(
  "PATCH yalnız durum yazıyor",
  !/\baciklama:\s*[^,\n}]*\b(input|body|ayikla|req)\b/.test(patchSrc) && !/reported_by:/.test(patchSrc)
);
kontrol("PATCH kayıt yoksa 404", /mobileError\(404, "not_found"\)/.test(patchSrc));
kontrol("PATCH geçerli kümeyi yanıtta söylüyor", /gecerli:\s*ARIZA_DURUMLARI/.test(patchSrc));
kontrol("PATCH degisti bayrağı taşıyor", /degisti:\s*sonuc\.degisti/.test(patchSrc));
// Yalnız PATCH: bu yol GET/POST/DELETE kabul etmemeli.
kontrol("PATCH dosyası başka yöntem dışa açmıyor", !/export async function (GET|POST|PUT|DELETE)\b/.test(patchSrc));

// ── Okuma yüzeyi: araç detayında liste ─────────────────────────────────────
const detaySrc = readFileSync(path.join(ROOT, "app/api/mobile/vehicles/[id]/route.ts"), "utf8");
kontrol("araç detayı bildirimleri okuyor", detaySrc.includes("listVehicleFaultReports("));
kontrol("yanıtta arizaBildirimleri var", /arizaBildirimleri:/.test(detaySrc));
// Boş liste ÜÇ ayrı şey olabilir (yok / tablo_yok / hata) — sebep taşınmalı.
kontrol("boş listenin SEBEBİ taşınıyor", /arizaBildirimDurumu:/.test(detaySrc));
kontrol("tavan sessiz değil", /arizaBildirimKirpildi:/.test(detaySrc) && /arizaBildirimToplam:/.test(detaySrc));
// Cihazın DTC'leriyle KARIŞMAMALI: iki farklı güven düzeyi, iki ayrı dizi.
kontrol("elle bildirimler DTC dizisine karışmamış", !/arizalar:\s*\[\s*\.\.\.bildirimler/.test(detaySrc));

const dbSrc = readFileSync(path.join(ROOT, "lib/fault-reports-db.ts"), "utf8");
kontrol("liste YENİDEN ESKİYE sıralı", /order\("created_at",\s*\{\s*ascending:\s*false/.test(dbSrc));
kontrol("liste tavanı var", /\.limit\(ARIZA_LISTE_TAVANI\)/.test(dbSrc));
/**
 * Güncelleme nesnesinde TEK alan olmalı. Yazma BURADA yapılıyor (route değil,
 * sorgu katmanı) — ilk denemede denetim yanlış dosyaya bakıyordu ve enjekte
 * edilen arıza sessizce geçti. İkinci alan gövdeden sızmış demektir: bildirim
 * geçmişe dönük DEĞİŞTİRİLEBİLİR olurdu.
 */
// Yama nesnesi artık değişken (`yama`); içine YALNIZ durum + 057 izi girmeli.
kontrol("yama nesnesi durum ile kuruluyor", /const yama[^=]*=\s*\{\s*durum\s*\}/.test(dbSrc));
kontrol(
  "yamaya aciklama/reported_by SIZMIYOR",
  !/yama\.(aciklama|reported_by|vehicle_id)\s*=/.test(dbSrc) && !/\.update\(\{[^}]*aciklama/.test(dbSrc)
);

// ── Kapatma izi (migration 057) ────────────────────────────────────────────
// Kapanışta iz YAZILIR, yeniden açılışta NULL'a döner. İkincisi unutulursa
// açık bir bildirim "falanca kapattı" diye görünmeye devam ederdi.
kontrol("kapanışta closed_at yazılıyor", /closed_at\s*=\s*kapaniyor\s*\?/.test(dbSrc));
kontrol("kapanışta closed_by OTURUMDAN", /closed_by\s*=\s*kapaniyor\s*\?\s*workerId/.test(dbSrc));
kontrol("yeniden açılışta ikisi de null", /closed_at\s*=\s*kapaniyor\s*\?[^:]*:\s*null/.test(dbSrc) && /closed_by\s*=\s*kapaniyor\s*\?[^:]*:\s*null/.test(dbSrc));
/**
 * DEĞİŞİKLİK YOKSA YAZMA YOK — yoksa aynı durumu ikinci kez göndermek
 * `closed_at`i TAZELER ve İLK kapatma anı kaybolur. Sessiz veri kaybı.
 */
kontrol("durum aynıysa DB'ye dokunulmuyor", /if\s*\(oncekiSatir\.durum === durum\)/.test(dbSrc));
kontrol("kolon yoksa geri düşülüyor", dbSrc.includes("kolonYokMu(") && /izVar/.test(dbSrc));
kontrol("liste de kolon yoksa geri düşüyor", (dbSrc.match(/kolonYokMu\(/g) ?? []).length >= 2);
kontrol("closed_by adı da çözülüyor", /r\.closed_by/.test(dbSrc) && /kapatan:/.test(dbSrc));
kontrol("PATCH oturumdaki kişiyi geçiriyor", /setFaultReportStatus\(id,\s*ayikla\.durum,\s*guard\.actor\.worker\.id\)/.test(patchSrc));
kontrol("PATCH kapatma izini yanıtta söylüyor", /kapatmaIzi:\s*sonuc\.kapatmaIzi/.test(patchSrc));
kontrol("araç detayı kapatma izini söylüyor", /arizaBildirimKapatmaIzi:/.test(detaySrc));

// Migration 057 kaydı deponun şema listesinde duruyor mu.
const ddl57 = readFileSync(path.join(ROOT, "db/migrations/057_fault_report_closed.sql"), "utf8");
kontrol("057 closed_at ekliyor", /add column if not exists closed_at timestamptz/.test(ddl57));
kontrol("057 closed_by ekliyor", /add column if not exists closed_by uuid references public\.workers\(id\)/.test(ddl57));
kontrol("057 CASCADE koymuyor", !/closed_by[^,;]*on delete cascade/.test(ddl57));
// Gömme (`select("…, workers(name)")`) YOK: ilişki şema önbelleğinde
// çözülmezse tüm sorgu düşerdi; ad çözülemezse yalnız ad null olmalı, satır
// kaybolmamalı. Denetim SELECT dizelerine bakar — dosyanın yorumları da
// "workers(name)" kelimesini geçiriyor ve düz arama onu gömme sanmıştı.
const selectler = [...dbSrc.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
kontrol(
  "bildiren adı AYRI sorgudan (select'te gömme yok)",
  selectler.length > 0 && selectler.every((s) => !s.includes("(")) && dbSrc.includes('.from("workers")'),
  selectler.join(" | ")
);

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
  Bu denetimler uçların SÖZLERİDİR:
    · boş / yalnız-boşluklu açıklama tabloya GİRMEZ
    · uzun metin sessizce KESİLMEZ, reddedilir ve uzunluğu söylenir
    · hedef araç yoldan, bildiren oturumdan — gövdeden DEĞİL
    · yeni bildirim daima 'acik'; durum YALNIZ PATCH ile değişir
    · durum kümesi iki değerli, uç şema CHECK'inden gevşek olamaz
    · PATCH yalnız durumu yazar — açıklama geçmişe dönük DEĞİŞTİRİLEMEZ
    · üç kapı da requireMobileAdmin
    · boş listenin sebebi (yok / tablo_yok / hata) ve tavan SÖYLENİR
`);
process.exit(1);
