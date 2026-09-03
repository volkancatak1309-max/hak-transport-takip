#!/usr/bin/env node
/**
 * MOBİL UÇ TUR 1 — DAVRANIŞ KANITI (KURU KOŞUM).
 *
 * ═══ NE İSPATLAR, NE İSPATLAMAZ ═══
 *
 * İSPATLAR: dört ucun GERÇEK kodu, gerçek çekirdekleri ve gerçek şemalarıyla
 * koşuyor; hangi kapı hangi durumda kapanıyor, hangi HTTP kodu dönüyor,
 * veritabanına HANGİ YÜK gidiyor — hepsi ölçülüyor, tahmin edilmiyor.
 *
 * İSPATLAMAZ: veritabanının o yükü kabul edeceğini (kolon varlığı, CHECK,
 * unique indeks). O AYRI ölçülüyor: `scripts/measure-mobil-uc1-zemin.mjs`
 * şemayı CANLI kiracılarda (HAK61 + Sendigo) salt-okuma doğruluyor.
 *
 * ── NEDEN KURU ────────────────────────────────────────────────────────────
 * Elde yalnız iki CANLI MÜŞTERİ anahtarı var ve ikisine de yazma yasak
 * (Volkan kuralı: HAK61 salt okuma). galzura-demo'nun service anahtarı bu
 * çalışma ağacında YOK. Bu yüzden DB katmanı `scripts/supabase-mock.mjs` ile
 * bir kayıt cihazına çevrildi ve yükleyici gerçek anahtarları process'e HİÇ
 * sokmuyor (`scripts/ts-server-kuru.mjs`, sahte env).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server-kuru.mjs scripts/verify-mobil-uc-1.mjs
 */
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

// ── EMNİYET: şim gerçekten devrede mi ──────────────────────────────────────
if (supabaseAdmin?.__MOCK__ !== true) {
  console.error(
    "✗ DURDURULDU — supabase ŞİMİ devrede değil. Bu betik CANLI bir veritabanına\n" +
      "  yazmaya kalkardı. `--import ./scripts/ts-server-kuru.mjs` ile çalıştırın."
  );
  process.exit(1);
}

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);

// ── SABİTLER ───────────────────────────────────────────────────────────────
const SOFOR = "11111111-1111-4111-8111-111111111111";
const YONETICI = "22222222-2222-4222-8222-222222222222";
const SEF = "33333333-3333-4333-8333-333333333333";
const HEDEF = "44444444-4444-4444-8444-444444444444";
const ARAC = "55555555-5555-4555-8555-555555555555";
const VARDIYA = "66666666-6666-4666-8666-666666666666";
const MEVCUT_PIN = "418302";
const MEVCUT_HASH = bcrypt.hashSync(MEVCUT_PIN, 10);

/** Ortak kapının (verifyMobileRequest) beklediği satır. */
function kimlik(id, { admin = false, suruyor = true, tv = 7 } = {}) {
  return {
    id,
    name: "Kuru Koşum",
    is_admin: admin,
    is_active: true,
    must_change_pin: false,
    counts_as_driver: suruyor,
    token_version: tv,
  };
}

/**
 * Senaryo kurucu. `plan` = tablo → (durum) => cevap. Eşleşmeyen her sorgu
 * `{data:null,error:null}` alır; kod bu boşluğa dayanıklı olmalı (ve olduğu
 * bu betikle ölçülüyor).
 */
function senaryo(plan) {
  globalThis.__CAGRILAR__ = [];
  globalThis.__SENARYO__ = (d) => {
    const f = plan[d.table];
    const r = typeof f === "function" ? f(d) : f;
    return r ?? { data: null, error: null };
  };
}
const cagrilar = () => globalThis.__CAGRILAR__ ?? [];
const bul = (tablo, op) =>
  cagrilar().filter((c) => c.table === tablo && (op ? c.op === op : true));

async function istek(yol, { token, method = "POST", govde } = {}) {
  const h = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://kuru.invalid${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
}
const cevap = async (res) => ({ kod: res.status, govde: await res.json() });

console.log(`\n╔══ MOBİL UÇ TUR 1 · DAVRANIŞ KANITI (KURU KOŞUM) ═══════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

// Token'lar gerçek mühürle üretilir (lib/mobile-auth.ts issueTokens).
const tSofor = (await issueTokens(SOFOR, false, 7)).accessToken;
const tYonetici = (await issueTokens(YONETICI, true, 7)).accessToken;
const tSef = (await issueTokens(SEF, false, 7)).accessToken;

const { POST: PIN_POST } = await import("@/app/api/mobile/me/pin/route.ts");
const { POST: START_POST } = await import("@/app/api/mobile/shifts/start/route.ts");
const { POST: STARTFOR_POST } = await import("@/app/api/mobile/shifts/start-for/route.ts");
const { PATCH: SHIFT_PATCH } = await import("@/app/api/mobile/shifts/[id]/route.ts");

const params = (id) => ({ params: Promise.resolve({ id }) });

// ════════════════════════════════════════════════════════════════════════════
// 1. PIN UCU
// ════════════════════════════════════════════════════════════════════════════
baslik("1. POST /api/mobile/me/pin");

/** PIN akışının ortak planı. `kilit` = login_attempts'in döneceği satır. */
function pinPlan({ kilit = null, denemeler = 0 } = {}) {
  return {
    workers: (d) => {
      if (d.op === "update") return { data: null, error: null };
      /**
       * ⚠️ DAL SIRASI ÖNEMLİ. Ortak kapının (verifyMobileRequest) seçimi
       * `is_admin` VE `id` içeriyor; changeOwnPin'inki de ("id, is_admin").
       * Genel daldan önce yazılmazsa kapı sorgusu yanlış satırı alır ve her
       * istek 401 `inactive` döner — bu betiğin ilk koşumunda tam olarak
       * bu oldu. Ayırt edici alan `counts_as_driver`.
       */
      if (d.secim?.includes("counts_as_driver")) return { data: kimlik(SOFOR), error: null };
      if (d.secim?.includes("phone")) return { data: { phone: "+43660111", pin_hash: MEVCUT_HASH }, error: null };
      if (d.secim === "token_version") return { data: { token_version: 7 }, error: null };
      if (d.secim?.includes("is_admin")) return { data: { id: SOFOR, is_admin: false }, error: null };
      return { data: kimlik(SOFOR), error: null };
    },
    login_attempts: (d) => {
      if (d.op === "select" && d.secim?.includes("locked_until") && !d.secim.includes("attempts")) {
        return { data: kilit, error: null };
      }
      if (d.op === "select") return { data: { attempts: denemeler, last_attempt_at: new Date().toISOString() }, error: null };
      return { data: null, error: null };
    },
  };
}

// P1 — token yok
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", { govde: {} })));
  iddia("P1 token yok → 401 missing_token", r.kod === 401 && r.govde.error === "missing_token", `${r.kod} ${r.govde.error}`);
}

// P2 — eksik alan
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", { token: tSofor, govde: { mevcutPin: MEVCUT_PIN } })));
  iddia("P2 eksik alan → 400 missing_fields", r.kod === 400 && r.govde.error === "missing_fields", `${r.kod} ${r.govde.error} alan=${r.govde.alan}`);
}

// P3 — YANLIŞ mevcut PIN: 403 + kilit sayacına YAZILDI
senaryo(pinPlan({ denemeler: 3 }));
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: "999999", yeniPin: "740193", yeniPinTekrar: "740193" },
  })));
  const yazma = bul("login_attempts", "upsert");
  const yuk = yazma[0]?.payload ?? {};
  iddia("P3 yanlış mevcut PIN → 403 (401 DEĞİL)", r.kod === 403 && r.govde.error === "mevcut_pin_hatali", `${r.kod} ${r.govde.error}`);
  iddia("P3 login_attempts'e YAZILDI (giriş sayacı ortak)", yazma.length === 1, `${yazma.length} upsert`);
  iddia("P3 sayaç İLERLEDİ (3 → 4)", yuk.attempts === 4, `attempts=${yuk.attempts}`);
  iddia("P3 kilit kimliği ip|telefon biçiminde", typeof yuk.identifier === "string" && yuk.identifier.startsWith("203.0.113.7|"), yuk.identifier);
  iddia("P3 workers'a YAZMA YOK (PIN değişmedi)", bul("workers", "update").length === 0, `${bul("workers", "update").length} update`);
}

// P4 — KİLİTLİ
{
  const bitis = new Date(Date.now() + 45_000).toISOString();
  senaryo(pinPlan({ kilit: { locked_until: bitis } }));
  const res = await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: MEVCUT_PIN, yeniPin: "740193", yeniPinTekrar: "740193" },
  }));
  const r = await cevap(res);
  iddia("P4 kilitliyken → 429 kilitli", r.kod === 429 && r.govde.error === "kilitli", `${r.kod} ${r.govde.error}`);
  iddia("P4 Retry-After başlığı var", !!res.headers.get("Retry-After"), `Retry-After=${res.headers.get("Retry-After")}`);
  iddia("P4 bcrypt'ten ÖNCE durdu (workers pin_hash okunmadı sonrası yazma yok)", bul("workers", "update").length === 0, null);
}

// P5 — ZAYIF yeni PIN (panelin katı şeması)
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: MEVCUT_PIN, yeniPin: "123456", yeniPinTekrar: "123456" },
  })));
  iddia("P5 zayıf yeni PIN (123456) → 400 errPinWeak", r.kod === 400 && r.govde.sebep === "errPinWeak", `${r.kod} ${r.govde.error}/${r.govde.sebep}`);
  iddia("P5 doğru mevcut PIN sayacı SIFIRLADI", bul("login_attempts", "delete").length === 1, `${bul("login_attempts", "delete").length} delete`);
}

// P6 — tekrar eşleşmiyor
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: MEVCUT_PIN, yeniPin: "740193", yeniPinTekrar: "740194" },
  })));
  iddia("P6 tekrar eşleşmiyor → 400 errPinMismatch", r.kod === 400 && r.govde.sebep === "errPinMismatch", `${r.kod} ${r.govde.sebep}`);
}

// P7 — aynı PIN
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: MEVCUT_PIN, yeniPin: MEVCUT_PIN, yeniPinTekrar: MEVCUT_PIN },
  })));
  iddia("P7 aynı PIN → 400 ayni_pin", r.kod === 400 && r.govde.error === "ayni_pin", `${r.kod} ${r.govde.error}`);
}

// P8 — BAŞARILI
senaryo(pinPlan());
{
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: MEVCUT_PIN, yeniPin: "740193", yeniPinTekrar: "740193" },
  })));
  const yazmalar = bul("workers", "update");
  const pinYuk = yazmalar.find((w) => "pin_hash" in (w.payload ?? {}))?.payload ?? {};
  const tvYuk = yazmalar.find((w) => "token_version" in (w.payload ?? {}))?.payload ?? {};
  iddia("P8 başarılı → 200", r.kod === 200 && r.govde.ok === true, `${r.kod}`);
  iddia("P8 pin_hash YAZILDI ve HAM PIN DEĞİL", typeof pinYuk.pin_hash === "string" && pinYuk.pin_hash.startsWith("$2"), `${String(pinYuk.pin_hash).slice(0, 7)}…`);
  iddia("P8 yazılan hash YENİ PIN'i doğruluyor", bcrypt.compareSync("740193", pinYuk.pin_hash ?? ""), null);
  iddia("P8 must_change_pin=false yazıldı (zorunlu değişim kapanır)", pinYuk.must_change_pin === false, `${pinYuk.must_change_pin}`);
  iddia("P8 token_version ARTTI (7 → 8): diğer cihazlar düşer", tvYuk.token_version === 8, `${tvYuk.token_version}`);
  iddia("P8 ÇAĞIRAN CİHAZA yeni token verildi", typeof r.govde.accessToken === "string" && typeof r.govde.refreshToken === "string", null);
  iddia("P8 tokenIptal:true (044 var)", r.govde.tokenIptal === true, `${r.govde.tokenIptal}`);
  iddia("P8 yanıt PIN'i GERİ DÖNDÜRMÜYOR", !JSON.stringify(r.govde).includes("740193"), null);
  iddia("P8 sayaç sıfırlandı", bul("login_attempts", "delete").length === 1, null);
}

// P9 — 4 HANELİ mevcut PIN kabul edilmeli (eski PIN'li kullanıcı kilitlenmesin)
{
  const eskiHash = bcrypt.hashSync("4183", 10);
  const plan = pinPlan();
  const asil = plan.workers;
  plan.workers = (d) => {
    if (d.op === "select" && d.secim?.includes("phone")) {
      return { data: { phone: "+43660111", pin_hash: eskiHash }, error: null };
    }
    return asil(d);
  };
  senaryo(plan);
  const r = await cevap(await PIN_POST(await istek("/api/mobile/me/pin", {
    token: tSofor, govde: { mevcutPin: "4183", yeniPin: "740193", yeniPinTekrar: "740193" },
  })));
  iddia("P9 4 haneli MEVCUT PIN kabul (loginPinSchema, girişle aynı gevşeklik)", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. VARDİYA BAŞLATMA — kendi
// ════════════════════════════════════════════════════════════════════════════
baslik("2. POST /api/mobile/shifts/start");

function startPlan({
  aktif = true,
  arac = { id: ARAC, plate: "W-1234", status: "active" },
  acikVardiya = null,
  bugunVardiya = null,
  admin = false,
  suruyor = true,
} = {}) {
  return {
    workers: (d) => {
      if (d.secim === "is_active") return { data: { is_active: aktif }, error: null };
      return { data: kimlik(SOFOR, { admin, suruyor }), error: null };
    },
    vehicles: () => ({ data: arac, error: null }),
    time_entries: (d) => {
      if (d.op === "insert") return { data: { id: VARDIYA }, error: null };
      if (d.op === "update") return { data: null, error: null };
      // Açık vardiya sorgusu: `.is("ended_at", null)` filtresi taşır.
      const acikSorgu = d.filters.some((f) => f[0] === "is" && f[1] === "ended_at");
      if (acikSorgu) return { data: acikVardiya, error: null };
      return { data: bugunVardiya, error: null };
    },
    geofences: () => ({ data: [], error: null }),
    device_telemetry: () => ({ data: [], error: null }),
  };
}

// S1 — direksiyona geçmeyen yönetici
senaryo(startPlan({ admin: true, suruyor: false }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tYonetici, govde: {} })));
  iddia("S1 yönetici (counts_as_driver=false) → 403 not_a_driver", r.kod === 403 && r.govde.error === "not_a_driver", `${r.kod} ${r.govde.error}`);
  iddia("S1 time_entries'e HİÇ dokunulmadı", bul("time_entries").length === 0, null);
}

// S2 — pasif çalışan
senaryo(startPlan({ aktif: false }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  iddia("S2 pasif çalışan → 403 inactive_worker", r.kod === 403 && r.govde.error === "inactive_worker", `${r.kod} ${r.govde.error}`);
}

// S3 — araç yok
senaryo(startPlan({ arac: null }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  iddia("S3 atanmış araç yok → 404 no_vehicle", r.kod === 404 && r.govde.error === "no_vehicle", `${r.kod} ${r.govde.error}`);
}

// S4 — zaten açık vardiya
senaryo(startPlan({ acikVardiya: { id: VARDIYA } }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  iddia("S4 açık vardiya varken → 409 active", r.kod === 409 && r.govde.error === "active", `${r.kod} ${r.govde.error}`);
  iddia("S4 insert DENENMEDİ", bul("time_entries", "insert").length === 0, null);
}

// S5 — bakımdaki araç
senaryo(startPlan({ arac: { id: ARAC, plate: "W-1234", status: "maintenance" } }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  iddia("S5 bakımdaki araç → 409 vehicle_unavailable", r.kod === 409 && r.govde.error === "vehicle_unavailable", `${r.kod} ${r.govde.error}`);
}

// S6 — BAŞARILI
senaryo(startPlan());
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  const yuk = bul("time_entries", "insert")[0]?.payload ?? {};
  iddia("S6 başarılı → 200", r.kod === 200 && r.govde.ok === true, `${r.kod}`);
  iddia("S6 worker_id TOKEN'dan (gövdeden değil)", yuk.worker_id === SOFOR, `${yuk.worker_id}`);
  iddia("S6 auto_started=false (auto-shift bu vardiyayı kapatmaz)", yuk.auto_started === false, `${yuk.auto_started}`);
  iddia("S6 confirmation_status='confirmed'", yuk.confirmation_status === "confirmed", `${yuk.confirmation_status}`);
  iddia("S6 vehicle_id dolduruldu", yuk.vehicle_id === ARAC, `${yuk.vehicle_id}`);
  iddia("S6 break_minutes=0", yuk.break_minutes === 0, `${yuk.break_minutes}`);
  iddia("S6 yanıt yenidenAcildi=false", r.govde.vardiya?.yenidenAcildi === false, `${r.govde.vardiya?.yenidenAcildi}`);
}

// S7 — gövdedeki workerId YOK SAYILIR (kendi vardiyası açılır)
senaryo(startPlan());
{
  await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: { workerId: HEDEF } }));
  const yuk = bul("time_entries", "insert")[0]?.payload ?? {};
  iddia("S7 gövdedeki workerId YOK SAYILDI (kendi vardiyası açıldı)", yuk.worker_id === SOFOR, `${yuk.worker_id}`);
}

// S8 — GÜNDE TEK VARDİYA: yeniden açma (yeni satır DEĞİL)
senaryo(startPlan({ bugunVardiya: { id: VARDIYA, vehicle_id: ARAC, plate: "W-1234" } }));
{
  const r = await cevap(await START_POST(await istek("/api/mobile/shifts/start", { token: tSofor, govde: {} })));
  const upd = bul("time_entries", "update")[0]?.payload ?? {};
  iddia("S8 bugün kapanmış vardiya var → YENİDEN AÇILDI", r.kod === 200 && r.govde.vardiya?.yenidenAcildi === true, `${r.kod} yenidenAcildi=${r.govde.vardiya?.yenidenAcildi}`);
  iddia("S8 YENİ SATIR AÇILMADI", bul("time_entries", "insert").length === 0, `${bul("time_entries", "insert").length} insert`);
  iddia("S8 ended_at null'a çekildi", upd.ended_at === null, `${upd.ended_at}`);
  iddia("S8 kapanış artıkları temizlendi (özet imzası + teslim edilemeyen)", upd.summary_confirmed_at === null && upd.undelivered_count === null, null);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. BAŞKASI ADINA BAŞLATMA
// ════════════════════════════════════════════════════════════════════════════
baslik("3. POST /api/mobile/shifts/start-for");

const BUGUN_0700 = (() => {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  return d.toISOString();
})();

function startForPlan({ rolAdmin = true, hedefAdmin = false, hedefSuruyor = true, filo = null } = {}) {
  return {
    workers: (d) => {
      const hedefMi = d.filters.some((f) => f[1] === "id" && f[2] === HEDEF);
      if (hedefMi) {
        return { data: { id: HEDEF, is_active: true, is_admin: hedefAdmin, counts_as_driver: hedefSuruyor }, error: null };
      }
      return { data: kimlik(rolAdmin ? YONETICI : SEF, { admin: rolAdmin }), error: null };
    },
    // getManagedFleet — şef değilse null.
    managed_fleet: () => ({ data: filo, error: null }),
    vehicles: () => ({ data: { id: ARAC, plate: "W-1234", status: "active" }, error: null }),
    time_entries: (d) => {
      if (d.op === "insert") return { data: { id: VARDIYA }, error: null };
      return { data: null, error: null };
    },
    device_telemetry: () => ({ data: [], error: null }),
    geofences: () => ({ data: [], error: null }),
  };
}

// F1 — sıradan şoför
senaryo(startForPlan({ rolAdmin: false }));
{
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tSef, govde: { workerId: HEDEF, baslangic: BUGUN_0700 },
  })));
  iddia("F1 şoför/şefsiz → 403 unauthorized", r.kod === 403 && r.govde.error === "unauthorized", `${r.kod} ${r.govde.error}`);
  iddia("F1 time_entries'e HİÇ dokunulmadı", bul("time_entries").length === 0, null);
}

// F2 — eksik alan
senaryo(startForPlan());
{
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tYonetici, govde: { workerId: HEDEF },
  })));
  iddia("F2 baslangic yok → 400 missing_fields", r.kod === 400 && r.govde.alan === "baslangic", `${r.kod} ${r.govde.alan}`);
}

// F3 — gelecek zaman
senaryo(startForPlan());
{
  const gelecek = new Date(Date.now() + 3 * 3600_000).toISOString();
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tYonetici, govde: { workerId: HEDEF, baslangic: gelecek },
  })));
  iddia("F3 gelecek başlangıç → 400 future_time", r.kod === 400 && r.govde.error === "future_time", `${r.kod} ${r.govde.error}`);
}

// F4 — dünkü zaman
senaryo(startForPlan());
{
  const dun = new Date(Date.now() - 30 * 3600_000).toISOString();
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tYonetici, govde: { workerId: HEDEF, baslangic: dun },
  })));
  iddia("F4 dünkü başlangıç → 400 not_today", r.kod === 400 && r.govde.error === "not_today", `${r.kod} ${r.govde.error}`);
}

// F5 — hedef direksiyona geçmeyen yönetici
senaryo(startForPlan({ hedefAdmin: true, hedefSuruyor: false }));
{
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tYonetici, govde: { workerId: HEDEF, baslangic: BUGUN_0700 },
  })));
  iddia("F5 hedef yönetici (şoför değil) → 403 not_a_driver", r.kod === 403 && r.govde.error === "not_a_driver", `${r.kod} ${r.govde.error}`);
}

// F6 — BAŞARILI (patron)
senaryo(startForPlan());
{
  const r = await cevap(await STARTFOR_POST(await istek("/api/mobile/shifts/start-for", {
    token: tYonetici, govde: { workerId: HEDEF, baslangic: BUGUN_0700 },
  })));
  const yuk = bul("time_entries", "insert")[0]?.payload ?? {};
  iddia("F6 başarılı → 200", r.kod === 200 && r.govde.ok === true, `${r.kod} ${r.govde.error ?? ""}`);
  iddia("F6 worker_id HEDEF şoför", yuk.worker_id === HEDEF, `${yuk.worker_id}`);
  iddia("F6 started_at ÇAĞIRANDAN geldi (07:00 korundu)", yuk.started_at === BUGUN_0700, `${yuk.started_at}`);
  iddia("F6 start_source='admin' (iz)", yuk.start_source === "admin", `${yuk.start_source}`);
  iddia("F6 started_by = eylemi yapan", yuk.started_by === YONETICI, `${yuk.started_by}`);
  iddia("F6 yanıt kaynağı söylüyor", r.govde.kaynak === "admin", `${r.govde.kaynak}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. DÜZELTME
// ════════════════════════════════════════════════════════════════════════════
baslik("4. PATCH /api/mobile/shifts/[id]");

function patchPlan({ admin = true, acik = true } = {}) {
  return {
    workers: () => ({ data: kimlik(admin ? YONETICI : SEF, { admin }), error: null }),
    managed_fleet: () => ({ data: null, error: null }),
    time_entries: (d) => {
      if (d.op === "update") return { data: null, error: null };
      if (d.secim?.includes("confirmation_status")) {
        return {
          data: acik
            ? { id: VARDIYA, worker_id: SOFOR, vehicle_id: ARAC, started_at: BUGUN_0700, start_km: 1000, confirmation_status: "confirmed" }
            : null,
          error: null,
        };
      }
      return { data: { start_km: 1000, end_km: 1100, started_at: BUGUN_0700, ended_at: null, break_minutes: 30 }, error: null };
    },
    shift_edit_log: () => ({ data: null, error: null }),
    /**
     * DİZİ dönmeli: `latestVehicleTelemetry` sayfalı okuma yapıyor ve
     * sonucu yayıyor (`[...pencere]`). Nesne dönmek "pencere is not
     * iterable" ile patlatıyordu — ilk koşumda ölçüldü.
     */
    device_telemetry: (d) =>
      d.secim?.includes("recorded_at") && !d.secim.includes("odometer_km")
        ? { data: { recorded_at: new Date().toISOString() }, error: null }
        : { data: [{ recorded_at: new Date().toISOString(), odometer_km: 1120, speed_kmh: 0 }], error: null },
    vehicles: () => ({ data: { id: ARAC, tank_capacity_l: 60 }, error: null }),
  };
}

// A1 — filo şefi
senaryo(patchPlan({ admin: false }));
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tSef, method: "PATCH", govde: { islem: "km", baslangicKm: 1000 },
  }), params(VARDIYA)));
  iddia("A1 filo şefi → 403 admin_required (panel paritesi)", r.kod === 403 && r.govde.error === "admin_required", `${r.kod} ${r.govde.error}`);
  iddia("A1 time_entries'e HİÇ dokunulmadı", bul("time_entries").length === 0, null);
}

// A2 — geçersiz işlem
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "sil" },
  }), params(VARDIYA)));
  iddia("A2 bilinmeyen islem → 400 gecersiz_islem", r.kod === 400 && r.govde.error === "gecersiz_islem", `${r.kod} ${r.govde.error}`);
}

// A3 — kapat, sebep kısa
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "kapat", sebep: "ok" },
  }), params(VARDIYA)));
  iddia("A3 kapat + kısa sebep → 400 errReasonShort (087)", r.kod === 400 && r.govde.error === "errReasonShort", `${r.kod} ${r.govde.error}`);
  iddia("A3 yazma YAPILMADI", bul("time_entries", "update").length === 0, null);
}

// A4 — km, bitiş < başlangıç
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "km", baslangicKm: 1200, bitisKm: 1100 },
  }), params(VARDIYA)));
  iddia("A4 bitiş < başlangıç → 400 km_low:…", r.kod === 400 && String(r.govde.error).startsWith("km_low:"), `${r.kod} ${r.govde.error}`);
}

// A5 — duzelt, sebepsiz
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "duzelt", baslangic: BUGUN_0700, baslangicKm: 1000 },
  }), params(VARDIYA)));
  iddia("A5 duzelt + sebepsiz → 400 missing_fields(sebep)", r.kod === 400 && r.govde.alan === "sebep", `${r.kod} ${r.govde.alan}`);
}

// A6 — kapat BAŞARILI: bitiş telemetriden, iz yazıldı
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "kapat", sebep: "Şoför kapatmayı unuttu" },
  }), params(VARDIYA)));
  const upd = bul("time_entries", "update").map((u) => u.payload);
  const kapanis = upd.find((p) => "ended_at" in p) ?? {};
  const iz = bul("shift_edit_log", "insert")[0]?.payload ?? [];
  iddia("A6 kapat başarılı → 200", r.kod === 200 && r.govde.ok === true, `${r.kod} ${r.govde.error ?? ""}`);
  iddia("A6 ended_at yazıldı", typeof kapanis.ended_at === "string", `${kapanis.ended_at}`);
  iddia("A6 end_reason='admin'", kapanis.end_reason === "admin", `${kapanis.end_reason}`);
  iddia("A6 DÜZELTME İZİ yazıldı (087)", Array.isArray(iz) && iz.length > 0, `${Array.isArray(iz) ? iz.length : 0} satır`);
  iddia("A6 iz SEBEBİ taşıyor", Array.isArray(iz) && iz[0]?.reason === "Şoför kapatmayı unuttu", `${Array.isArray(iz) ? iz[0]?.reason : "—"}`);
  iddia("A6 iz kaynağı 'kapatma'", Array.isArray(iz) && iz[0]?.kaynak === "kapatma", `${Array.isArray(iz) ? iz[0]?.kaynak : "—"}`);
}

// A7 — kapat, vardiya zaten kapalı
senaryo(patchPlan({ acik: false }));
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH", govde: { islem: "kapat", sebep: "Unutulmuş vardiya" },
  }), params(VARDIYA)));
  iddia("A7 zaten kapalı vardiya → 409 no_active", r.kod === 409 && r.govde.error === "no_active", `${r.kod} ${r.govde.error}`);
}

// A8 — duzelt BAŞARILI: paket matematiği türetiliyor
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH",
    govde: {
      islem: "duzelt", baslangic: BUGUN_0700, bitis: new Date().toISOString(),
      baslangicKm: 1000, bitisKm: 1120, molaDk: 45,
      paketAlinan: 50, paketTeslimEdilemeyen: 8, sebep: "Mola süresi yanlış girilmiş",
    },
  }), params(VARDIYA)));
  const upd = bul("time_entries", "update").map((u) => u.payload).find((p) => "started_at" in p) ?? {};
  iddia("A8 duzelt başarılı → 200", r.kod === 200 && r.govde.ok === true, `${r.kod} ${r.govde.error ?? ""}`);
  iddia("A8 teslim SUNUCUDA türetildi (50 − 8 = 42)", upd.cargo_count === 42, `cargo_count=${upd.cargo_count}`);
  iddia("A8 break_minutes yazıldı", upd.break_minutes === 45, `${upd.break_minutes}`);
  iddia("A8 iz kaynağı 'duzeltme'", (bul("shift_edit_log", "insert")[0]?.payload ?? [])[0]?.kaynak === "duzeltme", null);
}

// A9 — paket tavanı: geri getirilen > alınan
senaryo(patchPlan());
{
  const r = await cevap(await SHIFT_PATCH(await istek(`/api/mobile/shifts/${VARDIYA}`, {
    token: tYonetici, method: "PATCH",
    govde: {
      islem: "duzelt", baslangic: BUGUN_0700, baslangicKm: 1000,
      paketAlinan: 10, paketTeslimEdilemeyen: 12, sebep: "Deneme",
    },
  }), params(VARDIYA)));
  iddia("A9 geri getirilen > alınan → 400", r.kod === 400, `${r.kod} ${r.govde.error}`);
  iddia("A9 yazma YAPILMADI", bul("time_entries", "update").length === 0, null);
}

// ── SONUÇ ──────────────────────────────────────────────────────────────────
const toplam = 0;
console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ${"═".repeat(30)}`);
void toplam;
process.exit(dusen === 0 ? 0 : 1);
