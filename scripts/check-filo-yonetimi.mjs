#!/usr/bin/env node
/**
 * FİLO YÖNETİMİ MUHAFIZI — AĞ YOK, gerçek kodu çalıştırır.
 *
 * NE ÇÖZÜYOR: bu tur mobile üç yazma ucu ekledi (yeni filo, yeniden adlandırma,
 * toplu taşıma) ve dördüncü bir okuma ucu. Sessiz kusur riski yüksek, tip
 * sistemi hiçbirini yakalamaz:
 *   · kapı gevşerse (requireMobileAdmin → requireMobileFleetView) filo ŞEFİ
 *     karşı filodan kendi filosuna araç çekebilir;
 *   · girdi ayıklaması gevşerse uuid olmayan tek bir kimlik `.in("id", …)`
 *     üzerinden 22P02 fırlatır ve GEÇERLİ 20 aracın taşınması da düşer;
 *   · tavan sabiti 059'un CHECK'inden ayrışırsa altıncı filo ham 23505 ile
 *     "sunucu arızası" gibi görünür;
 *   · taşıma güncellemesi `fleet` dışında bir kolona uzanırsa (ör. şoför
 *     ataması) tek düğme iki ayrı kararı birden verir;
 *   · sayım sorguları test elemesini kaybederse test aracı filo sayısını şişirir.
 *
 * NEDEN AĞ YOK: kurallar saf fonksiyonlarda (lib/fleets.ts). Canlı veriye gerek
 * duymadan kırılabilirler, bu yüzden `npm run verify` zincirine giren ucuz bir
 * denetim olabiliyorlar. Canlı karşılığı ayrı: scripts/verify-filo-yonetimi.mjs
 *
 * Çalıştır:  npm run lint:filo-yonetimi
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FILO_TAVANI,
  FILO_ADI_MAX,
  LEGACY_FILO_KODLARI,
  ATAMA_LISTE_TAVANI,
  varsayilanFiloAdi,
  filoKoduUret,
  filoAdiniAyikla,
  atamaGirdisiniAyikla,
} from "@/lib/fleets";

const ROOT = process.cwd();
let gecen = 0;
const dusen = [];
function kontrol(baslik, kosul, kanit) {
  if (kosul) gecen++;
  else dusen.push({ baslik, kanit });
}

/**
 * YORUMLARI SÖKÜP KAYNAĞI OKU — denetimler YALNIZ KODA baksın.
 * (check-aksiyon-erteleme.mjs'te 11.08.2026'da ısıran ders: bir dosyanın
 * yorumları, o dosyanın YAPMADIĞI şeyi anlatır.)
 */
function koduAyikla(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const kodOku = (göreli) => koduAyikla(readFileSync(path.join(ROOT, göreli), "utf8"));
const hamOku = (göreli) => readFileSync(path.join(ROOT, göreli), "utf8");

const U = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const A1 = U(1);
const A2 = U(2);

// ══ 1 · TAVAN ŞEMAYLA AYNI MI ══════════════════════════════════════════════
// Asıl uygulayıcı 059'un CHECK'i; buradaki sabit yalnız düzgün cevap içindir.
// Ayrışırlarsa uç "5 doldu" der ama şema 8 kabul eder (ya da tersi).
const ddl = hamOku("db/migrations/059_fleets.sql");
/**
 * DDL'in YALNIZ KODU. Aynı ders `koduAyikla`da yazılı: bir dosyanın açıklaması
 * o dosyanın YAPMADIĞI şeyi de anlatır. İlk koşumda ısırdı — "on delete
 * restrict" ifadesi iki FK'de ve bir kez de gerekçe notunda geçiyordu, sayım
 * 3 çıkıp denetim kendi belgelendirmesini kusur saydı (11.08.2026).
 */
const ddlKod = ddl.replace(/^\s*--.*$/gm, "");
const araligi = /check\s*\(sort_order between\s+(\d+)\s+and\s+(\d+)\)/.exec(ddlKod);
kontrol("059 sort_order aralığı tanımlı", !!araligi, araligi?.[0]);
kontrol("aralık 1'den başlıyor", araligi?.[1] === "1", araligi?.[1]);
kontrol(
  `FILO_TAVANI (${FILO_TAVANI}) 059 CHECK üst sınırıyla birebir`,
  Number(araligi?.[2]) === FILO_TAVANI,
  `ddl=${araligi?.[2]} kod=${FILO_TAVANI}`
);

// ══ 2 · ESKİ KODLAR 023/029 KÜMESİYLE AYNI MI ══════════════════════════════
// Tablo yokken liste BU kümeden türetiliyor; küme kayarsa migration öncesi
// kurulum var olmayan bir filoyu listeler ya da var olanı gizler.
for (const [dosya, desen] of [
  ["db/migrations/023_vehicle_fleet.sql", /check\s*\(fleet in \(([^)]*)\)\)/],
  ["db/migrations/029_fleet_chief.sql", /managed_fleet in \(([^)]*)\)/],
]) {
  const küme = desen.exec(hamOku(dosya))?.[1] ?? "";
  kontrol(
    `${path.basename(dosya)} kümesi LEGACY_FILO_KODLARI ile birebir`,
    LEGACY_FILO_KODLARI.every((k) => küme.includes(`'${k}'`)) &&
      (küme.match(/'/g) ?? []).length / 2 === LEGACY_FILO_KODLARI.length,
    küme
  );
}

// ══ 3 · KOD ÜRETİMİ ════════════════════════════════════════════════════════
// İlk iki sıra ESKİ kodları yeniden üretmeli: 30 araç satırı değişmeden kalsın.
kontrol("sıra 1 → 'bordo'", filoKoduUret(1) === "bordo", filoKoduUret(1));
kontrol("sıra 2 → 'mavi'", filoKoduUret(2) === "mavi", filoKoduUret(2));
for (const s of [3, 4, 5]) {
  kontrol(`sıra ${s} → 'filo${s}'`, filoKoduUret(s) === `filo${s}`, filoKoduUret(s));
}
// Üretilen kodlar birbirinden ve eski kodlardan FARKLI olmalı.
const kodlar = [1, 2, 3, 4, 5].map(filoKoduUret);
kontrol("üretilen 5 kod benzersiz", new Set(kodlar).size === 5, kodlar.join(","));
kontrol("kodlar küçük harf ve boşluksuz", kodlar.every((k) => /^[a-z0-9]+$/.test(k)), kodlar.join(","));

// ══ 4 · VARSAYILAN AD ══════════════════════════════════════════════════════
for (const s of [1, 3, 5]) {
  kontrol(`sıra ${s} varsayılan adı "${s}. Filo"`, varsayilanFiloAdi(s) === `${s}. Filo`, varsayilanFiloAdi(s));
}
// Kararlılık: aynı sıra her çağrıda aynı adı verir (koşum saatine bağlı değil).
kontrol("varsayılan ad kararlı", varsayilanFiloAdi(4) === varsayilanFiloAdi(4));

// ══ 5 · AD AYIKLAMA ════════════════════════════════════════════════════════
// POST: alan hiç gönderilmeyebilir (adsız filo aç).
for (const g of [{}, null, undefined, "dize", 42, []]) {
  const r = filoAdiniAyikla(g, { zorunlu: false });
  kontrol(`POST gövde yok/yanlış → ad null: ${JSON.stringify(g)}`, r.ok && r.ad === null);
}
// PATCH: alan ZORUNLU — yoksa uç hiçbir şey yapmadan "tamam" derdi.
for (const g of [{}, null, undefined, { baska: 1 }, []]) {
  const r = filoAdiniAyikla(g, { zorunlu: true });
  kontrol(`PATCH ad yok → missing_fields: ${JSON.stringify(g)}`, !r.ok && r.kod === "missing_fields" && r.alan === "ad");
}
for (const v of [1, true, [], {}]) {
  const r = filoAdiniAyikla({ ad: v }, { zorunlu: true });
  kontrol(`ad tipi yanlış → invalid/tip: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.sebep === "tip");
}
// null AÇIKÇA "varsayılana dön" — tip hatası DEĞİL.
kontrol("ad:null → varsayılana dön", (() => { const r = filoAdiniAyikla({ ad: null }, { zorunlu: true }); return r.ok && r.ad === null; })());
for (const v of ["", " ", "   ", "\t\n"]) {
  const r = filoAdiniAyikla({ ad: v }, { zorunlu: true });
  kontrol(`boş ad → varsayılana dön: ${JSON.stringify(v)}`, r.ok && r.ad === null);
}
kontrol("ad TRIM edilir", (() => { const r = filoAdiniAyikla({ ad: "  Kuzey Bölge  " }, { zorunlu: true }); return r.ok && r.ad === "Kuzey Bölge"; })());
kontrol(`tam sınır (${FILO_ADI_MAX}) KABUL`, filoAdiniAyikla({ ad: "a".repeat(FILO_ADI_MAX) }, { zorunlu: true }).ok);
const uzunAd = filoAdiniAyikla({ ad: "a".repeat(FILO_ADI_MAX + 1) }, { zorunlu: true });
kontrol("sınır+1 → too_long", !uzunAd.ok && uzunAd.kod === "too_long" && uzunAd.alan === "ad");
kontrol("too_long UZUNLUĞU söyler", !uzunAd.ok && uzunAd.uzunluk === FILO_ADI_MAX + 1, String(uzunAd.uzunluk));
// Sessiz kırpma YASAK: uzun ad kesilip yazılmaz, REDDEDİLİR.
kontrol("uzun ad KESİLMİYOR", !uzunAd.ok);
// Türkçe karakter BAYT değil KARAKTER sayılır.
kontrol("Türkçe ad karakterle sayılır", filoAdiniAyikla({ ad: "ğ".repeat(FILO_ADI_MAX) }, { zorunlu: true }).ok);

// ══ 6 · ATAMA AYIKLAMA ═════════════════════════════════════════════════════
for (const g of [null, undefined, "dize", 42, []]) {
  const r = atamaGirdisiniAyikla(g);
  kontrol(`gövde yok/yanlış → missing_fields/govde: ${JSON.stringify(g)}`, !r.ok && r.kod === "missing_fields" && r.alan === "govde");
}
// Taşınacak hiçbir şey olmayan istek 200 dönemez — sessiz hiçlik olurdu.
for (const g of [{}, { aracIdleri: [] }, { personelIdleri: [] }, { aracIdleri: [], personelIdleri: [] }]) {
  const r = atamaGirdisiniAyikla(g);
  kontrol(`boş taşıma → missing_fields: ${JSON.stringify(g)}`, !r.ok && r.kod === "missing_fields" && r.alan === "govde");
}
for (const alan of ["aracIdleri", "personelIdleri"]) {
  for (const v of ["dize", 42, true, {}]) {
    const r = atamaGirdisiniAyikla({ [alan]: v });
    kontrol(`${alan} dizi değil → invalid/tip: ${JSON.stringify(v)}`, !r.ok && r.kod === "invalid" && r.alan === alan && r.sebep === "tip");
  }
  const r2 = atamaGirdisiniAyikla({ [alan]: [A1, 5] });
  kontrol(`${alan} elemanı dize değil → invalid/tip`, !r2.ok && r2.kod === "invalid" && r2.alan === alan && r2.sebep === "tip");

  // ⚠️ ASIL MESELE: uuid olmayan kimlik `.in()` üzerinden 22P02 fırlatır ve
  // TÜM isteği düşürürdü. Erken reddedilir ve hangisi olduğu SÖYLENİR.
  for (const kotu of ["abc", "", "   ", "00000000-0000-4000-8000", `${A1}x`, "'; drop table vehicles;--"]) {
    const r = atamaGirdisiniAyikla({ [alan]: [kotu] });
    kontrol(`${alan} uuid değil → invalid/deger: ${JSON.stringify(kotu.slice(0, 24))}`, !r.ok && r.kod === "invalid" && r.alan === alan && r.sebep === "deger");
  }
  const bozuk = atamaGirdisiniAyikla({ [alan]: [A1, "abc", "def"] });
  kontrol(`${alan} bozuk kimlikleri SÖYLÜYOR`, !bozuk.ok && Array.isArray(bozuk.gecersiz) && bozuk.gecersiz.join(",") === "abc,def", String(bozuk.gecersiz));

  const uzun = atamaGirdisiniAyikla({ [alan]: Array.from({ length: ATAMA_LISTE_TAVANI + 1 }, (_, i) => U(i + 1)) });
  kontrol(`${alan} sınır+1 → too_long`, !uzun.ok && uzun.kod === "too_long" && uzun.alan === alan, String(uzun.uzunluk));
  kontrol(`${alan} tam sınır KABUL`, atamaGirdisiniAyikla({ [alan]: Array.from({ length: ATAMA_LISTE_TAVANI }, (_, i) => U(i + 1)) }).ok);
}
kontrol("büyük harfli uuid KABUL", atamaGirdisiniAyikla({ aracIdleri: [A1.toUpperCase()] }).ok);
kontrol("kimlikler TRIM edilir", (() => { const r = atamaGirdisiniAyikla({ aracIdleri: [`  ${A1}  `] }); return r.ok && r.aracIdleri[0] === A1; })());
kontrol("tekrar eden kimlik TEKİLLEŞTİRİLİR", (() => { const r = atamaGirdisiniAyikla({ aracIdleri: [A1, A1, A2] }); return r.ok && r.aracIdleri.length === 2; })());
kontrol("tekilleştirme SIRAYI korur", (() => { const r = atamaGirdisiniAyikla({ aracIdleri: [A2, A1, A2] }); return r.ok && r.aracIdleri.join() === `${A2},${A1}`; })());
kontrol("yalnız araç gönderilebilir", (() => { const r = atamaGirdisiniAyikla({ aracIdleri: [A1] }); return r.ok && r.personelIdleri.length === 0; })());
kontrol("yalnız personel gönderilebilir", (() => { const r = atamaGirdisiniAyikla({ personelIdleri: [A1] }); return r.ok && r.aracIdleri.length === 0; })());

// ══ 7 · SAF KATMAN GERÇEKTEN SAF MI ════════════════════════════════════════
// Muhafızın çalışabilmesinin ön koşulu; bir DB çağrısı sızarsa bu betik hiç
// çalışmaz olur ve bunu HEMEN görürüz.
{
  const src = kodOku("lib/fleets.ts");
  kontrol("lib/fleets.ts server-only DEĞİL", !/^\s*import\s+["']server-only["']/m.test(src));
  kontrol("lib/fleets.ts supabase içe aktarmıyor", !/^\s*import\s.*@\/lib\/supabase["']/m.test(src));
}

// ══ 8 · UÇLAR — KAPI VE KAYNAK ═════════════════════════════════════════════
const listeSrc = kodOku("app/api/mobile/fleets/route.ts");
const adSrc = kodOku("app/api/mobile/fleets/[id]/route.ts");
const atamaSrc = kodOku("app/api/mobile/fleets/[id]/atamalar/route.ts");

for (const [ad, src] of [["liste/yeni", listeSrc], ["adlandırma", adSrc], ["atama", atamaSrc]]) {
  kontrol(`${ad} kapısı requireMobileAdmin`, src.includes("requireMobileAdmin("));
  // Şef bu uçlara GİREMEZ: kendi filosuna karşı filodan araç çekebilirdi.
  kontrol(`${ad} daha gevşek kapı KULLANMIYOR`, !/requireMobileWorker\(|requireMobileFleetView\(/.test(src));
  // Uçlar kendi sınırlarını tanımlamaz — tek kaynak lib/fleets.ts.
  kontrol(`${ad} kendi sabitini tanımlamıyor`, !/const\s+\w*(MAX|TAVAN)\w*\s*=\s*\d+/.test(src));
  kontrol(`${ad} DB'ye DOĞRUDAN yazmıyor`, !/supabaseAdmin/.test(src));
}
kontrol("liste ucu GET+POST dışında yöntem açmıyor", !/export async function (PUT|DELETE|PATCH)\b/.test(listeSrc));
kontrol("adlandırma ucu PATCH dışında yöntem açmıyor", !/export async function (GET|POST|PUT|DELETE)\b/.test(adSrc));
kontrol("atama ucu POST dışında yöntem açmıyor", !/export async function (GET|PUT|DELETE|PATCH)\b/.test(atamaSrc));
// Filo SİLME bu turda YOK — hiçbir uç DELETE açmamalı.
kontrol("hiçbir filo ucu DELETE açmıyor", ![listeSrc, adSrc, atamaSrc].some((s) => /export async function DELETE\b/.test(s)));

kontrol("liste ucu tavanı yanıtta söylüyor", /enFazlaFilo:\s*FILO_TAVANI/.test(listeSrc));
kontrol("liste ucu boş listenin SEBEBİNİ taşıyor", /tabloDurumu:/.test(listeSrc));
kontrol("liste ucu sayım kırpmasını gizlemiyor", /sayimKirpildi:/.test(listeSrc));
kontrol("liste ucu filosuz personeli söylüyor", /filosuzPersonel:/.test(listeSrc));
kontrol("POST ayıklaması lib/fleets.ts'ten", /filoAdiniAyikla\(body,\s*\{\s*zorunlu:\s*false\s*\}\)/.test(listeSrc));
kontrol("POST tavan aşımında 400 limit_reached", /mobileError\(400,\s*"limit_reached"/.test(listeSrc));
kontrol("POST tavanı ve mevcudu söylüyor", /enFazla:\s*FILO_TAVANI/.test(listeSrc) && /mevcut:\s*sonuc\.mevcut/.test(listeSrc));
kontrol("POST yarışta 409 conflict", /mobileError\(409,\s*"conflict"/.test(listeSrc));
// Adsız POST geçerli: boş gövde ile BOZUK gövde ayrılmalı.
kontrol("POST boş gövdeyi invalid_json saymıyor", /req\.text\(\)/.test(listeSrc) && /ham\.trim\(\)\.length > 0/.test(listeSrc));
// Kod/sıra istemciden GELMEZ.
kontrol("POST gövdeden kod/sıra okumuyor", !/(kod|sira|code|sort_order)\s*[:=]\s*(body|input|ayikla)\b/.test(listeSrc));

kontrol("PATCH ayıklaması zorunlu ad ile", /filoAdiniAyikla\(body,\s*\{\s*zorunlu:\s*true\s*\}\)/.test(adSrc));
kontrol("PATCH kayıt yoksa 404", /mobileError\(404,\s*"not_found"\)/.test(adSrc));
kontrol("PATCH degisti bayrağı taşıyor", /degisti:\s*sonuc\.degisti/.test(adSrc));

kontrol("atama ayıklaması lib/fleets.ts'ten", atamaSrc.includes("atamaGirdisiniAyikla("));
kontrol("atama filo yoksa 404", /mobileError\(404,\s*"not_found"\)/.test(atamaSrc));
kontrol("atama bozuk kimlikleri yanıtta söylüyor", /gecersiz:\s*ayikla\.gecersiz/.test(atamaSrc));
kontrol("atama yanıtı araç ve personel ayrımını taşıyor", /arac:\s*sonuc\.arac/.test(atamaSrc) && /personel:\s*sonuc\.personel/.test(atamaSrc));

// ══ 9 · SORGU KATMANI ══════════════════════════════════════════════════════
const dbSrc = kodOku("lib/fleets-db.ts");
kontrol("tabloYokMu KOPYALANMAMIŞ, içe aktarılmış", /import \{ tabloYokMu \} from "@\/lib\/fault-reports"/.test(dbSrc) && !/function tabloYokMu/.test(dbSrc));
// Filo silme yok; sorgu katmanı da silmemeli.
kontrol("sorgu katmanı SİLME yapmıyor", !/\.delete\(\)/.test(dbSrc));
// Sayım sorguları test elemesini KAYBETMEMELİ (muhafız check-test-filters de
// bakıyor; burada ayrıca sabitlenmesi elemenin sessizce kalkmasını zorlaştırır).
kontrol("araç sayımı test elemeli", /withoutTestRows\(\s*\n?\s*supabaseAdmin\s*\n?\s*\.from\("vehicles"\)/.test(dbSrc));
kontrol("personel sayımı test elemeli", /withoutTestRows\(\s*\n?\s*supabaseAdmin\.from\("workers"\)/.test(dbSrc));
kontrol("personel sayımı yalnız AKTİF kadro", /\.eq\("is_active",\s*true\)/.test(dbSrc));
// PostgREST 1000 satır tavanı: sayım kırpılırsa SÖYLENİR (25.07.2026 dersi).
kontrol("sayım kırpması ölçülüyor", /count:\s*"exact"/.test(dbSrc) && /sayimKirpildi:/.test(dbSrc));

/**
 * ⚠️ TAŞIMA YALNIZ `fleet` YAZAR. Güncellemeye başka bir kolon sızarsa
 * (özellikle `assigned_worker_id`) filo değiştirmek şoför atamasını da bozardı
 * — tek düğme, iki karar.
 */
const updateBloklari = dbSrc.match(/\.update\(\{[^}]*\}\)/g) ?? [];
kontrol("iki güncelleme var (ad + filo)", updateBloklari.length === 2, updateBloklari.join(" | "));
kontrol("filo güncellemesi YALNIZ fleet yazıyor", updateBloklari.includes(".update({ fleet: kod })"), updateBloklari.join(" | "));
kontrol("ad güncellemesi YALNIZ name yazıyor", updateBloklari.includes(".update({ name: ad })"), updateBloklari.join(" | "));
kontrol("hiçbir güncelleme assigned_worker_id'ye dokunmuyor", !updateBloklari.some((b) => b.includes("assigned_worker_id")));
// Zaten hedefte olan araç güncellemenin DIŞINDA: dönen satır "gerçekten değişen".
kontrol("zaten hedefte olan araç güncellenmiyor", /\.neq\("fleet",\s*kod\)/.test(dbSrc));
// Kod ASLA yeniden yazılmaz: 30 araç satırında yazılı olan şey odur.
kontrol("yeniden adlandırma code'a dokunmuyor", !/\.update\(\{[^}]*code:/.test(dbSrc));
// En küçük boş yuva: silme sonrası yuva ölmesin, aynı istek aynı sırayı hedeflesin.
kontrol("sıra EN KÜÇÜK BOŞ yuvadan seçiliyor", /for \(let i = 1; i <= FILO_TAVANI; i\+\+\)/.test(dbSrc));
kontrol("yarıştaki 23505 çakışmaya çevriliyor", /UNIQUE_VIOLATION/.test(dbSrc) && /23505/.test(dbSrc));
kontrol("CHECK/FK ihlali ayrı sebep", /23514/.test(dbSrc) && /23503/.test(dbSrc) && /gecersiz_filo/.test(dbSrc));
// Ödünç araç TAŞINMAZ: yalnız kalıcı atama bağı.
kontrol("personel araçları yalnız assigned_worker_id'den", /\.in\("assigned_worker_id",\s*personelIdleri\)/.test(dbSrc) && !/time_entries/.test(dbSrc));
// "Böyle biri yok" ile "aracı yok" ayrı cevaplar.
kontrol("olmayan personel ayrı sebep alıyor", /sebep:\s*"yok"/.test(dbSrc) && /sebep:\s*"arac_yok"/.test(dbSrc));

// ══ 10 · DDL (migration 059) ═══════════════════════════════════════════════
kontrol("059 tabloyu tanımlıyor", /create table if not exists public\.fleets/.test(ddlKod));
kontrol("059 code birincil anahtar", /code\s+text primary key/.test(ddlKod));
// Ayrı uuid kimlik YOK: aynı şeye ikinci kimlik, migration öncesi/sonrası
// farklı kimlik demekti (dosyadaki gerekçe).
kontrol("059 ayrı uuid id EKLEMİYOR", !/\bid\s+uuid/.test(ddlKod));
// name NULL olabilmeli: 059 çalıştığında görünen ad DEĞİŞMESİN.
kontrol("059 name NULL olabiliyor", /\bname\s+text\s*,/.test(ddlKod) && !/name\s+text not null/.test(ddlKod));
kontrol("059 sıra benzersiz (tavan yapısal)", /unique \(sort_order\)/.test(ddlKod));
kontrol("059 benzersizlik DEFERRABLE (ileride takas için)", /deferrable initially deferred/.test(ddlKod));
// Tohum mevcut veriyi korur: iki kod, ADSIZ, bugünkü sırayla.
kontrol("059 bordo'yu sıra 1 ADSIZ tohumluyor", /\('bordo',\s*null,\s*1\)/.test(ddlKod));
kontrol("059 mavi'yi sıra 2 ADSIZ tohumluyor", /\('mavi',\s*null,\s*2\)/.test(ddlKod));
kontrol("059 tohum idempotent", /on conflict \(code\) do nothing/.test(ddlKod));
// CHECK → FK: izin verilen küme artık VERİ.
kontrol("059 eski CHECK'leri TANIMDAN buluyor (ada güvenmiyor)", /pg_get_constraintdef\(oid\) ilike '%bordo%'/.test(ddlKod));
kontrol("059 vehicles.fleet FK kuruyor", /add constraint vehicles_fleet_fkey foreign key \(fleet\)/.test(ddlKod));
kontrol("059 workers.managed_fleet FK kuruyor", /add constraint workers_managed_fleet_fkey foreign key \(managed_fleet\)/.test(ddlKod));
// RESTRICT: içinde aracı olan filo silinemez — "öksüz kalmasın" kararı şemada.
kontrol("059 FK'ler on delete restrict", (ddlKod.match(/on delete restrict/g) ?? []).length === 2, String((ddlKod.match(/on delete restrict/g) ?? []).length));
kontrol("059 FK'ler idempotent (pg_constraint denetimi)", (ddlKod.match(/where conname = '\w+_fkey'/g) ?? []).length === 2);
// Mevcut veri KORUNUR: araç/personel satırlarına UPDATE yok.
kontrol("059 vehicles/workers satırlarını GÜNCELLEMİYOR", !/update public\.(vehicles|workers)/i.test(ddlKod));
kontrol("059 hiçbir kolon DÜŞÜRMÜYOR", !/drop column/i.test(ddlKod));
kontrol("059 filo indeksi kuruyor", /create index if not exists idx_vehicles_fleet/.test(ddlKod));
kontrol("059 RLS'i açıkça kapatıyor", /alter table public\.fleets disable row level security/.test(ddlKod));
kontrol("059 PostgREST önbelleğini tazeliyor", /notify pgrst, 'reload schema'/.test(ddlKod));
/**
 * DDL KAYDI DURUMUNU SÖYLEMELİ. 11.08.2026'da çalıştırıldı; başlık "HENÜZ
 * ÇALIŞTIRILMADI" derken bırakılsaydı bir sonraki tur onu bekleyen bir iş
 * sanardı — ve daha kötüsü, yeni kurulum listesine alınıp alınmayacağı
 * belirsiz kalırdı. 056/057/058 ile aynı başlık biçimi.
 */
kontrol("059 çalıştırıldığını kayda geçiriyor", /SUPABASE'DE ÇALIŞTIRILDI/.test(ddl));
kontrol("059 bekliyor gibi görünmüyor", !/HENÜZ ÇALIŞTIRILMADI/.test(ddl));
// Ölçülemeyen tek şey (indeks) SÖYLENMELİ — sessizce "hepsi doğrulandı" olmasın.
kontrol("059 ölçülemeyen indeksi ÖLÇÜLMEDİ diye işaretliyor", /idx_vehicles_fleet: ÖLÇÜLMEDİ/.test(ddl));
/**
 * Gizlilik: DDL dosyalarına gerçek plaka/kişi/e-posta yazılmaz (031'deki kural).
 */
kontrol(
  "059'da e-posta/plaka YOK (gizlilik)",
  !/@[\w.-]+\.\w{2,}/.test(ddl) && !/\b[A-ZÄÖÜ]{1,2}-\d{3,5}\s?[A-Z]{0,2}\b/.test(ddl),
  (/\b[A-ZÄÖÜ]{1,2}-\d{3,5}\s?[A-Z]{0,2}\b/.exec(ddl) ?? [""])[0]
);

// ── Sonuç ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ filo yönetimi muhafızı: ${gecen} denetim geçti (girdi + kaynak + DDL + tavan eşleşmesi).`);
  process.exit(0);
}
console.error(`\n✗ FİLO YÖNETİMİ MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.error(`  · ${d.baslik}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.error(`
  Bu denetimler uçların SÖZLERİDİR:
    · tavan tek yerde DEĞİL — kod sabiti 059'un CHECK'iyle aynı olmak ZORUNDA
    · filo KODU sunucu üretir; ilk iki sıra eski kodları yeniden üretir
    · uuid olmayan kimlik ERKEN reddedilir (yoksa tek bozuk kimlik tüm taşımayı düşürür)
    · boş ad hata değil, VARSAYILANA DÖNÜŞTÜR; PATCH'te alanın yokluğu hatadır
    · taşıma YALNIZ vehicles.fleet yazar — şoför ataması taşımanın yan etkisi olamaz
    · zaten hedefte olan araç güncellenmez; "değişen" gerçekten değişendir
    · personelin filosu araçtan türer: aracı olmayan taşınamaz ve bu SÖYLENİR
    · sayımlar test kayıtlarını eler, 1000 satır kırpması gizlenmez
    · dört kapı da requireMobileAdmin — filo şefi filoları yeniden düzenleyemez
    · 059 mevcut bordo/mavi verisine DOKUNMAZ: UPDATE yok, kolon düşmüyor
`);
process.exit(1);
