#!/usr/bin/env node
/**
 * MOBİL UÇ TUR 1 — AYRIŞMA MUHAFIZI (PIN + VARDİYA BAŞLATMA/DÜZELTME).
 *
 * ═══ NEDEN VAR ═══
 *
 * Bu turda açılan dört uç, panelin ÜÇ ayrı yüzeyiyle aynı kuralı işletmek
 * zorunda ve bu söz KODUN ŞEKLİNE bağlı — çalışma anında görünmüyor:
 *
 *   POST /api/mobile/me/pin           ↔ app/actions/auth.ts changePinAction
 *   POST /api/mobile/shifts/start     ↔ startShiftManualAction
 *   POST /api/mobile/shifts/start-for ↔ startShiftForWorkerAction
 *   PATCH /api/mobile/shifts/[id]     ↔ editEntry / adminUpdateKm / adminCloseShift
 *
 * Bir gün biri "hızlı olsun" diye uçta kendi `bcrypt.compare`ini, kendi
 * `insert({worker_id…})`ini ya da kendi `getManagedFleet` kontrolünü yazar.
 * O an panel ile telefon AYRIŞIR ve fark sessizce yayılır: AZG raporuna
 * (started_at/ended_at/break_minutes), düzeltme izine, kilit merdivenine.
 * tsc, build ve mevcut muhafızlar bunların HİÇBİRİNİ yakalamaz.
 *
 * ── ONBİR DENETİM, HEPSİ KAYNAK ÜZERİNDE (veritabanı gerekmez) ────────────
 *   M1  — PIN ucu kimlik/şema mantığı KURMAZ: changeOwnPin çağırır.
 *   M2  — Mevcut PIN kapısı GİRİŞİN sayacını kullanır (login_attempts'e yazan
 *         tek yer lib/auth-core.ts); uç kendi sayacını kurmaz.
 *   M3  — Yeni PIN kuralı TEK KAYNAK: changePinSchema. Uçta/çekirdekte ikinci
 *         bir hane/zayıflık kuralı YOK.
 *   M4  — Yanlış mevcut PIN 403 döner, 401 DEĞİL (401 istemciyi oturumdan atar).
 *   M5  — Başlatma uçları time_entries'e KENDİ yazmaz: çekirdeği çağırır.
 *   M6  — Panel action'ları da AYNI çekirdeği çağırır (ikinci kopya yok).
 *   M7  — Manuel başlatma kapısı TEK KAYNAK (resolveManualStartAuth); hedef
 *         şoförün kapsamı (isFleetWorker) başka yerde tekrar çözülmez.
 *   M8  — Düzeltme uçları time_entries'i KENDİ güncellemez: çekirdeği çağırır.
 *   M9  — SEBEP ZORUNLU (087): `duzelt` ve `kapat` sebepsiz geçemez.
 *   M10 — PATCH kapısı requireMobileAdmin — filo şefi giremez (panel paritesi).
 *   M11 — `/start` gövdesi workerId KABUL ETMEZ (başkası adına açma yolu ayrı
 *         uçta ve ayrı kapıda).
 *
 * Kullanım:  npm run lint:mobil-uc-1
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOSYA = {
  pinUc: "app/api/mobile/me/pin/route.ts",
  startUc: "app/api/mobile/shifts/start/route.ts",
  startForUc: "app/api/mobile/shifts/start-for/route.ts",
  patchUc: "app/api/mobile/shifts/[id]/route.ts",
  authCore: "lib/auth-core.ts",
  hesapCore: "lib/worker-account-db.ts",
  startCore: "lib/shift-start.ts",
  correctCore: "lib/shift-correct.ts",
  manualScope: "lib/manual-start-scope.ts",
  mobileScope: "lib/mobile-scope.ts",
  session: "lib/session.ts",
  shiftAction: "app/actions/shift.ts",
  authAction: "app/actions/auth.ts",
};

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

/** Yorum satırlarını düşür — denetimler KODA bakmalı, açıklamaya değil. */
function kodu(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

const ham = Object.fromEntries(Object.entries(DOSYA).map(([k, p]) => [k, oku(p)]));
if (Object.values(ham).some((v) => v === null)) {
  console.error(`\n✗ MOBİL UÇ TUR 1 MUHAFIZI — ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
const K = Object.fromEntries(Object.entries(ham).map(([k, v]) => [k, kodu(v)]));

// ── M1 · PIN UCU KENDİ KİMLİK MANTIĞINI KURMAZ ──────────────────────────────
{
  const kacak = [];
  if (/bcrypt/.test(K.pinUc)) kacak.push("bcrypt");
  if (/\.from\(\s*["']workers["']\s*\)/.test(K.pinUc)) kacak.push('.from("workers")');
  if (/\.from\(\s*["']login_attempts["']\s*\)/.test(K.pinUc)) kacak.push('.from("login_attempts")');
  if (/pin_hash/.test(K.pinUc)) kacak.push("pin_hash");
  if (kacak.length) {
    hatalar.push(
      `M1 — PIN ucu kimlik mantığına dokunuyor: ${kacak.join(", ")}\n` +
        "  Hash karşılaştırması, kayıt okuma ve sayaç yazma ÇEKİRDEĞİN işi\n" +
        "  (lib/worker-account-db.ts changeOwnPin → lib/auth-core.ts verifyOwnPin).\n" +
        "  Uçta ikinci bir kopya, panelin PIN kuralından sessizce ayrılmanın yoludur."
    );
  } else if (!/changeOwnPin\(/.test(K.pinUc)) {
    hatalar.push("M1 — PIN ucu changeOwnPin çağırmıyor; yazma yolu ayrışmış olabilir.");
  } else {
    notlar.push("M1 ✓ PIN ucu yalnız gövde sözleşmesi; mantık changeOwnPin'de.");
  }
}

// ── M2 · KİLİT SAYACI GİRİŞLE ORTAK ─────────────────────────────────────────
{
  if (!/verifyOwnPin\(/.test(K.hesapCore)) {
    hatalar.push(
      "M2 — changeOwnPin mevcut PIN'i verifyOwnPin ile doğrulamıyor.\n" +
        "  Kendi doğrulamasını kursaydı kilit merdiveni ATLANIRDI: çalınmış bir\n" +
        "  access token sınırsız PIN denemesi yapabilen bir araca dönerdi."
    );
  }
  if (!/lockIdentifier\(/.test(K.authCore) || !/registerFailure\(/.test(K.authCore)) {
    hatalar.push("M2 — lib/auth-core.ts kilit kimliği/sayacı düzeneğini kaybetmiş.");
  }
  // `login_attempts`e YAZAN tek dosya auth-core olmalı. Okuma (panelin kilit
  // durumu / kilit kaldırma) lib/login-lock.ts'in işi ve o meşru.
  const yazanlar = [];
  for (const [ad, src] of Object.entries(K)) {
    if (ad === "authCore") continue;
    if (/\.from\(\s*["']login_attempts["']\s*\)\s*\n?\s*\.(upsert|insert|update)\(/.test(src)) {
      yazanlar.push(DOSYA[ad]);
    }
  }
  if (yazanlar.length) {
    hatalar.push(
      `M2 — login_attempts'e auth-core DIŞINDA yazan var: ${yazanlar.join(", ")}\n` +
        "  Sayaç tek yerden ilerlemeli; ikinci yazıcı merdiveni ayrıştırır."
    );
  }
  if (!hatalar.some((h) => h.startsWith("M2"))) {
    notlar.push("M2 ✓ mevcut PIN kapısı girişin sayacını kullanıyor (tek yazıcı: auth-core).");
  }
}

// ── M3 · YENİ PIN KURALI TEK KAYNAK ─────────────────────────────────────────
{
  if (!/changePinSchema/.test(K.hesapCore)) {
    hatalar.push(
      "M3 — changeOwnPin changePinSchema kullanmıyor.\n" +
        "  Yeni PIN kuralı (6 hane + zayıf değil + tekrar eşleşmesi) panelin\n" +
        "  /pin ekranıyla AYNI şemadan geçmeli; ayrı yazılırsa biri sıkılaşıp\n" +
        "  diğeri gevşer."
    );
  }
  // `adminSetPinSchema` KULLANILMAMALI: 123456 istisnası yalnız YÖNETİCİNİN
  // atadığı geçici PIN içindir; kullanıcı onu kalıcı PIN yapamaz.
  const i = K.hesapCore.indexOf("export async function changeOwnPin");
  const govde = i >= 0 ? K.hesapCore.slice(i) : "";
  if (/adminSetPinSchema/.test(govde)) {
    hatalar.push(
      "M3 — changeOwnPin adminSetPinSchema kullanıyor.\n" +
        "  O şema 123456'ya izin verir (yöneticinin atadığı saha standardı geçici\n" +
        "  PIN). Kullanıcının KALICI PIN'i katı pinSchema'dan geçmeli."
    );
  }
  // Uçta ya da çekirdekte ELLE hane kuralı yazılmamalı.
  for (const [ad, src] of [["pinUc", K.pinUc], ["hesapCore", govde]]) {
    if (/\\d\{[46],?6?\}/.test(src)) {
      hatalar.push(
        `M3 — ${DOSYA[ad]} içinde elle PIN hane regex'i var.\n` +
          "  Kural lib/validation.ts'te; ikinci bir tanım sessiz ayrışmadır."
      );
    }
  }
  if (!hatalar.some((h) => h.startsWith("M3"))) {
    notlar.push("M3 ✓ yeni PIN kuralı changePinSchema (panelin /pin ekranıyla ortak).");
  }
}

// ── M4 · YANLIŞ MEVCUT PIN 403 ──────────────────────────────────────────────
{
  const m = K.pinUc.match(/mevcut_pin_hatali[\s\S]{0,80}?/);
  const dogru = /mobileError\(\s*403\s*,\s*"mevcut_pin_hatali"/.test(K.pinUc);
  const yanlis = /mobileError\(\s*401\s*,\s*"mevcut_pin_hatali"/.test(K.pinUc);
  if (yanlis || (!dogru && m)) {
    hatalar.push(
      "M4 — yanlış mevcut PIN 403 DÖNMÜYOR.\n" +
        "  401 bu ucun sözlüğünde yalnız 'token geçersiz' demek ve mobil\n" +
        "  istemciler 401'de oturumu düşürür: kullanıcı bir yazım hatası\n" +
        "  yüzünden uygulamadan atılırdı."
    );
  } else if (!dogru) {
    hatalar.push("M4 — uçta mevcut_pin_hatali dalı bulunamadı; muhafız kör kalıyor.");
  } else {
    notlar.push("M4 ✓ yanlış mevcut PIN 403 (401 oturumu düşürürdü).");
  }
}

// ── M5 · BAŞLATMA UÇLARI KENDİ YAZMAZ ───────────────────────────────────────
{
  for (const [ad, cagri] of [
    ["startUc", "startShiftSelf("],
    ["startForUc", "startShiftForWorkerCore("],
  ]) {
    const src = K[ad];
    if (/\.from\(\s*["']time_entries["']\s*\)/.test(src)) {
      hatalar.push(
        `M5 — ${DOSYA[ad]} time_entries'e DOĞRUDAN dokunuyor.\n` +
          "  Vardiya açma kuralları (depo kapısı, günde-tek yeniden açma,\n" +
          "  23505 yakalama, 038 bayrakları) lib/shift-start.ts'te. İkinci bir\n" +
          "  yazma yolu panelden farklı KAYIT üretir."
      );
    } else if (!src.includes(cagri)) {
      hatalar.push(`M5 — ${DOSYA[ad]} ${cagri} çağırmıyor.`);
    }
  }
  if (!hatalar.some((h) => h.startsWith("M5"))) {
    notlar.push("M5 ✓ başlatma uçları yalnız gövde sözleşmesi; yazma çekirdekte.");
  }
}

// ── M6 · PANEL DE AYNI ÇEKİRDEĞİ ÇAĞIRIR ────────────────────────────────────
{
  const eksik = [];
  for (const c of [
    "startShiftSelf(",
    "startShiftForWorkerCore(",
    "correctShiftFields(",
    "correctShiftKm(",
    "closeShiftByAdmin(",
  ]) {
    if (!K.shiftAction.includes(c)) eksik.push(c);
  }
  if (eksik.length) {
    hatalar.push(
      `M6 — app/actions/shift.ts şu çekirdekleri çağırmıyor: ${eksik.join(", ")}\n` +
        "  Panel kendi kopyasına dönmüş olabilir; o an mobil ile ayrışır."
    );
  }
  // Panel action'ı artık time_entries'e vardiya AÇMAMALI. (Diğer action'lar —
  // mola, paket, kapanış — aynı dosyada ve time_entries'e dokunuyor; bu yüzden
  // dar bir imza aranıyor: worker_id taşıyan bir insert.)
  if (/\.insert\(\s*\{[^}]*worker_id\s*:/.test(K.shiftAction)) {
    hatalar.push(
      "M6 — app/actions/shift.ts hâlâ worker_id'li bir time_entries insert'i kuruyor.\n" +
        "  Vardiya açma tek kaynağa taşındı (lib/shift-start.ts); ikinci kopya kaldıysa\n" +
        "  panelden açılan vardiya telefondan açılandan farklı olur."
    );
  }
  if (!hatalar.some((h) => h.startsWith("M6"))) {
    notlar.push("M6 ✓ panel action'ları da aynı beş çekirdeği çağırıyor.");
  }
}

// ── M7 · MANUEL BAŞLATMA KAPISI TEK KAYNAK ──────────────────────────────────
{
  if (!/resolveManualStartAuth\(/.test(K.session)) {
    hatalar.push("M7 — lib/session.ts resolveManualStartAuth çağırmıyor; panel kapısı ayrışmış.");
  }
  if (!/resolveManualStartAuth\(/.test(K.mobileScope)) {
    hatalar.push("M7 — lib/mobile-scope.ts resolveManualStartAuth çağırmıyor; mobil kapı ayrışmış.");
  }
  /**
   * Kuralın KENDİSİ (şef → kendi filosunu ÇÖZ) yalnız çekirdekte olmalı.
   *
   * ⚠️ DENETİM İKİ KEZ DARALTILDI — ikisi de YANLIŞ POZİTİFTİ:
   *
   *   1) İlk hâl `isFleetWorker + getManagedFleet` geçen HER dosyayı
   *      işaretliyordu ve `shifts/[id]` GET'ini yakaladı: orada aynı iki çağrı
   *      var ama OKUMA KAPSAMI için ("bu vardiya şefe görünür mü").
   *   2) İkinci hâl `getManagedFleet` arıyordu ve `listStartableVehiclesAction`ı
   *      yakaladı: o, diyaloğun ARAÇ LİSTESİNİ kapsamla süzüyor — bir yetki
   *      kapısı değil, bir görünüm filtresi.
   *
   * Aranan tek şey şu: "hedef ŞOFÖR bu aktörün kapsamında mı" sorusunun
   * ikinci bir cevabı. İmzası `isFleetWorker(`. Araç kapsamı (`isFleetVehicle`)
   * meşru ve çekirdeğin kendisi de onu kullanıyor.
   */
  const BASLATMA_YOLU = ["startUc", "startForUc", "shiftAction", "startCore"];
  const tekrar = [];
  for (const ad of BASLATMA_YOLU) {
    if (/isFleetWorker\(/.test(K[ad])) tekrar.push(DOSYA[ad]);
  }
  if (tekrar.length) {
    hatalar.push(
      `M7 — manuel başlatma kapsam kuralı çekirdek DIŞINDA tekrar yazılmış: ${tekrar.join(", ")}\n` +
        "  Fail-closed bir kuralın ikinci kopyası, ilk değişiklikte sessizce\n" +
        "  fail-OPEN olabilecek kopyadır."
    );
  }
  if (!hatalar.some((h) => h.startsWith("M7"))) {
    notlar.push("M7 ✓ manuel başlatma kapısı tek kaynakta; panel + mobil ikisi de çağırıyor.");
  }
}

// ── M8 · DÜZELTME UCU KENDİ GÜNCELLEMEZ ─────────────────────────────────────
{
  const i = K.patchUc.indexOf("export async function PATCH");
  const govde = i >= 0 ? K.patchUc.slice(i) : "";
  if (!govde) {
    hatalar.push("M8 — PATCH işleyicisi bulunamadı.");
  } else {
    if (/\.from\(\s*["']time_entries["']\s*\)/.test(govde)) {
      hatalar.push(
        "M8 — PATCH gövdesi time_entries'e DOĞRUDAN dokunuyor.\n" +
          "  Düzeltme kuralları (sebep zorunluluğu, logShiftEdit izi, paket\n" +
          "  matematiği, plaka→vehicle_id senkronu, sefer köprüsü)\n" +
          "  lib/shift-correct.ts'te ve YASAL bir yüzey (AZG)."
      );
    }
    for (const c of ["correctShiftFields(", "correctShiftKm(", "closeShiftByAdmin("]) {
      if (!govde.includes(c)) hatalar.push(`M8 — PATCH ${c} çağırmıyor.`);
    }
  }
  if (!hatalar.some((h) => h.startsWith("M8"))) {
    notlar.push("M8 ✓ düzeltme yazması lib/shift-correct.ts'te (üç işlem de).");
  }
}

// ── M9 · SEBEP ZORUNLU (087) ────────────────────────────────────────────────
{
  // Çekirdek: kapatma sebebi 3 karakterden kısaysa reddedilmeli.
  if (!/errReasonShort/.test(K.correctCore)) {
    hatalar.push(
      "M9 — lib/shift-correct.ts errReasonShort reddini kaybetmiş.\n" +
        "  AZG raporunu besleyen alanlar değişiyor; 'neden değişti' kayıtta olmalı (087)."
    );
  }
  // Uç: `duzelt` ve `kapat` dallarında sebep alanı ZORUNLU okunmalı.
  const i = K.patchUc.indexOf("export async function PATCH");
  const govde = i >= 0 ? K.patchUc.slice(i) : "";
  const sebepKapisi = (govde.match(/missing_fields[^\n]*alan:\s*"sebep"/g) ?? []).length;
  if (sebepKapisi < 2) {
    hatalar.push(
      `M9 — PATCH'te sebep zorunluluğu ${sebepKapisi} dalda var (2 olmalı: duzelt + kapat).\n` +
        "  Sebepsiz düzeltme, denetimde cevapsız kalan bir saat değişikliğidir."
    );
  }
  // İz kaynakları üçü de korunmalı.
  for (const k of ['"duzeltme"', '"km"', '"kapatma"']) {
    if (!K.correctCore.includes(`kaynak: ${k}`)) {
      hatalar.push(`M9 — shift-correct.ts'te iz kaynağı ${k} yok; denetimde hangi işlem olduğu kaybolur.`);
    }
  }
  if (!hatalar.some((h) => h.startsWith("M9"))) {
    notlar.push("M9 ✓ sebep zorunlu (duzelt + kapat) ve üç iz kaynağı da yerinde.");
  }
}

// ── M10 · PATCH KAPISI: YALNIZ PATRON ───────────────────────────────────────
{
  const i = K.patchUc.indexOf("export async function PATCH");
  const govde = i >= 0 ? K.patchUc.slice(i) : "";
  if (!/requireMobileAdmin\(/.test(govde)) {
    hatalar.push(
      "M10 — PATCH requireMobileAdmin kullanmıyor.\n" +
        "  Panelde üç düzeltme eylemi de requireAdmin ile korunuyor; filo şefine\n" +
        "  açmak PARİTEYİ BOZAR ve kapsam denetimi olmayan bir yazma yolu verir."
    );
  }
  if (/requireMobileFleetView\(|requireMobileWorkerScoped\(/.test(govde)) {
    hatalar.push("M10 — PATCH şefe açık bir kapı kullanıyor; panel paritesi bozuluyor.");
  }
  if (!hatalar.some((h) => h.startsWith("M10"))) {
    notlar.push("M10 ✓ PATCH yalnız patron (panelle birebir).");
  }
}

// ── M11 · /start GÖVDESİ workerId ALMAZ ─────────────────────────────────────
{
  if (/workerId|worker_id|personelId/.test(K.startUc)) {
    hatalar.push(
      "M11 — /shifts/start gövdesinde workerId geçiyor.\n" +
        "  Bu uç YALNIZ token'daki kişinin vardiyasını açar. Gövdeden kimlik\n" +
        "  kabul etmek, bir şoförün başkası adına vardiya açması demektir —\n" +
        "  kapı bir kontrol satırıyla değil, İSTEĞİN ŞEKLİYLE kapalı olmalı.\n" +
        "  Başkası adına açma /shifts/start-for ucunda ve ayrı bir kapıda."
    );
  } else {
    notlar.push("M11 ✓ /start gövdesi kimlik almıyor (kapı isteğin şekliyle kapalı).");
  }
}

// ── SONUÇ ───────────────────────────────────────────────────────────────────
if (hatalar.length > 0) {
  console.error(`\n✗ MOBİL UÇ TUR 1 MUHAFIZI — ${hatalar.length} bulgu:\n`);
  for (const h of hatalar) console.error("  " + h + "\n");
  process.exit(1);
}
console.log("✓ mobil uç tur 1 muhafızı: 11 denetim geçti.");
for (const n of notlar) console.log("  " + n);
