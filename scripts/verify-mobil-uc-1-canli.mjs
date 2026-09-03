#!/usr/bin/env node
/**
 * MOBİL UÇ TUR 1 — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * Dört ucun GERÇEK route handler'larını GERÇEK veritabanına karşı koşturur ve
 * her adımda ÖNCE/SONRA sayılarını basar. Kuru koşumdan (verify-mobil-uc-1.mjs)
 * farkı: orada DB bir kayıt cihazıydı, burada gerçek satırlar yazılıyor.
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR. HAK61 salt okuma (Volkan kuralı).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 *   • PIN → 183434 → <yeni> → 183434. `finally` bloğunda da geri yazılır ve
 *     geri yazmanın TUTTUĞU ölçülür (bcrypt.compare ile).
 *   • Vardiya → mevcut AÇIK vardiya kapatılır, sonra şoför yoluyla YENİDEN
 *     AÇILIR. Şoför yolu `started_at`e dokunmaz, yani başlangıç anı korunur.
 *   • Km → değiştirilir, ölçülür, ORİJİNAL değere geri yazılır.
 *
 * ── GERİ ALINAMAYAN (bilerek) ─────────────────────────────────────────────
 *   • `shift_edit_log` satırları — DENETİM İZİ. Silmek, izin kendisini
 *     anlamsız kılardı; testin bıraktığı satırlar raporda sayılıyor.
 *   • `workers.token_version` — her PIN değişiminde artar (2 kez). Geri
 *     çekmek iptal edilmiş token'ları CANLANDIRIRDI.
 *   • `updated_at` / `updated_by` damgaları.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-mobil-uc-1-canli.mjs
 */
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { SHIFT_PER_DAY, DRIVER_VEHICLE_CHOICE } from "@/lib/tenant";

// ── EMNİYET 1: ŞİM DEĞİL, GERÇEK İSTEMCİ ───────────────────────────────────
if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}

// ── EMNİYET 2: YALNIZ galzura-demo ─────────────────────────────────────────
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n` +
      `  Beklenen ref: ${DEMO_REF}\n  Gelen URL:    ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; bu betik oralarda ASLA koşmaz.`
  );
  process.exit(1);
}

const TEL = "+90123456789";
const PIN_ASIL = "183434";
const PIN_GECICI = "740193";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

/**
 * Tablo satır sayısı.
 *
 * ⚠️ İLK HÂLİ `.or("id.not.is.null")` taşıyordu ve `login_attempts`te SESSİZCE
 * 0 dönüyordu: o tabloda `id` kolonu YOK (anahtar `identifier`). PostgREST
 * hatayı `error`da veriyor, `count` null kalıyor, `?? 0` onu "sıfır satır"
 * gibi gösteriyordu — yani ölçüm aracının kendisi yanlış ölçüyordu.
 * Filtre kaldırıldı; hata artık YUTULMUYOR.
 */
const sayim = async (tablo) => {
  const { count, error } = await supabaseAdmin
    .from(tablo)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`sayım düştü (${tablo}): ${error.message}`);
  return count ?? 0;
};

async function isci(alanlar) {
  const { data } = await supabaseAdmin
    .from("workers")
    .select(alanlar)
    .eq("phone", TEL)
    .maybeSingle();
  return data;
}

const istek = (yol, { token, method = "POST", govde } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://demo.galzura.com${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};
const cevap = async (res) => ({ kod: res.status, govde: await res.json() });

console.log(`\n╔══ MOBİL UÇ TUR 1 · CANLIDA KANIT (galzura-demo) ═══════════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ hedef    ${url}`);
console.log(`║ kiracı   SHIFT_PER_DAY=${SHIFT_PER_DAY} · DRIVER_VEHICLE_CHOICE=${DRIVER_VEHICLE_CHOICE}`);
console.log(`║ ⚠️ bayraklar bu KOŞUMUN env'inden; canlı Vercel env'i okunamıyor.`);

let w0 = null;
let acikVardiyaId = null;
let kmOrijinal = null;

try {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("0. ÖNCE — başlangıç durumu");
  w0 = await isci("id, name, phone, is_admin, is_active, is_test, must_change_pin, counts_as_driver, token_version, pin_hash");
  if (!w0) {
    console.error(`✗ ${TEL} bulunamadı.`);
    process.exit(1);
  }
  const izOnce = await sayim("shift_edit_log");
  const kilitOnce = await sayim("login_attempts");
  const vardiyaOnce = await sayim("time_entries");

  bilgi(`worker      ${w0.id}  "${w0.name}"`);
  bilgi(`bayraklar   is_admin=${w0.is_admin} is_active=${w0.is_active} is_test=${w0.is_test} counts_as_driver=${w0.counts_as_driver}`);
  bilgi(`token_version=${w0.token_version} must_change_pin=${w0.must_change_pin}`);
  bilgi(`SAYIMLAR    time_entries=${vardiyaOnce} shift_edit_log=${izOnce} login_attempts=${kilitOnce}`);

  iddia(`mevcut PIN gerçekten ${PIN_ASIL}`, await bcrypt.compare(PIN_ASIL, w0.pin_hash), null);
  iddia("hesap şoför yolundan geçebilir (is_admin=false)", w0.is_admin === false, null);

  const { data: acik } = await supabaseAdmin
    .from("time_entries")
    .select("id, started_at, start_km, end_km, ended_at")
    .eq("worker_id", w0.id)
    .is("ended_at", null)
    .maybeSingle();
  if (acik) {
    acikVardiyaId = acik.id;
    kmOrijinal = { start_km: acik.start_km, end_km: acik.end_km };
    bilgi(`AÇIK VARDİYA ${acik.id}  başlangıç=${acik.started_at}  start_km=${acik.start_km}`);
  } else {
    bilgi(`açık vardiya YOK`);
  }

  const { POST: PIN_POST } = await import("@/app/api/mobile/me/pin/route.ts");
  const { POST: START_POST } = await import("@/app/api/mobile/shifts/start/route.ts");
  const { PATCH: SHIFT_PATCH } = await import("@/app/api/mobile/shifts/[id]/route.ts");
  const params = (id) => ({ params: Promise.resolve({ id }) });

  const tokenAl = async () => {
    const w = await isci("id, is_admin, token_version");
    return (await issueTokens(w.id, w.is_admin, w.token_version ?? 0)).accessToken;
  };

  // ══════════════════════════════════════════════════════════════════════════
  baslik("1. PIN — yanlış mevcut PIN, kilit sayacı");
  {
    const tv0 = (await isci("token_version")).token_version;
    const kilitOnceTel = await sayim("login_attempts");

    const r = await cevap(
      await PIN_POST(
        istek("/api/mobile/me/pin", {
          token: await tokenAl(),
          govde: { mevcutPin: "999999", yeniPin: PIN_GECICI, yeniPinTekrar: PIN_GECICI },
        })
      )
    );
    const kilitSonra = await sayim("login_attempts");
    const w = await isci("token_version, pin_hash");

    iddia("yanlış mevcut PIN → 403 mevcut_pin_hatali", r.kod === 403 && r.govde.error === "mevcut_pin_hatali", `${r.kod} ${r.govde.error}`);
    iddia(`login_attempts ARTTI (${kilitOnceTel} → ${kilitSonra})`, kilitSonra === kilitOnceTel + 1, `+${kilitSonra - kilitOnceTel}`);
    iddia("PIN DEĞİŞMEDİ (hâlâ 183434)", await bcrypt.compare(PIN_ASIL, w.pin_hash), null);
    iddia(`token_version DEĞİŞMEDİ (${tv0})`, w.token_version === tv0, `${w.token_version}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("2. PIN — DOĞRU mevcut PIN, değişim");
  {
    const tv0 = (await isci("token_version")).token_version;
    const kilitOnceTel = await sayim("login_attempts");

    const r = await cevap(
      await PIN_POST(
        istek("/api/mobile/me/pin", {
          token: await tokenAl(),
          govde: { mevcutPin: PIN_ASIL, yeniPin: PIN_GECICI, yeniPinTekrar: PIN_GECICI },
        })
      )
    );
    const kilitSonra = await sayim("login_attempts");
    const w = await isci("token_version, pin_hash, must_change_pin");

    iddia("→ 200", r.kod === 200 && r.govde.ok === true, `${r.kod} ${r.govde.error ?? ""}`);
    iddia(`PIN GERÇEKTEN DEĞİŞTİ (${PIN_ASIL} → ${PIN_GECICI})`, await bcrypt.compare(PIN_GECICI, w.pin_hash), null);
    iddia("eski PIN artık GEÇERSİZ", !(await bcrypt.compare(PIN_ASIL, w.pin_hash)), null);
    iddia(`token_version ARTTI (${tv0} → ${w.token_version})`, w.token_version === tv0 + 1, `+${w.token_version - tv0}`);
    iddia("yanıt tokenIptal:true", r.govde.tokenIptal === true, `${r.govde.tokenIptal}`);
    iddia("çağıran cihaza YENİ token verildi", typeof r.govde.accessToken === "string" && r.govde.accessToken.length > 40, null);
    iddia(`login_attempts SIFIRLANDI (${kilitOnceTel} → ${kilitSonra})`, kilitSonra === kilitOnceTel - 1, `${kilitSonra - kilitOnceTel}`);
    iddia("must_change_pin=false", w.must_change_pin === false, `${w.must_change_pin}`);

    // Yeni token GERÇEKTEN geçerli mi — yeni sürümle mühürlendiği ölçülüyor.
    const { verifyMobileRequest } = await import("@/lib/mobile-auth");
    const g = await verifyMobileRequest({
      headers: new Headers({ authorization: `Bearer ${r.govde.accessToken}` }),
    });
    iddia("YENİ token kabul ediliyor (çağıran cihaz düşmedi)", g.ok === true, g.ok ? "ok" : `${g.status} ${g.code}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("3. PIN — GERİ AL (183434)");
  {
    const tv0 = (await isci("token_version")).token_version;
    const r = await cevap(
      await PIN_POST(
        istek("/api/mobile/me/pin", {
          token: await tokenAl(),
          govde: { mevcutPin: PIN_GECICI, yeniPin: PIN_ASIL, yeniPinTekrar: PIN_ASIL },
        })
      )
    );
    const w = await isci("token_version, pin_hash");
    iddia("→ 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
    iddia(`🔴 PIN ${PIN_ASIL}'e GERİ DÖNDÜ`, await bcrypt.compare(PIN_ASIL, w.pin_hash), null);
    iddia(`token_version yine arttı (${tv0} → ${w.token_version})`, w.token_version === tv0 + 1, null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("4. VARDİYA — açık vardiya varken başlatma");
  if (acikVardiyaId) {
    const vOnce = await sayim("time_entries");
    const r = await cevap(await START_POST(istek("/api/mobile/shifts/start", { token: await tokenAl(), govde: {} })));
    const vSonra = await sayim("time_entries");
    iddia("açık vardiya varken → 409 active", r.kod === 409 && r.govde.error === "active", `${r.kod} ${r.govde.error}`);
    iddia(`time_entries DEĞİŞMEDİ (${vOnce} → ${vSonra})`, vSonra === vOnce, null);
  } else {
    bilgi("açık vardiya yok — bu adım atlandı");
  }

  // ══════════════════════════════════════════════════════════════════════════
  baslik("5. DÜZELTME — km (PATCH islem=km)");
  if (acikVardiyaId) {
    const izOnceKm = await sayim("shift_edit_log");
    const yeniKm = (kmOrijinal.start_km ?? 0) + 7;
    const wAdmin = await supabaseAdmin
      .from("workers")
      .select("id, is_admin, token_version")
      .eq("is_admin", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!wAdmin.data) {
      bilgi("⚠ yönetici hesabı bulunamadı — düzeltme adımları ATLANDI");
    } else {
      const tAdmin = (await issueTokens(wAdmin.data.id, true, wAdmin.data.token_version ?? 0)).accessToken;
      bilgi(`yönetici token: ${wAdmin.data.id}`);

      const r = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acikVardiyaId}`, {
            token: tAdmin,
            method: "PATCH",
            govde: { islem: "km", baslangicKm: yeniKm, bitisKm: null },
          }),
          params(acikVardiyaId)
        )
      );
      const { data: v } = await supabaseAdmin
        .from("time_entries")
        .select("start_km, updated_by")
        .eq("id", acikVardiyaId)
        .maybeSingle();
      const izSonraKm = await sayim("shift_edit_log");

      iddia("km düzeltme → 200", r.kod === 200, `${r.kod} ${r.govde.error ?? ""}`);
      iddia(`start_km DEĞİŞTİ (${kmOrijinal.start_km} → ${yeniKm})`, v.start_km === yeniKm, `${v.start_km}`);
      iddia(`shift_edit_log ARTTI (${izOnceKm} → ${izSonraKm})`, izSonraKm > izOnceKm, `+${izSonraKm - izOnceKm}`);
      iddia("updated_by = yönetici", v.updated_by === wAdmin.data.id, `${v.updated_by}`);

      const { data: iz } = await supabaseAdmin
        .from("shift_edit_log")
        .select("field, old_value, new_value, reason, kaynak")
        .eq("time_entry_id", acikVardiyaId)
        .order("changed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      iddia("iz kaynağı 'km'", iz?.kaynak === "km", `${iz?.kaynak} · ${iz?.field}: ${iz?.old_value}→${iz?.new_value}`);

      // ── GERİ AL
      await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acikVardiyaId}`, {
            token: tAdmin,
            method: "PATCH",
            govde: { islem: "km", baslangicKm: kmOrijinal.start_km, bitisKm: kmOrijinal.end_km },
          }),
          params(acikVardiyaId)
        )
      );
      const { data: v2 } = await supabaseAdmin
        .from("time_entries")
        .select("start_km")
        .eq("id", acikVardiyaId)
        .maybeSingle();
      iddia(`🔴 start_km GERİ ALINDI (${kmOrijinal.start_km})`, v2.start_km === kmOrijinal.start_km, `${v2.start_km}`);

      // ══════════════════════════════════════════════════════════════════════
      baslik("6. KAPATMA — PATCH islem=kapat");
      const izOnceKap = await sayim("shift_edit_log");
      const rk = await cevap(
        await SHIFT_PATCH(
          istek(`/api/mobile/shifts/${acikVardiyaId}`, {
            token: tAdmin,
            method: "PATCH",
            govde: { islem: "kapat", sebep: "QA kanıt koşumu — hemen yeniden açılacak" },
          }),
          params(acikVardiyaId)
        )
      );
      const { data: vk } = await supabaseAdmin
        .from("time_entries")
        .select("ended_at, end_km, end_reason")
        .eq("id", acikVardiyaId)
        .maybeSingle();
      const izSonraKap = await sayim("shift_edit_log");

      iddia("kapat → 200", rk.kod === 200, `${rk.kod} ${rk.govde.error ?? ""}`);
      iddia("ended_at YAZILDI", vk.ended_at !== null, `${vk.ended_at}`);
      iddia("end_reason='admin'", vk.end_reason === "admin", `${vk.end_reason}`);
      iddia(`shift_edit_log ARTTI (${izOnceKap} → ${izSonraKap})`, izSonraKap > izOnceKap, `+${izSonraKap - izOnceKap}`);

      const { data: izk } = await supabaseAdmin
        .from("shift_edit_log")
        .select("reason, kaynak")
        .eq("time_entry_id", acikVardiyaId)
        .eq("kaynak", "kapatma")
        .limit(1)
        .maybeSingle();
      iddia("iz kaynağı 'kapatma' + sebep taşıyor", izk?.kaynak === "kapatma" && (izk?.reason ?? "").startsWith("QA kanıt"), `${izk?.reason}`);

      // ══════════════════════════════════════════════════════════════════════
      baslik("7. BAŞLATMA — kapanan vardiya YENİDEN AÇILIYOR");
      const vOnceY = await sayim("time_entries");
      const ry = await cevap(await START_POST(istek("/api/mobile/shifts/start", { token: await tokenAl(), govde: {} })));
      const vSonraY = await sayim("time_entries");
      const { data: vy } = await supabaseAdmin
        .from("time_entries")
        .select("id, ended_at, end_km, started_at, summary_notified_at")
        .eq("id", acikVardiyaId)
        .maybeSingle();

      iddia("başlatma → 200", ry.kod === 200, `${ry.kod} ${ry.govde.error ?? ""}`);
      if (SHIFT_PER_DAY === "one") {
        iddia("yenidenAcildi=true (yeni satır DEĞİL)", ry.govde.vardiya?.yenidenAcildi === true, `${ry.govde.vardiya?.yenidenAcildi}`);
        iddia(`time_entries SAYISI DEĞİŞMEDİ (${vOnceY} → ${vSonraY})`, vSonraY === vOnceY, null);
        iddia(`🔴 AÇIK VARDİYA GERİ GELDİ (ended_at null)`, vy?.ended_at === null, `${vy?.ended_at}`);
        iddia("başlangıç anı KORUNDU (şoför yolu started_at'e dokunmaz)", vy?.started_at === acik.started_at, `${vy?.started_at}`);
        iddia("kapanış artıkları temizlendi", vy?.end_km === null && vy?.summary_notified_at === null, null);
      } else {
        bilgi(`SHIFT_PER_DAY='${SHIFT_PER_DAY}' → yeni satır bekleniyor; ${vSonraY - vOnceY} satır eklendi`);
      }
    }
  } else {
    bilgi("açık vardiya yoktu — düzeltme/kapatma adımları ATLANDI");
  }
} finally {
  // ══════════════════════════════════════════════════════════════════════════
  baslik("8. GERİ ALMA DOĞRULAMASI (finally)");
  const w = await isci("pin_hash, token_version, must_change_pin");
  const pinTamam = w ? await bcrypt.compare(PIN_ASIL, w.pin_hash) : false;
  if (!pinTamam && w) {
    // Son çare: doğrudan yaz. Test hesabı PIN'siz bırakılamaz.
    const h = await bcrypt.hash(PIN_ASIL, 10);
    await supabaseAdmin.from("workers").update({ pin_hash: h, must_change_pin: false }).eq("phone", TEL);
    const w2 = await isci("pin_hash");
    iddia("🔴 PIN ACİL GERİ YAZILDI (uç yolu düşmüştü)", await bcrypt.compare(PIN_ASIL, w2.pin_hash), null);
  } else {
    iddia(`🔴 PIN SON HÂLİ = ${PIN_ASIL}`, pinTamam, null);
  }

  const { data: son } = await supabaseAdmin
    .from("time_entries")
    .select("id, ended_at")
    .eq("worker_id", w0?.id ?? "")
    .is("ended_at", null)
    .maybeSingle();
  iddia("vardiya AÇIK durumda bırakıldı (başlangıçtaki gibi)", !!son, son ? son.id : "açık vardiya YOK");

  console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ${"═".repeat(28)}`);
}
process.exit(dusen === 0 ? 0 : 1);
