#!/usr/bin/env node
/**
 * AKSİYON ERTELEME + İZİN KARARI MUHAFIZI — AĞ YOK, gerçek kodu çalıştırır.
 *
 * NE ÇÖZÜYOR: bu tur mobile ÜÇ yeni yazma ucu ekledi (erteleme, geri alma, izin
 * onay/ret). Üçünde de sessiz kusur riski var ve tip sistemi hiçbirini yakalamaz:
 *   · girdi ayıklaması gevşerse tabloya geçmiş anlı, boş kimlikli ya da
 *     megabaytlık satırlar girer — hepsi `string`tir, derleyici memnun;
 *   · kapı gevşerse (requireMobileAdmin → requireMobileFleetView) filo şefi
 *     patronun listesini yeniden düzenler;
 *   · `.upsert()` kullanılırsa KISMİ benzersiz indeks arbiter seçilemez ve
 *     ikinci erteleme çalışma anında düşer (058 notu);
 *   · izin kararı iki yüzeye KOPYALANIRSA panel ile mobil zamanla ayrışır.
 *
 * NEDEN AĞ YOK: kurallar saf fonksiyonlarda (lib/action-snoozes.ts,
 * lib/leave-decision.ts). Canlı veriye gerek duymadan kırılabilirler, bu yüzden
 * `npm run verify` zincirine giren ucuz bir denetim olabiliyorlar. Canlı
 * karşılığı ayrı betik: `scripts/verify-aksiyon-erteleme.mjs`.
 *
 * Çalıştır:  npm run lint:aksiyon-erteleme
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ERTELEME_KAYNAKLARI,
  KALEM_ID_MAX,
  ertelemeGirdisiniAyikla,
} from "@/lib/action-snoozes";
import {
  LEAVE_KARARLARI,
  KARAR_NOTU_MAX,
  kararStatusu,
  leaveKararindanAyikla,
} from "@/lib/leave-decision";

const ROOT = process.cwd();
let gecen = 0;
const dusen = [];
function kontrol(baslik, kosul, kanit) {
  if (kosul) gecen++;
  else dusen.push({ baslik, kanit });
}

/**
 * YORUMLARI SÖKÜP KAYNAĞI OKU — denetimler YALNIZ KODA baksın.
 *
 * ⚠️ Bu ilk koşumda ısırdı (11.08.2026): `.upsert()` yalnız AÇIKLAMA
 * satırlarında geçtiği hâlde ("neden upsert değil" notu) düz arama onu ÇAĞRI
 * sandı ve muhafız kendi belgelendirmesini kusur diye raporladı. Aynı ders
 * check-ariza-bildir.mjs'te `workers(name)` için de yazılı: bir dosyanın
 * yorumları, o dosyanın YAPMADIĞI şeyi anlatır.
 */
function koduAyikla(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
/** `.ts` kaynağını oku ve yorumlarından ayıkla. */
function kodOku(göreli) {
  return koduAyikla(readFileSync(path.join(ROOT, göreli), "utf8"));
}

/** Sabit "şimdi" — geçmiş/gelecek kuralları koşum saatine göre kaymasın. */
const SIMDI = Date.parse("2026-08-11T12:00:00.000Z");
const GELECEK = "2026-08-11T18:00:00.000Z";
const gövde = (o) => ({ kaynak: "alarm", kalemId: "abc", kadar: GELECEK, ...o });

// ══ 1 · KAYNAK KÜMESİ ══════════════════════════════════════════════════════
kontrol("kaynak kümesi üç değerli", ERTELEME_KAYNAKLARI.length === 3, ERTELEME_KAYNAKLARI.join("/"));
for (const k of ["alarm", "attention", "leave"]) {
  kontrol(`kümede '${k}' var`, ERTELEME_KAYNAKLARI.includes(k));
}
// Küme migration 058 CHECK'iyle AYNI olmalı; uç şemadan gevşek olursa yazma
// 23514 ile düşer ve kullanıcı "sunucu arızası" görür.
const ddl = readFileSync(path.join(ROOT, "db/migrations/058_action_snoozes.sql"), "utf8");
const checkKumesi = /check\s*\(item_source in \(([^)]*)\)\)/.exec(ddl)?.[1] ?? "";
kontrol(
  "uç kümesi 058 CHECK'iyle birebir",
  ERTELEME_KAYNAKLARI.every((k) => checkKumesi.includes(`'${k}'`)) &&
    (checkKumesi.match(/'/g) ?? []).length / 2 === ERTELEME_KAYNAKLARI.length,
  checkKumesi
);

// ══ 2 · ALAN HİÇ YOK ═══════════════════════════════════════════════════════
for (const g of [{}, null, undefined, [], "dize", 42]) {
  const r = ertelemeGirdisiniAyikla(g, SIMDI);
  kontrol(`gövde yok/yanlış → missing_fields: ${JSON.stringify(g)}`, !r.ok && r.kod === "missing_fields");
}
for (const alan of ["kaynak", "kalemId", "kadar"]) {
  const g = gövde({});
  delete g[alan];
  const r = ertelemeGirdisiniAyikla(g, SIMDI);
  kontrol(`'${alan}' yok → missing_fields + alan`, !r.ok && r.kod === "missing_fields" && r.alan === alan, r.alan);
}

// ══ 3 · TİP YANLIŞ ═════════════════════════════════════════════════════════
for (const alan of ["kaynak", "kalemId", "kadar"]) {
  for (const v of [1, true, null, [], {}]) {
    const r = ertelemeGirdisiniAyikla(gövde({ [alan]: v }), SIMDI);
    // null → "alan var ama kullanılamaz": missing_fields DEĞİL, invalid/tip.
    kontrol(
      `${alan} tipi yanlış → invalid/tip: ${JSON.stringify(v)}`,
      !r.ok && r.kod === "invalid" && r.alan === alan && r.sebep === "tip"
    );
  }
}

// ══ 4 · KAYNAK DEĞERİ ══════════════════════════════════════════════════════
for (const v of ["", " ", "Alarm", "ALARM", "dikkat", "izin", "attention leave", "alarm,leave"]) {
  const r = ertelemeGirdisiniAyikla(gövde({ kaynak: v }), SIMDI);
  kontrol(`geçersiz kaynak → invalid/deger: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.alan === "kaynak" && r.sebep === "deger");
}
for (const v of ["alarm", "attention", "leave", "  leave  "]) {
  const r = ertelemeGirdisiniAyikla(gövde({ kaynak: v }), SIMDI);
  kontrol(`geçerli kaynak KABUL: ${JSON.stringify(v)}`, r.ok && r.kaynak === v.trim(), r.ok ? r.kaynak : "reddedildi");
}

// ══ 5 · KALEM KİMLİĞİ ══════════════════════════════════════════════════════
for (const v of ["", " ", "   ", "\t", "\n", "\r\n  \t "]) {
  const r = ertelemeGirdisiniAyikla(gövde({ kalemId: v }), SIMDI);
  kontrol(`boş kalemId → invalid/bos: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.alan === "kalemId" && r.sebep === "bos");
}
const trimli = ertelemeGirdisiniAyikla(gövde({ kalemId: "  silent:abc  " }), SIMDI);
kontrol("kalemId TRIM edilir", trimli.ok && trimli.kalemId === "silent:abc", trimli.ok ? trimli.kalemId : "reddedildi");
kontrol(`tam sınır (${KALEM_ID_MAX}) KABUL`, ertelemeGirdisiniAyikla(gövde({ kalemId: "a".repeat(KALEM_ID_MAX) }), SIMDI).ok);
const uzun = ertelemeGirdisiniAyikla(gövde({ kalemId: "a".repeat(KALEM_ID_MAX + 1) }), SIMDI);
kontrol("sınır+1 → too_long", !uzun.ok && uzun.kod === "too_long" && uzun.alan === "kalemId");
kontrol("too_long UZUNLUĞU söyler", !uzun.ok && uzun.uzunluk === KALEM_ID_MAX + 1, String(uzun.uzunluk));
// Sessiz kırpma YASAK: uzun kimlik kesilip yazılmaz, REDDEDİLİR. Kesilseydi
// erteleme BAŞKA bir kaleme uygulanırdı.
kontrol("uzun kimlik KESİLMİYOR", !uzun.ok);
// Türetilmiş dikkat kalemleri uuid DEĞİL — kimlik uzayı serbest kalmalı.
for (const v of ["silent:9f2c", "unassignedMoving:abc-def", "penalty:1", "3f8e1b20-0000-4000-8000-000000000000"]) {
  kontrol(`türetilmiş kimlik kabul: ${v}`, ertelemeGirdisiniAyikla(gövde({ kalemId: v }), SIMDI).ok);
}

// ══ 6 · ZAMAN ══════════════════════════════════════════════════════════════
// Çıplak GÜN reddedilir: "2026-08-12" UTC gece yarısı olur ve Viyana'da 02:00'a
// denk gelir — kalem iki saat erken geri dönerdi.
for (const v of ["2026-08-12", "12.08.2026", "yarın", "", "2026-13-45T00:00:00Z", "2026-08-12T25:00:00Z", String(Date.now())]) {
  const r = ertelemeGirdisiniAyikla(gövde({ kadar: v }), SIMDI);
  kontrol(`geçersiz an → invalid/deger: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.alan === "kadar" && r.sebep === "deger");
}
// GEÇMİŞ AN: yazılsaydı liste süzgeci (`snoozed_until > now()`) onu hiç
// görmezdi — kullanıcı "ertelendi" der, kalem listede DURURDU. Sessiz hiçlik.
for (const v of ["2026-08-11T11:59:59.000Z", "2026-08-10T12:00:00.000Z", "1999-01-01T00:00:00.000Z"]) {
  const r = ertelemeGirdisiniAyikla(gövde({ kadar: v }), SIMDI);
  kontrol(`geçmiş an → invalid/gecmis: ${v}`, !r.ok && r.kod === "invalid" && r.alan === "kadar" && r.sebep === "gecmis");
}
kontrol("TAM ŞİMDİ de reddedilir (<=)", (() => { const r = ertelemeGirdisiniAyikla(gövde({ kadar: "2026-08-11T12:00:00.000Z" }), SIMDI); return !r.ok && r.sebep === "gecmis"; })());
kontrol("1 ms sonrası KABUL", ertelemeGirdisiniAyikla(gövde({ kadar: "2026-08-11T12:00:00.001Z" }), SIMDI).ok);
// Saat dilimli giriş normalize edilir — DB'ye ve yanıta tek biçim gider.
const ofsetli = ertelemeGirdisiniAyikla(gövde({ kadar: "2026-08-11T20:00:00+02:00" }), SIMDI);
kontrol("saat dilimli an UTC'ye normalize", ofsetli.ok && ofsetli.kadar === "2026-08-11T18:00:00.000Z", ofsetli.ok ? ofsetli.kadar : "reddedildi");

// ══ 7 · İZİN KARARI (saf) ══════════════════════════════════════════════════
kontrol("karar kümesi iki değerli", LEAVE_KARARLARI.length === 2, LEAVE_KARARLARI.join("/"));
kontrol("onay → approved", kararStatusu("onay") === "approved");
kontrol("ret → rejected", kararStatusu("ret") === "rejected");
// Eşleme tek yerde: migration 031 CHECK kümesinin dışına çıkılamaz.
const ddl31 = readFileSync(path.join(ROOT, "db/migrations/031_worker_leaves.sql"), "utf8");
kontrol("status hedefleri 031 CHECK'inde var", /check \(status in \('pending','approved','rejected'\)\)/.test(ddl31));

for (const g of [{}, null, undefined, [], "x", { baska: 1 }]) {
  const r = leaveKararindanAyikla(g);
  kontrol(`karar yok → missing_fields: ${JSON.stringify(g)}`, !r.ok && r.kod === "missing_fields" && r.alan === "karar");
}
for (const v of [1, true, null, [], {}]) {
  const r = leaveKararindanAyikla({ karar: v });
  kontrol(`karar tipi yanlış → invalid/tip: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "tip");
}
for (const v of ["", " ", "Onay", "ONAY", "approve", "evet", "onay ret"]) {
  const r = leaveKararindanAyikla({ karar: v });
  kontrol(`geçersiz karar → invalid/deger: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.alan === "karar" && r.sebep === "deger");
}
for (const v of ["onay", "ret", "  ret  "]) {
  const r = leaveKararindanAyikla({ karar: v });
  kontrol(`geçerli karar KABUL: ${JSON.stringify(v)}`, r.ok && r.karar === v.trim());
}
// `not` İSTEĞE BAĞLI.
kontrol("not yoksa null", (() => { const r = leaveKararindanAyikla({ karar: "onay" }); return r.ok && r.not === null; })());
kontrol("not null gönderilebilir", (() => { const r = leaveKararindanAyikla({ karar: "onay", not: null }); return r.ok && r.not === null; })());
kontrol("yalnız boşluk not → null", (() => { const r = leaveKararindanAyikla({ karar: "onay", not: "   " }); return r.ok && r.not === null; })());
kontrol("not TRIM edilir", (() => { const r = leaveKararindanAyikla({ karar: "ret", not: "  yoğunluk var  " }); return r.ok && r.not === "yoğunluk var"; })());
kontrol("not tipi yanlış → invalid/tip", (() => { const r = leaveKararindanAyikla({ karar: "onay", not: 5 }); return !r.ok && r.alan === "not" && r.sebep === "tip"; })());
kontrol(`not tam sınır (${KARAR_NOTU_MAX}) KABUL`, leaveKararindanAyikla({ karar: "onay", not: "a".repeat(KARAR_NOTU_MAX) }).ok);
kontrol("not sınır+1 → too_long", (() => { const r = leaveKararindanAyikla({ karar: "onay", not: "a".repeat(KARAR_NOTU_MAX + 1) }); return !r.ok && r.kod === "too_long" && r.alan === "not"; })());
// Türkçe karakter BAYT değil KARAKTER sayılır.
kontrol("Türkçe not karakterle sayılır", leaveKararindanAyikla({ karar: "onay", not: "ç".repeat(KARAR_NOTU_MAX) }).ok);

// ══ 8 · SAF KATMAN GERÇEKTEN SAF MI ════════════════════════════════════════
// Muhafızın çalışabilmesinin ön koşulu; bir DB çağrısı sızarsa bu betik hiç
// çalışmaz olur ve bunu HEMEN görürüz.
for (const dosya of ["lib/action-snoozes.ts", "lib/leave-decision.ts"]) {
  const src = kodOku(dosya);
  kontrol(`${dosya} server-only DEĞİL`, !/^\s*import\s+["']server-only["']/m.test(src));
  kontrol(`${dosya} supabase içe aktarmıyor`, !/^\s*import\s.*@\/lib\/supabase["']/m.test(src));
}

// ══ 9 · ERTELEME UÇLARI — KAYNAK DENETİMİ ══════════════════════════════════
const postSrc = kodOku("app/api/mobile/action-snoozes/route.ts");
kontrol("POST kapısı requireMobileAdmin", postSrc.includes("requireMobileAdmin("));
kontrol("POST daha gevşek kapı KULLANMIYOR", !/requireMobileWorker\(|requireMobileFleetView\(/.test(postSrc));
kontrol("POST ayıklaması lib/action-snoozes.ts'ten", postSrc.includes("ertelemeGirdisiniAyikla("));
kontrol("POST kendi kaynak listesini yazmıyor", !/\[\s*["']alarm["']\s*,\s*["']attention["']/.test(postSrc));
kontrol("POST kendi uzunluk sabitini tanımlamıyor", !/const\s+\w*MAX\w*\s*=\s*\d+/.test(postSrc));
// Erteleyen OTURUMDAN: gövdeden gelseydi "başkası adına erteleme" kurulabilirdi.
kontrol("erteleyen OTURUMDAN geçiliyor", /guard\.actor\.worker\.id/.test(postSrc));
kontrol("POST gövdeden snoozed_by/vehicle_id okumuyor", !/(snoozed_by|vehicle_id|worker_id)\s*:\s*[^,\n}]*\b(input|body|ayikla)\b/.test(postSrc));
kontrol("POST geçerli kümeyi yanıtta söylüyor", /gecerli:\s*ERTELEME_KAYNAKLARI/.test(postSrc));
kontrol("POST dosyası başka yöntem dışa açmıyor", !/export async function (GET|PUT|DELETE|PATCH)\b/.test(postSrc));

const patchSrc = kodOku("app/api/mobile/action-snoozes/[id]/route.ts");
kontrol("PATCH kapısı requireMobileAdmin", patchSrc.includes("requireMobileAdmin("));
kontrol("PATCH daha gevşek kapı KULLANMIYOR", !/requireMobileWorker\(|requireMobileFleetView\(/.test(patchSrc));
kontrol("PATCH kayıt yoksa 404", /mobileError\(404, "not_found"\)/.test(patchSrc));
kontrol("PATCH degisti bayrağı taşıyor", /degisti:\s*sonuc\.degisti/.test(patchSrc));
kontrol("PATCH dosyası DELETE dışa AÇMIYOR", !/export async function (GET|POST|PUT|DELETE)\b/.test(patchSrc));

// ══ 10 · SORGU KATMANI ═════════════════════════════════════════════════════
const dbSrc = kodOku("lib/action-snoozes-db.ts");
/**
 * `.upsert()` YASAK. Benzersizlik KISMİ indeksle kuruluyor (`where cancelled_at
 * is null`); PostgREST'in `on_conflict` parametresi WHERE yüklemini taşımadığı
 * için PostgreSQL o indeksi arbiter seçemez ve çağrı ÇALIŞMA ANINDA düşer.
 * Derleyici bunu görmez — denetim burada.
 */
kontrol("upsert KULLANILMIYOR (kısmi indeks arbiter olamaz)", !/\.upsert\(/.test(dbSrc));
kontrol("yarıştaki 23505 güncellemeye çevriliyor", /UNIQUE_VIOLATION/.test(dbSrc) && /23505/.test(dbSrc));
// Geri alma SİLME DEĞİL: satır silinirse "kim ertelemişti, kim geri aldı" izi gider.
kontrol("sorgu katmanı SİLME yapmıyor", !/\.delete\(\)/.test(dbSrc));
kontrol("geri alma cancelled_at yazıyor", /cancelled_at:\s*new Date\(\)\.toISOString\(\)/.test(dbSrc));
kontrol("zaten iptalliyse DB'ye dokunulmuyor", /cancelled_at !== null/.test(dbSrc));
// Liste süzgeci: İKİ koşul birden. Biri unutulursa iptal edilmiş ya da süresi
// dolmuş erteleme hâlâ "etkin" görünür ve kalem listeden kaybolmaya devam eder.
kontrol("liste cancelled_at null süzüyor", /\.is\("cancelled_at",\s*null\)/.test(dbSrc));
kontrol("liste snoozed_until > now süzüyor", /\.gt\("snoozed_until",\s*new Date\(\)\.toISOString\(\)\)/.test(dbSrc));
kontrol("liste tavanı var", /\.limit\(ERTELEME_LISTE_TAVANI\)/.test(dbSrc));
kontrol("tabloYokMu KOPYALANMAMIŞ, içe aktarılmış", /import \{ tabloYokMu \} from "@\/lib\/fault-reports"/.test(dbSrc) && !/function tabloYokMu/.test(dbSrc));
// Gövdeden sızma: insert YALNIZ dört alan yazmalı.
const insertBlok = /\.insert\(\{([\s\S]*?)\}\)/.exec(dbSrc)?.[1] ?? "";
kontrol(
  "insert YALNIZ item_source + item_id + snoozed_until + snoozed_by yazıyor",
  ["item_source", "item_id", "snoozed_until", "snoozed_by"].every((a) => insertBlok.includes(`${a}:`)) &&
    (insertBlok.match(/^\s*\w+:/gm) ?? []).length === 4,
  (insertBlok.match(/^\s*\w+:/gm) ?? []).join(",")
);

// ══ 11 · LİSTE UÇLARI — ertelemeler[] taşınıyor mu ═════════════════════════
const alarmSrc = kodOku("app/api/mobile/alarms/route.ts");
kontrol("alarms ertelemeleri okuyor", alarmSrc.includes("listActiveSnoozes("));
kontrol("alarms yanıtında ertelemeler var", /ertelemeler:\s*ertelemeler\.satirlar/.test(alarmSrc));
kontrol("alarms boş listenin SEBEBİNİ taşıyor", /ertelemeDurumu:/.test(alarmSrc));
kontrol("alarms tavanı sessiz değil", /ertelemeKirpildi:/.test(alarmSrc) && /ertelemeToplam:/.test(alarmSrc));
/**
 * SUNUCU SÜZMÜYOR: `alarmlar` dizisi ertelenmişler çıkarılarak dönmemeli.
 * Süzülürse "Ertelenen" sekmesinin göstereceği kalem de yok olurdu.
 */
kontrol("alarms ham listeyi SÜZMÜYOR", !/rows\s*=\s*rows\.filter\([^)]*erteleme/i.test(alarmSrc));
kontrol("alarms sayfalaması ertelemeden etkilenmiyor", /pageInfo\(page,\s*rows\.length\)/.test(alarmSrc));

const dashSrc = kodOku("app/api/mobile/dashboard/route.ts");
kontrol("dashboard ertelemeleri okuyor", dashSrc.includes("listActiveSnoozes("));
kontrol("dashboard yanıtında ertelemeler var", /ertelemeler:\s*gorunurErtelemeler/.test(dashSrc));
kontrol("dashboard boş listenin SEBEBİNİ taşıyor", /ertelemeDurumu:/.test(dashSrc));
/**
 * ŞEF DARALTMASI: şefe yalnız KENDİ dikkat listesinde karşılığı olan
 * `attention` ertelemeleri dönmeli. Kalkarsa şef, göremediği alarm ve izin
 * kalemlerinin kimliklerini görürdü.
 */
kontrol("dashboard şefte daraltıyor", /isChief\s*\?\s*ertelemeler\.satirlar\.filter/.test(dashSrc));
kontrol("daraltma attention + kendi kalemi koşullu", /e\.kaynak === "attention"/.test(dashSrc) && /kendiKalemleri\.has\(e\.kalemId\)/.test(dashSrc));
kontrol("dashboard uyari.kalemler SÜZÜLMÜYOR", !/kalemler\s*=\s*kalemler\.filter\([^)]*erteleme/i.test(dashSrc));

// ══ 12 · İZİN KARARI — ORTAK ÇEKİRDEK, KOPYA YOK ═══════════════════════════
const actionsSrc = kodOku("app/actions/leaves.ts");
const onaySrc = kodOku("app/api/mobile/leaves/[id]/onay/route.ts");
const coreSrc = kodOku("lib/leave-decision-db.ts");

kontrol("panel action ORTAK çekirdeği çağırıyor", /decideLeave\(/.test(actionsSrc));
kontrol("mobil uç ORTAK çekirdeği çağırıyor", /decideLeave\(/.test(onaySrc));
/**
 * KOPYA DENETİMİ — asıl mesele bu. Karar mantığı (status yazma) yalnız
 * çekirdekte olmalı; iki yüzeyden birine geri sızarsa ikisi zamanla ayrışır:
 * biri iz bırakır öteki bırakmaz, biri updated_at yazar öteki yazmaz.
 */
kontrol(
  "panel action kendi status'unu YAZMIYOR",
  !/status:\s*["'](approved|rejected)["']/.test(actionsSrc),
  (actionsSrc.match(/status:\s*["'](approved|rejected)["']/g) ?? []).join(",")
);
kontrol("mobil uç kendi status'unu YAZMIYOR", !/status:\s*["'](approved|rejected)["']/.test(onaySrc));
kontrol("mobil uç worker_leaves'e DOĞRUDAN yazmıyor", !/from\("worker_leaves"\)/.test(onaySrc));
/**
 * Panelin karar KAPISI yalnız kapı olmalı: yetkiyi geçirir, çekirdeği çağırır,
 * hatayı `LeaveActionResult`e çevirir. İçine tek bir DB yazması ya da
 * `revalidatePath` sızarsa iş yeniden iki yerde yapılıyor demektir.
 * (Sayıya değil BLOĞA bakılıyor: submit/delete akışlarının kendi
 * revalidate'leri yerinde duruyor ve onlar bu turun konusu değil.)
 */
const panelKararBlok = /async function decideLeaveFromPanel[\s\S]*?\n}/.exec(actionsSrc)?.[0] ?? "";
kontrol("panel karar kapısı bulundu", panelKararBlok.length > 0);
kontrol("panel karar kapısı kendi revalidate'ini YAPMIYOR", panelKararBlok.length > 0 && !/revalidatePath\(/.test(panelKararBlok));
kontrol("panel karar kapısı DB'ye DOĞRUDAN yazmıyor", panelKararBlok.length > 0 && !/supabaseAdmin/.test(panelKararBlok));
kontrol("panel karar kapısı kendi izini yazmıyor", panelKararBlok.length > 0 && !/logLeaveEdit\(/.test(panelKararBlok));
// approve/reject artık tek satır: çekirdeğe devrediyorlar.
kontrol("approveLeaveAction çekirdeğe devrediyor", /export async function approveLeaveAction[^{]*\{\s*return decideLeaveFromPanel\(id, "onay"\);\s*\}/.test(actionsSrc));
kontrol("rejectLeaveAction çekirdeğe devrediyor", /export async function rejectLeaveAction[^{]*\{\s*return decideLeaveFromPanel\(id, "ret"\);\s*\}/.test(actionsSrc));
kontrol("çekirdek status eşlemesini lib/leave-decision.ts'ten alıyor", /kararStatusu\(/.test(coreSrc) && !/["'](approved|rejected)["']\s*:/.test(coreSrc));
kontrol("çekirdek izi yazıyor", /logLeaveEdit\(/.test(coreSrc));
kontrol("çekirdek önbelleği tazeliyor", /revalidatePath\(/.test(coreSrc));

kontrol("mobil onay kapısı requireMobileAdmin", onaySrc.includes("requireMobileAdmin("));
kontrol("mobil onay daha gevşek kapı KULLANMIYOR", !/requireMobileWorker\(|requireMobileFleetView\(/.test(onaySrc));
kontrol("mobil onay ayıklaması lib/leave-decision.ts'ten", onaySrc.includes("leaveKararindanAyikla("));
kontrol("mobil onay kendi karar listesini yazmıyor", !/\[\s*["']onay["']\s*,\s*["']ret["']\s*\]/.test(onaySrc));
kontrol("mobil onay kayıt yoksa 404", /mobileError\(404, "not_found"\)/.test(onaySrc));
kontrol("mobil onay geçerli kümeyi söylüyor", /gecerli:\s*LEAVE_KARARLARI/.test(onaySrc));
kontrol("mobil onay dosyası başka yöntem dışa açmıyor", !/export async function (GET|PUT|DELETE|PATCH)\b/.test(onaySrc));
// Karar notu TALEBİN notunu EZMEMELİ: worker_leaves.note kararla yazılırsa
// talebi açanın metni sessizce kaybolur.
kontrol("karar notu worker_leaves.note'a YAZILMIYOR", !/note:\s*not\b/.test(coreSrc) && !/note:\s*ayikla\.not/.test(onaySrc));
const logSrc = readFileSync(path.join(ROOT, "lib/leave-edit-log.ts"), "utf8");
kontrol("karar notu ize AYRI satır olarak yazılıyor", /field:\s*"karar_notu"/.test(logSrc));
kontrol("karar notu yalnız approve/reject'te", /action === "approve" \|\| action === "reject"/.test(logSrc));

// ══ 13 · DDL (migration 058) ═══════════════════════════════════════════════
kontrol("058 tabloyu tanımlıyor", /create table if not exists public\.action_snoozes/.test(ddl));
kontrol("058 item_id TEXT (uuid değil)", /item_id\s+text not null/.test(ddl));
// uuid olsaydı türetilmiş dikkat kalemleri ("silent:<id>") dışarıda kalırdı.
kontrol("058 item_id uuid DEĞİL", !/item_id\s+uuid/.test(ddl));
kontrol("058 cancelled_at kolonu var", /cancelled_at\s+timestamptz/.test(ddl));
kontrol("058 snoozed_by FK'li ve NOT NULL", /snoozed_by\s+uuid not null references public\.workers\(id\)/.test(ddl));
kontrol("058 snoozed_by'da CASCADE YOK", !/snoozed_by[^,;]*on delete cascade/.test(ddl));
kontrol("058 benzersiz indeks KISMİ", /create unique index[\s\S]*?on public\.action_snoozes\(item_source,\s*item_id\)[\s\S]*?where cancelled_at is null/.test(ddl));
kontrol("058 snoozed_until indeksi var", /create index if not exists idx_action_snoozes_until/.test(ddl));
kontrol("058 RLS'i açıkça kapatıyor", /alter table public\.action_snoozes disable row level security/.test(ddl));
kontrol("058 PostgREST önbelleğini tazeliyor", /notify pgrst, 'reload schema'/.test(ddl));
// item_id'ye FK KONULAMAZ: üç kaynaktan geliyor ve ikisinin satırı bile yok.
kontrol("058 item_id'ye FK konulmamış", !/item_id[^,;]*references/.test(ddl));
/**
 * Gizlilik: DDL dosyalarına gerçek plaka/kişi verisi yazılmaz (031'deki kural).
 * "HAK61" KURULUM adıdır, plaka ya da kişi değil — 057 de aynı cümleyi taşıyor;
 * ilk yazımda desen onu yakalayıp kendi başlığını kusur saymıştı.
 */
kontrol(
  "058'de e-posta/plaka YOK (gizlilik)",
  !/@[\w.-]+\.\w{2,}/.test(ddl) && !/\b[A-ZÄÖÜ]{1,2}-\d{3,5}\s?[A-Z]{0,2}\b/.test(ddl),
  (/\b[A-ZÄÖÜ]{1,2}-\d{3,5}\s?[A-Z]{0,2}\b/.exec(ddl) ?? [""])[0]
);

// ── Sonuç ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ aksiyon erteleme muhafızı: ${gecen} denetim geçti (girdi + kaynak + DDL + kopya).`);
  process.exit(0);
}
console.error(`\n✗ AKSİYON ERTELEME MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.error(`  · ${d.baslik}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.error(`
  Bu denetimler uçların SÖZLERİDİR:
    · geçmiş bir ana erteleme YAZILMAZ (yazılsaydı kalem listede kalırdı)
    · çıplak gün ("2026-08-12") reddedilir — Viyana'da iki saat erken dönerdi
    · kalem kimliği sessizce KESİLMEZ; kesilse erteleme BAŞKA kaleme uygulanırdı
    · aynı kalem ikinci kez ertelenirse yeni satır açılmaz, GÜNCELLENİR
    · geri alma satırı SİLMEZ — kim ertelemiş, kim geri almış izi kalır
    · liste süzgeci İKİ koşullu: iptal edilmemiş VE süresi geçmemiş
    · sunucu ham listeyi SÜZMEZ; süzme istemcide (Ertelenen sekmesi lazım)
    · şef, göremediği kalemlerin ertelemelerini GÖRMEZ
    · izin kararı TEK çekirdekte — panel ile mobil ayrışamaz
    · karar notu talebi açanın notunu EZMEZ, ize yazılır
    · dört kapı da requireMobileAdmin
`);
process.exit(1);
