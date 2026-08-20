#!/usr/bin/env node
/**
 * TELEGRAM SÖKÜMÜ — CANLIDA KANIT.
 *
 * Sökümün kritik riski şuydu: `WORKER_PUBLIC_COLUMNS` (lib/types.ts) dört
 * Telegram kolonunu seçiyordu ve o sabiti ALTI yüzey kullanıyor — yönetici
 * panosu, personel listesi/detayı, performans raporu, iki mobil uç. Kolonlar
 * DB'den düşünce bu sabit onları hâlâ isteseydi PostgREST 42703 döner ve o
 * altı yüzey birden kırılırdı.
 *
 * Bu betik SÖKÜM SONRASI kodun, Telegram kolonları OLMADAN da:
 *   1. PIN girişini (üretim çekirdeği `verifyCredentials` + mobil login ucu),
 *   2. `WORKER_PUBLIC_COLUMNS` okuyan altı yüzeyin sorgusunu,
 *   3. Panelin ana akışlarını (vardiya, paket, arıza) besleyen okumaları
 * yaptığını ölçer.
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * Geçici bir `is_test` personel açar (bilinen PIN, bcrypt), giriş dener ve
 * SONUNDA SİLER. Gerçek şoförle giriş DENENMEZ — yanlış PIN sayacı gerçek
 * bir hesabı kilitleyebilirdi ([[giris-kilidi]]: eşik 10).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-telegram-sokum.mjs
 */
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyCredentials } from "@/lib/auth-core";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { POST as MOBIL_LOGIN } from "@/app/api/mobile/auth/login/route";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);

const QA_AD = "ZZ QA Giris Testi";
const QA_TEL = "+43000000002";
const QA_PIN = "471903";
let qaId = null;

console.log(`\n╔══ TELEGRAM SÖKÜMÜ · CANLIDA KANIT ══════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ── 0. TEMİZ BAŞLANGIÇ + geçici hesap ────────────────────────────────────
  {
    const { data: eski } = await supabaseAdmin.from("workers").select("id").eq("name", QA_AD);
    for (const w of eski ?? []) await supabaseAdmin.from("workers").delete().eq("id", w.id);
    if ((eski ?? []).length) bilgi(`önceki koşumdan ${eski.length} satır temizlendi`);
  }
  const { data: qa, error: qaHata } = await supabaseAdmin
    .from("workers")
    .insert({
      name: QA_AD,
      phone: QA_TEL,
      pin_hash: await bcrypt.hash(QA_PIN, 10),
      is_active: true,
      is_test: true,
      is_admin: false,
      must_change_pin: false,
    })
    .select("id, name, is_active")
    .maybeSingle();
  if (qaHata || !qa) { console.error("✗ QA hesabı açılamadı:", qaHata?.message); process.exit(1); }
  qaId = qa.id;
  console.log(`║ geçici hesap ${QA_AD} (is_test, PIN biliniyor)\n`);

  // ── 1. ŞEMA: kolonlar hâlâ DB'de mi (DDL henüz koşmadı) ──────────────────
  console.log("── 1. ŞEMA DURUMU ──");
  {
    const { error } = await supabaseAdmin.from("workers").select("telegram_chat_id").limit(1);
    bilgi(`workers.telegram_chat_id şu an DB'de: ${error ? "HAYIR (" + error.code + ")" : "EVET — DDL henüz çalıştırılmadı"}`);
    iddia("WORKER_PUBLIC_COLUMNS artık telegram_ kolonu İSTEMİYOR",
      !WORKER_PUBLIC_COLUMNS.includes("telegram"),
      `${WORKER_PUBLIC_COLUMNS.split(",").length} kolon seçiliyor`);
  }

  // ── 2. PIN GİRİŞİ · üretim çekirdeği ─────────────────────────────────────
  console.log("\n── 2. PIN GİRİŞİ (lib/auth-core · verifyCredentials) ──");
  {
    const ok = await verifyCredentials({ phone: QA_TEL, pin: QA_PIN, ip: "127.0.0.1" });
    iddia("doğru PIN → giriş BAŞARILI", ok.ok === true,
      ok.ok ? `worker=${ok.worker.name} admin=${ok.worker.is_admin}` : `reddedildi: ${ok.reason ?? JSON.stringify(ok)}`);
    if (ok.ok) {
      iddia("dönen kayıtta telegram alanı YOK",
        !Object.keys(ok.worker).some((k) => k.includes("telegram")),
        Object.keys(ok.worker).join(","));
    }
    const yanlis = await verifyCredentials({ phone: QA_TEL, pin: "000000", ip: "127.0.0.1" });
    iddia("yanlış PIN → REDDEDİLDİ", yanlis.ok !== true, `sonuç=${yanlis.ok}`);
    const yok = await verifyCredentials({ phone: "+43999999999", pin: QA_PIN, ip: "127.0.0.1" });
    iddia("bilinmeyen telefon → REDDEDİLDİ", yok.ok !== true, `sonuç=${yok.ok}`);
  }

  // ── 3. PIN GİRİŞİ · mobil uç (gerçek işleyici) ───────────────────────────
  console.log("\n── 3. PIN GİRİŞİ (POST /api/mobile/auth/login) ──");
  {
    const cagir = async (govde) => {
      const res = await MOBIL_LOGIN(
        new Request("http://x/api/mobile/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(govde),
        })
      );
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const a = await cagir({ phone: QA_TEL, pin: QA_PIN });
    iddia("doğru PIN → 200 + token", a.status === 200 && !!a.json?.accessToken,
      `${a.status} token=${a.json?.accessToken ? a.json.accessToken.length + " bayt" : "yok"}`);
    iddia("yanıt gövdesinde telegram alanı YOK",
      !JSON.stringify(a.json ?? {}).toLowerCase().includes("telegram"), null);
    const b = await cagir({ phone: QA_TEL, pin: "000000" });
    iddia("yanlış PIN → 401", b.status === 401, `${b.status} ${b.json?.error}`);
  }

  // ── 4. WORKER_PUBLIC_COLUMNS okuyan ALTI YÜZEY ───────────────────────────
  console.log("\n── 4. WORKER_PUBLIC_COLUMNS · altı yüzeyin sorgusu ──");
  {
    const { data, error, count } = await supabaseAdmin
      .from("workers")
      .select(WORKER_PUBLIC_COLUMNS, { count: "exact" })
      .order("name");
    iddia("sabit sorgusu HATASIZ çalışıyor", !error, error ? `${error.code} ${error.message}` : `${count} personel`);
    iddia("dönen satırlarda telegram alanı YOK",
      !!data && !Object.keys(data[0] ?? {}).some((k) => k.includes("telegram")),
      Object.keys(data?.[0] ?? {}).length + " alan");
    iddia("pin_hash SIZMIYOR (sabitin asıl işi)",
      !!data && !("pin_hash" in (data[0] ?? {})), null);
  }

  // ── 5. PANELİN ANA AKIŞLARI · besleyen okumalar ──────────────────────────
  console.log("\n── 5. ANA AKIŞLAR ──");
  {
    const olc = async (ad, sorgu) => {
      const { error, count } = await sorgu;
      iddia(ad, !error, error ? `${error.code} ${error.message}` : `${count} satır`);
    };
    await olc("vardiya (time_entries)",
      supabaseAdmin.from("time_entries").select("id, worker_id, started_at, ended_at, cargo_count", { count: "exact", head: true }));
    await olc("paket girişi (shift_packages)",
      supabaseAdmin.from("shift_packages").select("id", { count: "exact", head: true }));
    await olc("arıza bildirimi (driver_reports)",
      supabaseAdmin.from("driver_reports").select("id", { count: "exact", head: true }));
    await olc("araçlar (vehicles)",
      supabaseAdmin.from("vehicles").select("id, plate, assigned_worker_id", { count: "exact", head: true }));
    // Söküm sonrası ölü kalmaması gereken damga: özet/imza döngüsü
    const { error: e2, count: c2 } = await supabaseAdmin
      .from("time_entries").select("id", { count: "exact", head: true })
      .not("summary_notified_at", "is", null);
    iddia("summary_notified_at KORUNDU (özet/imza döngüsü)", !e2, e2 ? e2.code : `${c2} vardiyada dolu`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
} finally {
  console.log("\n── 6. TEMİZLİK ──");
  if (qaId) {
    await supabaseAdmin.from("workers").delete().eq("id", qaId);
    const { data: kalan } = await supabaseAdmin.from("workers").select("id, name").ilike("name", "ZZ QA%");
    iddia("geçici giriş hesabı silindi", (kalan ?? []).length === 0, `${(kalan ?? []).length} satır`);
    const { count } = await supabaseAdmin.from("workers").select("id", { count: "exact", head: true }).eq("is_test", true);
    bilgi(`is_test personel: ${count} (beklenen 1 — migration 028'in kalıcı hesabı)`);
  }
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
