#!/usr/bin/env node
/**
 * VARDİYA YENİDEN AÇMA — ÖLÜ KOLON ÇIKARILDIKTAN SONRA KANIT.
 *
 * `still_active_asked_at` sökülen watchdog'un damgasıydı; katman kalkınca
 * yazanı da okuyanı da kalmadı. İki yeniden-açma yükünden çıkarıldı
 * (app/actions/shift.ts: şoför yolu + yönetici/şef yolu).
 *
 * ── YÖNTEM: YÜK KAYNAKTAN OKUNUR, ELLE YAZILMAZ ───────────────────────────
 * Testin kendi payload'ını uydurması, "kodun gönderdiği şey" yerine "benim
 * sandığım şey"i ölçerdi. Bu yüzden `app/actions/shift.ts` PARSE EDİLİR ve
 * iki yeniden-açma nesnesinin ANAHTARLARI oradan çıkarılır; canlı denemede
 * o anahtar kümesi kullanılır. Kaynak değişirse test de değişir.
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * Geçici bir `is_test` personel + ona ait KAPANMIŞ bir vardiya açar, yeniden
 * açma yükünü uygular, sonra ikisini de siler. Gerçek şoföre/vardiyaya
 * DOKUNMAZ.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-reopen-payload.mjs
 */
import fs from "node:fs/promises";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna } from "@/lib/format";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);

const QA_AD = "ZZ QA Yeniden Acma";
const QA_TEL = "+43000000006";
let qaId = null;
let vardiyaId = null;

/** Kaynaktaki bir nesne literalinin ilk seviye anahtarlarını çıkarır. */
function anahtarlar(kaynak, baslangicDeseni) {
  const i = kaynak.indexOf(baslangicDeseni);
  if (i === -1) return null;
  const acilis = kaynak.indexOf("{", i);
  let d = 0, j = acilis;
  while (j < kaynak.length) {
    if (kaynak[j] === "{") d++;
    else if (kaynak[j] === "}") { d--; if (d === 0) break; }
    j++;
  }
  const govde = kaynak.slice(acilis + 1, j);
  return [...govde.matchAll(/^\s{4,}([a-z_]+)\s*:/gim)].map((m) => m[1]);
}

console.log(`\n╔══ VARDİYA YENİDEN AÇMA · ÖLÜ KOLON SONRASI KANIT ════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ── 1. KAYNAK: iki yükte de kolon var mı ─────────────────────────────────
  console.log("\n── 1. KAYNAK YÜKLERİ (app/actions/shift.ts) ──");
  const src = await fs.readFile("app/actions/shift.ts", "utf8");

  const soforYuk = anahtarlar(src, '.from("time_entries")\n      .update({\n        ended_at: null,');
  const yoneticiYuk = anahtarlar(src, "const reopenBase: Record<string, unknown> = {");

  iddia("şoför yolu yükü okundu", Array.isArray(soforYuk) && soforYuk.length > 5, `${soforYuk?.length} anahtar`);
  iddia("yönetici/şef yolu yükü okundu", Array.isArray(yoneticiYuk) && yoneticiYuk.length > 5, `${yoneticiYuk?.length} anahtar`);
  bilgi(`şoför yolu   : ${soforYuk?.join(", ")}`);
  bilgi(`yönetici yolu: ${yoneticiYuk?.join(", ")}`);

  for (const [ad, y] of [["şoför", soforYuk], ["yönetici/şef", yoneticiYuk]]) {
    iddia(`${ad} yükünde still_active_asked_at YOK`, !y.includes("still_active_asked_at"), null);
    iddia(`${ad} yükünde summary_notified_at KORUNDU`, y.includes("summary_notified_at"), null);
    iddia(`${ad} yükü vardiyayı AÇIYOR (ended_at null'a çekiliyor)`, y.includes("ended_at"), null);
  }
  iddia("kodda still_active_asked_at'e YAZAN kalmadı",
    !/still_active_asked_at\s*:/.test(src), null);

  // ── 2. HAZIRLIK: test personeli + KAPANMIŞ vardiya ───────────────────────
  console.log("\n── 2. CANLI DENEME ──");
  {
    const { data: eski } = await supabaseAdmin.from("workers").select("id").eq("name", QA_AD);
    for (const w of eski ?? []) {
      await supabaseAdmin.from("time_entries").delete().eq("worker_id", w.id);
      await supabaseAdmin.from("workers").delete().eq("id", w.id);
    }
  }
  const { data: qa, error: qaHata } = await supabaseAdmin
    .from("workers")
    .insert({
      name: QA_AD, phone: QA_TEL, pin_hash: "QA_GIRIS_KAPALI_gecersiz_hash",
      is_active: true, is_test: true, is_admin: false,
    })
    .select("id").maybeSingle();
  if (qaHata || !qa) { console.error("✗ QA personeli açılamadı:", qaHata?.message); process.exit(1); }
  qaId = qa.id;

  const { data: arac } = await supabaseAdmin
    .from("vehicles").select("id, plate").eq("is_test", true).limit(1).maybeSingle();

  const basladi = new Date(startOfTodayVienna().getTime() + 7 * 3600_000).toISOString();
  const bitti = new Date(startOfTodayVienna().getTime() + 15 * 3600_000).toISOString();
  const { data: v, error: vHata } = await supabaseAdmin
    .from("time_entries")
    .insert({
      worker_id: qaId, vehicle_id: arac?.id ?? null, plate: arac?.plate ?? null,
      started_at: basladi, ended_at: bitti, end_reason: "manual",
      summary_notified_at: bitti, undelivered_count: 3, start_km: 1000, end_km: 1120,
    })
    .select("id, ended_at, summary_notified_at, undelivered_count").maybeSingle();
  if (vHata || !v) { console.error("✗ test vardiyası açılamadı:", vHata?.message); process.exit(1); }
  vardiyaId = v.id;
  iddia("kapanmış test vardiyası hazır", v.ended_at !== null,
    `ended_at=${v.ended_at?.slice(11, 16)} summary=${v.summary_notified_at ? "dolu" : "null"} teslimEdilemeyen=${v.undelivered_count}`);

  // ── 3. YENİDEN AÇMA — kaynaktan çıkan anahtar kümesiyle ──────────────────
  const degerler = {
    ended_at: null, end_km: null, end_reason: null, auto_ended: false,
    summary_notified_at: null, summary_confirmed_at: null, summary_confirmed_by: null,
    undelivered_count: null, started_at: basladi,
    vehicle_id: arac?.id ?? null, plate: arac?.plate ?? null,
    updated_at: new Date().toISOString(), updated_by: qaId,
    started_by: qaId, start_source: "worker",
  };
  const yuk = Object.fromEntries(yoneticiYuk.filter((k) => k in degerler).map((k) => [k, degerler[k]]));
  bilgi(`uygulanan yük: ${Object.keys(yuk).join(", ")}`);

  const { error: acmaHata } = await supabaseAdmin
    .from("time_entries").update(yuk).eq("id", vardiyaId)
    .eq("worker_id", qaId).not("ended_at", "is", null);
  iddia("yeniden açma HATASIZ (42703 yok)", !acmaHata,
    acmaHata ? `${acmaHata.code} ${acmaHata.message}` : "hata yok");

  const { data: sonra } = await supabaseAdmin
    .from("time_entries")
    .select("id, ended_at, end_km, end_reason, auto_ended, summary_notified_at, undelivered_count, still_active_asked_at")
    .eq("id", vardiyaId).maybeSingle();
  iddia("vardiya AÇILDI (ended_at null)", sonra?.ended_at === null, `ended_at=${sonra?.ended_at ?? "null"}`);
  iddia("kapanış alanları temizlendi",
    sonra?.end_km === null && sonra?.end_reason === null && sonra?.auto_ended === false, null);
  iddia("özet damgası SIFIRLANDI (imza döngüsü yeniden işleyecek)",
    sonra?.summary_notified_at === null, `summary_notified_at=${sonra?.summary_notified_at ?? "null"}`);
  iddia("teslim edilemeyen sıfırlandı", sonra?.undelivered_count === null, null);
  bilgi(`still_active_asked_at şu an: ${sonra?.still_active_asked_at ?? "null"} (kolon HÂLÂ DB'de — DDL bekliyor)`);

  // ── 4. AÇIK VARDİYA KISITI ───────────────────────────────────────────────
  const { count: acik } = await supabaseAdmin
    .from("time_entries").select("id", { count: "exact", head: true })
    .eq("worker_id", qaId).is("ended_at", null);
  iddia("şoförün tam 1 AÇIK vardiyası var (uq_time_entries_one_open sağlam)", acik === 1, `${acik} açık`);
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
} finally {
  console.log("\n── 5. TEMİZLİK ──");
  if (qaId) {
    await supabaseAdmin.from("time_entries").delete().eq("worker_id", qaId);
    await supabaseAdmin.from("workers").delete().eq("id", qaId);
    const { data: kv } = await supabaseAdmin.from("time_entries").select("id").eq("worker_id", qaId);
    const { data: kw } = await supabaseAdmin.from("workers").select("id").ilike("name", "ZZ QA%");
    iddia("test vardiyası silindi", (kv ?? []).length === 0, `${(kv ?? []).length} satır`);
    iddia("test personeli silindi", (kw ?? []).length === 0, `${(kw ?? []).length} satır`);
    const { count } = await supabaseAdmin.from("workers").select("id", { count: "exact", head: true }).eq("is_test", true);
    bilgi(`is_test personel: ${count} (beklenen 1 — migration 028'in kalıcı hesabı)`);
  }
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
