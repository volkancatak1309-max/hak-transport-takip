#!/usr/bin/env node
/**
 * PANEL KM DÜZELTME MUHAFIZI — AĞ YOK, gerçek kaynağı okur ve gerçek action'ı
 * SAHTE bir FormData ile çalıştırır.
 *
 * NE ÇÖZÜYOR: 12. madde km'yi elle düzeltme YÜZEYLERİNİ kaldırdı ama
 * uç/çekirdek sözleşmesini bilerek YERİNDE BIRAKTI. Bu ikisinin arası sessiz
 * kusur için biçilmiş kaftan:
 *   · form alanı geri eklenirse kimse fark etmez (tip sistemi görmez);
 *   · `editEntryAction` km'yi yeniden FormData'dan okumaya başlarsa istemci
 *     gönderdiği her km'yi yazdırabilir — kapı kapalı görünür, arka kapı açık;
 *   · km kayıttan okunmayı bırakırsa `start_km` zorunlu şemaya takılır ve
 *     SAAT düzeltmesi de çalışmaz olur (AZG raporunu besleyen tek yol).
 *
 * Çalıştır:  npm run lint:panel-km
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let gecen = 0;
const dusen = [];
function kontrol(baslik, kosul, kanit) {
  if (kosul) gecen++;
  else dusen.push({ baslik, kanit });
}

/** Yorumları sök — denetimler YALNIZ KODA baksın (check-filo-yonetimi dersi). */
function koduAyikla(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
const kodOku = (g) => koduAyikla(readFileSync(path.join(ROOT, g), "utf8"));

// ══ 1 · BİLEŞEN GERÇEKTEN SİLİNDİ Mİ ═══════════════════════════════════════
kontrol(
  "components/KmEditButton.tsx SİLİNDİ",
  !existsSync(path.join(ROOT, "components/KmEditButton.tsx"))
);

// ══ 2 · PANEL FORMUNDA KM ALANI YOK ════════════════════════════════════════
const adminSrc = kodOku("app/admin/AdminClient.tsx");
/**
 * ⚠️ `name="start_km"` formun FormData'ya ne koyacağını belirleyen TEK şey.
 * Geri gelirse gövdede km alanı yeniden doğar.
 */
kontrol('AdminClient formunda name="start_km" YOK', !/name="start_km"/.test(adminSrc));
kontrol('AdminClient formunda name="end_km" YOK', !/name="end_km"/.test(adminSrc));
// Gizli input da olmamalı: istek "gövdede km alanı yok" diyordu.
kontrol(
  "AdminClient'ta gizli km input'u da YOK",
  !/type="hidden"[^>]*name="(start|end)_km"/.test(adminSrc)
);

// ══ 2b · GÖVDENİN TAM ALAN KÜMESİ ══════════════════════════════════════════
/**
 * OLUMSUZ DENETİM YETMEZ. "km yok" demek, alanın başka bir adla ya da başka
 * bir bileşenin içinden geri gelmediğini KANITLAMAZ. Bu yüzden düzeltme
 * formunun `<form action={handleEdit}>` … `</form>` arasındaki BÜTÜN `name`
 * öznitelikleri toplanıp beklenen kümeyle birebir karşılaştırılıyor:
 * FormData'ya giren alanların tamamı budur.
 */
const hamAdmin = readFileSync(path.join(ROOT, "app/admin/AdminClient.tsx"), "utf8");
const formBlok =
  /<form action=\{handleEdit\}[\s\S]*?<\/form>/.exec(hamAdmin)?.[0] ?? "";
kontrol("düzeltme formu bloğu bulundu", formBlok.length > 0);
const alanlar = [...formBlok.matchAll(/\sname="([a-z_]+)"/g)].map((m) => m[1]);
const BEKLENEN = [
  "id",
  "started_at",
  "ended_at",
  "break_minutes",
  "start_package_count",
  "undelivered_count",
  "plate",
  "notes",
  "reason",
].sort();
const bulunan = [...new Set(alanlar)].sort();
kontrol(
  `gövde alan kümesi birebir (${bulunan.length} alan)`,
  JSON.stringify(bulunan) === JSON.stringify(BEKLENEN),
  `bulunan=${bulunan.join(",")}`
);
kontrol(
  "🔑 kümede km geçen HİÇBİR alan yok",
  !bulunan.some((a) => a.includes("km")),
  bulunan.filter((a) => a.includes("km")).join(",") || "—"
);

// ══ 3 · AZG ALANLARI DURUYOR ═══════════════════════════════════════════════
// AZG raporunu besleyen üç alan kaldırılmamalı — km kapısı onları vurmamalı.
for (const alan of ["started_at", "ended_at", "break_minutes"]) {
  kontrol(`AZG alanı "${alan}" formda DURUYOR`, new RegExp(`name="${alan}"`).test(adminSrc));
}

// ══ 4 · KmEditButton'a atıf kalmadı ════════════════════════════════════════
for (const dosya of [
  "app/admin/workers/[id]/WorkerDetailClient.tsx",
  "app/admin/AdminClient.tsx",
]) {
  kontrol(`${path.basename(dosya)} KmEditButton'a atıf YAPMIYOR`, !/KmEditButton/.test(kodOku(dosya)));
}

// ══ 5 · ACTION KM'Yİ KAYITTAN OKUYOR, FORMDAN DEĞİL ════════════════════════
const shiftSrc = kodOku("app/actions/shift.ts");
const editBlok =
  /export async function editEntryAction\([\s\S]*?\n\}/.exec(shiftSrc)?.[0] ?? "";
kontrol("editEntryAction bulundu", editBlok.length > 0);
/**
 * ⚠️ ASIL KAPI. `formData.get("start_km")` geri gelirse istemcinin gönderdiği
 * km yazılır ve kaldırılan yüzeyin arkasındaki yol yeniden açılır.
 */
kontrol(
  'editEntryAction formData.get("start_km") OKUMUYOR',
  !/formData\.get\("start_km"\)/.test(editBlok)
);
kontrol(
  'editEntryAction formData.get("end_km") OKUMUYOR',
  !/formData\.get\("end_km"\)/.test(editBlok)
);
kontrol(
  "editEntryAction km'yi time_entries'ten OKUYOR",
  /from\("time_entries"\)[\s\S]{0,120}select\("start_km, end_km"\)/.test(editBlok)
);
kontrol(
  "okunan değerler çekirdeğe AYNEN geçiyor",
  /start_km:\s*mevcut\.start_km/.test(editBlok) && /end_km:\s*mevcut\.end_km/.test(editBlok)
);
// Kayıt yoksa sessizce devam etmemeli.
kontrol(
  "kayıt okunamazsa/yoksa AÇIKÇA hata",
  /okumaHatasi/.test(editBlok) && /not_found/.test(editBlok)
);
// AZG alanları action'da da FormData'dan gelmeye devam etmeli.
for (const alan of ["started_at", "ended_at", "break_minutes"]) {
  kontrol(
    `action "${alan}" alanını FormData'dan okumaya DEVAM ediyor`,
    new RegExp(`formData\\.get\\("${alan}"\\)`).test(editBlok)
  );
}

// ══ 6 · ÇEKİRDEK SÖZLEŞMESİ DEĞİŞMEDİ ══════════════════════════════════════
// İstek açıktı: uç/çekirdek km'yi HÂLÂ kabul etsin. Buradan kaldırmak, mobil
// `islem:"km"` ve `islem:"duzelt"` uçlarını kırardı.
const correctSrc = kodOku("lib/shift-correct.ts");
kontrol("correctShiftFields start_km'i hâlâ ALIYOR", /start_km:\s*unknown/.test(correctSrc));
kontrol("correctShiftFields end_km'i hâlâ ALIYOR", /end_km\?:\s*unknown/.test(correctSrc));
const valSrc = kodOku("lib/validation.ts");
kontrol("editEntrySchema start_km'i hâlâ TANIYOR", /start_km/.test(valSrc));
kontrol("editEntrySchema end_km'i hâlâ TANIYOR", /end_km/.test(valSrc));

// ══ 7 · GEÇMİŞ ETİKETLERİ DURUYOR ══════════════════════════════════════════
// `shift_edit_log` geçmişte yapılmış km düzeltmelerini gösteriyor; etiketler
// silinseydi eski kayıtlar ham kolon adıyla görünürdü.
const gecmisSrc = kodOku("components/admin/ShiftEditHistory.tsx");
kontrol("düzenleme geçmişi km etiketlerini KORUYOR", /editStartKm/.test(gecmisSrc) && /editEndKm/.test(gecmisSrc));
for (const dil of ["tr", "de", "en"]) {
  const s = readFileSync(path.join(ROOT, `messages/${dil}.json`), "utf8");
  kontrol(`${dil}.json editStartKm/editEndKm DURUYOR`, /"editStartKm"/.test(s) && /"editEndKm"/.test(s));
}

// ── Sonuç ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ panel km muhafızı: ${gecen} denetim geçti (yüzey gitti · sözleşme durdu · AZG bozulmadı).`);
  process.exit(0);
}
console.error(`\n✗ PANEL KM MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.error(`  · ${d.baslik}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.error(`
  Bu denetimler 12. maddenin SÖZLERİDİR:
    · km artık YALNIZ cihazdan — panelde elle düzeltme yüzeyi YOK
    · form FormData'ya km KOYMAZ; action km'yi KAYITTAN okur, istemciden değil
    · uç/çekirdek sözleşmesi DEĞİŞMEDİ (mobil islem:"km" ve "duzelt" çalışır)
    · AZG'yi besleyen üç alan (başlangıç · bitiş · mola) yerinde durur
    · geçmiş km düzeltmelerinin etiketleri okunabilir kalır
`);
process.exit(1);
