#!/usr/bin/env node
/**
 * PERSONEL HESABI ÇEKİRDEĞİ — CANLIDA KANIT (lib/worker-account-db.ts).
 *
 * NE İSPATLAR: PIN atama ve pasifleştirme mantığı tek yere indi ve PANELİN
 * DAVRANIŞI DEĞİŞMEDİ.
 *
 * ── PANEL YOLU NASIL ÖLÇÜLÜYOR ────────────────────────────────────────────
 * `toggleActiveAction` / `setWorkerPinAction` düz Node'dan ÇAĞRILAMAZ: ilk
 * satırları `requireAdmin()` ve o kapı çerezsiz istekte `redirect()` fırlatır.
 * Bu yüzden panelin yolu İKİ parçada ölçülüyor:
 *   1. MANTIK — action'ın artık çağırdığı çekirdek, action'ın eski adımlarının
 *      birebir aynısını yapıyor mu (bu betik, canlı test hesabında).
 *   2. EŞLEME — action'ın kullanıcıya dönen dört hata metni korundu mu
 *      (kaynak üzerinde statik denetim, aşağıda).
 * Panelin SAYFA katmanı ayrıca üretim sunucusunda (next start + mühürlü çerez)
 * ölçülüyor — bkz. rapor.
 *
 * ── ⚠️ YALNIZ is_test HESABI ──────────────────────────────────────────────
 * Hiçbir gerçek kişiye dokunulmaz. Koşum başındaki değerler alınır, `finally`
 * içinde geri yazılır ve geri yazmanın TUTTUĞU ölçülür.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-worker-account-core.mjs
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { setWorkerPin, setWorkerActive } from "@/lib/worker-account-db";

const GECICI_PIN = "418302";
let dusen = 0;
let olculmeyen = 0;
let testId = null;
let bas = null;

const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const olculmedi = (b, s) => {
  console.log(`  ○ ${b}  —  ÖLÇÜLMEDİ (${s})`);
  olculmeyen++;
};
const oku = async (alanlar) =>
  (await supabaseAdmin.from("workers").select(alanlar).eq("id", testId).maybeSingle()).data;

console.log(`\n╔══ PERSONEL HESABI ÇEKİRDEĞİ · CANLIDA KANIT ══════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ══ 0. EŞLEME — panelin hata metinleri korundu mu (statik) ══════════════
  console.log(`\n── 0. PANEL HATA METİNLERİ (app/actions/workers.ts kaynağı) ──`);
  {
    const src = readFileSync("app/actions/workers.ts", "utf8");
    const bekle = [
      ['owner_protected → "Çalışan bulunamadı"', 'r.sebep === "owner_protected"', '"Çalışan bulunamadı"'],
      ['invalid_pin → zod anahtarı ("errPin")', 'r.sebep === "invalid_pin"', 'r.pinKod ?? "errPin"'],
      ['not_found → "notFound"', 'r.sebep === "not_found"', '"notFound"'],
      ['yazma hatası → "pinUpdateFailed"', "pinUpdateFailed", '"pinUpdateFailed"'],
      ['aktiflik yazma hatası → "Güncelleme başarısız"', "Güncelleme başarısız", '"Güncelleme başarısız"'],
    ];
    for (const [ad, ...parcalar] of bekle) {
      iddia(`metin korundu · ${ad}`, parcalar.every((p) => src.includes(p)));
    }
    // Tek kaynak gerçekten tek mi: action artık bu iki akış için KENDİ yazmasını
    // yapmamalı. `pin_hash` ve `is_active` güncellemesi kaynakta kalmamalı.
    iddia(
      "action artık pin_hash YAZMIYOR (tek kaynak çekirdek)",
      !/update\(\s*\{\s*pin_hash/.test(src),
      "app/actions/workers.ts"
    );
    iddia(
      "action artık is_active patch'i KURMUYOR (tek kaynak çekirdek)",
      !/is_active:\s*nextActive/.test(src),
      "app/actions/workers.ts"
    );
    iddia(
      "action HÂLÂ requireAdmin kapısını çalıştırıyor (kapı taşınmadı)",
      (src.match(/await requireAdmin\(\)/g) ?? []).length >= 2
    );
  }

  // ── Hazırlık ────────────────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, name").eq("is_admin", true).eq("is_active", true)
    .order("name").limit(1).maybeSingle();
  const { data: test } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_active, terminated_at, must_change_pin, pin_hash, token_version")
    .eq("is_test", true).limit(1).maybeSingle();
  if (!patron) { console.error("✗ yönetici yok"); process.exit(1); }
  if (!test) {
    olculmedi("çekirdek mutlu yolu", "is_test hesabı yok (migration 028)");
  } else {
    testId = test.id;
    bas = {
      is_active: test.is_active,
      terminated_at: test.terminated_at ?? null,
      must_change_pin: test.must_change_pin,
      pin_hash: test.pin_hash,
    };
    console.log(`║ patron ${patron.name.slice(0, 3)}*** · test ${test.name.slice(0, 3)}*** (aktif=${test.is_active})`);

    // ══ 1. PANEL YOLU — setWorkerActive(…, "toggle") ═════════════════════
    console.log(`\n── 1. PANEL YOLU: "toggle" (aç-kapa düğmesinin davranışı) ──`);
    const tv0 = (await oku("token_version")).token_version ?? 0;
    const t1 = await setWorkerActive(patron.id, testId, "toggle");
    const s1 = await oku("is_active, terminated_at, token_version");
    iddia(
      `toggle #1 · ${bas.is_active} → ${!bas.is_active}`,
      t1.ok && t1.degisti === true && s1.is_active === !bas.is_active,
      `degisti=${t1.degisti} aktif=${s1.is_active}`
    );
    iddia(
      "⚠️ pasife alırken terminated_at DEĞİŞMEDİ",
      (s1.terminated_at ?? null) === bas.terminated_at,
      `${bas.terminated_at ?? "null"} → ${s1.terminated_at ?? "null"}`
    );
    iddia("token_version arttı", (s1.token_version ?? 0) > tv0, `${tv0} → ${s1.token_version}`);

    const t2 = await setWorkerActive(patron.id, testId, "toggle");
    const s2 = await oku("is_active, terminated_at");
    iddia(
      `toggle #2 · geri döndü (${bas.is_active})`,
      t2.ok && t2.degisti === true && s2.is_active === bas.is_active,
      `aktif=${s2.is_active}`
    );
    iddia(
      "geri açmada terminated_at TEMİZLENDİ (hayalet durum önlendi)",
      (s2.terminated_at ?? null) === null,
      `terminated_at=${s2.terminated_at ?? "null"}`
    );
    iddia(
      '"toggle" ASLA degisti:false döndürmez (panelin yolu no-op dalına girmez)',
      t1.degisti === true && t2.degisti === true
    );

    // ══ 2. MOBİL YOLU — açık değer, idempotent ═══════════════════════════
    console.log(`\n── 2. MOBİL YOLU: açık boolean (idempotent) ──`);
    const m1 = await setWorkerActive(patron.id, testId, bas.is_active);
    iddia(
      "zaten hedef durumda → degisti:false, yazma YOK",
      m1.ok && m1.degisti === false && m1.tokenIptal === false,
      `degisti=${m1.degisti} tokenIptal=${m1.tokenIptal}`
    );
    const tvA = (await oku("token_version")).token_version ?? 0;
    await setWorkerActive(patron.id, testId, bas.is_active);
    const tvB = (await oku("token_version")).token_version ?? 0;
    iddia("no-op token_version'ı ARTIRMIYOR", tvA === tvB, `${tvA} = ${tvB}`);

    // ══ 3. PIN — aynı şema, aynı sıra ════════════════════════════════════
    console.log(`\n── 3. PIN ÇEKİRDEĞİ ──`);
    const r1 = await setWorkerPin(patron.id, testId, "12345", true);
    iddia("5 hane → invalid_pin/errPin", !r1.ok && r1.sebep === "invalid_pin" && r1.pinKod === "errPin", `${r1.sebep}/${r1.pinKod}`);
    const r2 = await setWorkerPin(patron.id, testId, "111111", true);
    iddia("111111 → invalid_pin/errPinWeak", !r2.ok && r2.sebep === "invalid_pin" && r2.pinKod === "errPinWeak", `${r2.sebep}/${r2.pinKod}`);
    const r3 = await setWorkerPin(patron.id, "00000000-0000-4000-8000-000000000000", GECICI_PIN, true);
    iddia("kimlik yok → not_found", !r3.ok && r3.sebep === "not_found", String(r3.sebep));
    const kirliOnce = await oku("pin_hash");
    iddia("reddedilen denemeler pin_hash'e DOKUNMADI", kirliOnce.pin_hash === bas.pin_hash);

    const r4 = await setWorkerPin(patron.id, testId, GECICI_PIN, false);
    const h4 = await oku("pin_hash, must_change_pin");
    iddia("geçerli PIN → ok", r4.ok === true, `tokenIptal=${r4.tokenIptal}`);
    iddia("pin_hash değişti", h4.pin_hash !== bas.pin_hash);
    iddia("bcrypt.compare doğruluyor", await bcrypt.compare(GECICI_PIN, h4.pin_hash ?? ""));
    iddia("must_change_pin argümandan geldi (false)", h4.must_change_pin === false);
    iddia("dönüşte PIN YOK", !JSON.stringify(r4).includes(GECICI_PIN), JSON.stringify(r4));
  }
} catch (e) {
  console.error("\n✗ BEKLENMEYEN HATA:", e?.message ?? e);
  if (e?.stack) console.error(e.stack.split("\n").slice(1, 5).join("\n"));
  dusen++;
} finally {
  if (testId && bas) {
    console.log(`\n── GERİ ALMA ──`);
    await supabaseAdmin.from("workers").update({
      is_active: bas.is_active,
      terminated_at: bas.terminated_at,
      must_change_pin: bas.must_change_pin,
      pin_hash: bas.pin_hash,
    }).eq("id", testId);
    const son = await oku("is_active, terminated_at, must_change_pin, pin_hash");
    iddia(
      "test hesabı koşum ÖNCESİ hâline döndü (4 alan)",
      son.is_active === bas.is_active &&
        (son.terminated_at ?? null) === bas.terminated_at &&
        son.must_change_pin === bas.must_change_pin &&
        son.pin_hash === bas.pin_hash,
      `aktif=${son.is_active} mustChange=${son.must_change_pin} hash=${son.pin_hash === bas.pin_hash ? "aynı" : "FARKLI"}`
    );
  }
  console.log(`\n╚══ SONUÇ: ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`}` +
    `${olculmeyen ? ` · ${olculmeyen} ölçülemedi` : ""} ═══\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
