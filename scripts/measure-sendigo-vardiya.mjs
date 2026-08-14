/**
 * SENDIGO ÖLÇÜM — "Sana atanmış araç yok" + günde tek vardiya.
 * UI-path proof: startShiftManualAction'ın (app/actions/shift.ts) çalıştırdığı
 * Supabase sorgularını BİREBİR tekrarlar. Yazma YOK, salt okuma.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envTxt = readFileSync(
  "C:/Users/90553/Desktop/business/hak-transport-takip/.env.sendigo",
  "utf8"
);
const env = {};
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// lib/format.ts startOfTodayVienna eşleniği
function startOfTodayVienna() {
  const now = new Date();
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  const viennaMidnightUtcGuess = new Date(
    Date.UTC(+g("year"), +g("month") - 1, +g("day"), 0, 0, 0)
  );
  // ofseti çöz
  const off = now.getTime() - Date.UTC(+g("year"), +g("month") - 1, +g("day"), +g("hour"), +g("minute"), +g("second"));
  return new Date(viennaMidnightUtcGuess.getTime() + off);
}
function viennaDay(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}
const B = (s) => `\n══ ${s} ${"═".repeat(Math.max(0, 68 - s.length))}`;

const gunBasi = startOfTodayVienna();
console.log(`Viyana gün başı (UTC): ${gunBasi.toISOString()}`);

// ── 1) Kadro ───────────────────────────────────────────────────────────────
console.log(B("1 · SENDIGO KADROSU"));
const { data: workers } = await db
  .from("workers")
  .select("id, name, is_active, is_admin, counts_as_driver, is_test, plate")
  .order("name");
const { data: vehicles } = await db
  .from("vehicles")
  .select("id, plate, status, assigned_worker_id, is_test");
console.log(`workers: ${workers.length}  |  vehicles: ${vehicles.length}`);
const atanmis = vehicles.filter((v) => v.assigned_worker_id);
console.log(`assigned_worker_id DOLU araç: ${atanmis.length}`);
for (const v of atanmis) {
  const w = workers.find((x) => x.id === v.assigned_worker_id);
  console.log(`   ${v.plate}  status=${v.status}  is_test=${v.is_test}  →  ${w?.name ?? "?"} (is_test=${w?.is_test})`);
}
for (const w of workers) {
  console.log(`   ${w.is_test ? "[TEST] " : ""}${w.name}  aktif=${w.is_active} admin=${w.is_admin} counts_as_driver=${w.counts_as_driver} workers.plate=${w.plate ?? "—"}`);
}

// ── 2) Can Özsavaş ─────────────────────────────────────────────────────────
console.log(B("2 · HEDEF ŞOFÖR"));
const can = workers.find((w) => /özsava|ozsava/i.test(w.name ?? ""));
if (!can) { console.log("BULUNAMADI"); process.exit(1); }
console.log(`${can.name}  id=${can.id}  aktif=${can.is_active}  admin=${can.is_admin}  is_test=${can.is_test}`);

// ── 3) UI-PATH: startShiftManualAction() argümansız — araç çözümü ──────────
// app/actions/shift.ts:144-153  (overrideVehicleId YOKKEN çalışan dal)
console.log(B("3 · UI-PATH · shift.ts:144-153 atanmış araç sorgusu"));
const { data: vehRow, error: vehErr } = await db
  .from("vehicles")
  .select("id, plate, status")
  .eq("assigned_worker_id", can.id)
  .neq("status", "inactive")
  .order("plate")
  .limit(1)
  .maybeSingle();
console.log(`sonuç: ${JSON.stringify(vehRow)}  hata=${vehErr?.message ?? "—"}`);
console.log(
  vehRow
    ? "→ araç bulundu, akış devam eder"
    : '→ data=null  ⇒  shift.ts:153 `return { ok:false, error:"no_vehicle" }`\n' +
      '   ⇒ PanelClient.tsx:467 mapErr("no_vehicle") = t("v2WaitNoVehicle")\n' +
      '   ⇒ "Sana atanmış araç yok. Yöneticinle görüş."  ✔ HATA BİREBİR ÜRETİLDİ'
);

// ── 4) UI-PATH: açık vardiya guard'ı + günde tek vardiya ──────────────────
console.log(B("4 · UI-PATH · shift.ts:166-172 açık vardiya + :197 hasShiftToday"));
const { data: acik } = await db
  .from("time_entries").select("id, started_at, plate")
  .eq("worker_id", can.id).is("ended_at", null).maybeSingle();
console.log(`açık vardiya: ${acik ? JSON.stringify(acik) : "YOK"}`);

const { data: bugunVar } = await db
  .from("time_entries").select("id")
  .eq("worker_id", can.id)
  .gte("started_at", gunBasi.toISOString())
  .limit(1).maybeSingle();
console.log(`hasShiftToday(): ${!!bugunVar}`);

const { data: sonKapali } = await db
  .from("time_entries").select("id, started_at, ended_at, plate, vehicle_id, start_km, end_km, break_minutes")
  .eq("worker_id", can.id)
  .gte("started_at", gunBasi.toISOString())
  .not("ended_at", "is", null)
  .order("ended_at", { ascending: false })
  .limit(1).maybeSingle();
console.log(`yeniden açılacak satır: ${JSON.stringify(sonKapali)}`);

// ── 5) Can'ın tüm vardiyaları ─────────────────────────────────────────────
console.log(B("5 · CAN'IN VARDİYA GEÇMİŞİ"));
const { data: canAll } = await db
  .from("time_entries")
  .select("id, started_at, ended_at, plate, vehicle_id, start_km, end_km, auto_started, start_source, started_by")
  .eq("worker_id", can.id).order("started_at", { ascending: false });
for (const e of canAll ?? []) {
  const dk = e.ended_at ? Math.round((new Date(e.ended_at) - new Date(e.started_at)) / 60000) : null;
  console.log(`   ${viennaDay(e.started_at)}  ${e.started_at.slice(11,16)}→${e.ended_at ? e.ended_at.slice(11,16) : "AÇIK"}  ${dk !== null ? dk + " dk" : ""}  plaka=${e.plate ?? "—"} vid=${e.vehicle_id ? "var" : "YOK"} auto=${e.auto_started} src=${e.start_source ?? "—"}`);
}

// ── 6) Tenant genelinde: günde tek vardiya kuralının bugünkü etkisi ───────
console.log(B("6 · TENANT · bugünkü vardiyalar"));
const { data: bugun } = await db
  .from("time_entries")
  .select("id, worker_id, started_at, ended_at, plate")
  .gte("started_at", gunBasi.toISOString())
  .order("started_at");
console.log(`bugün açılan vardiya satırı: ${bugun.length}`);
for (const e of bugun) {
  const w = workers.find((x) => x.id === e.worker_id);
  console.log(`   ${w?.name ?? e.worker_id}  ${e.started_at.slice(11,16)}→${e.ended_at ? e.ended_at.slice(11,16) : "AÇIK"}  ${e.plate ?? "—"}`);
}
const kapaliBugun = bugun.filter((e) => e.ended_at);
console.log(`bugün KAPANMIŞ (⇒ ikinci vardiya kilitli) şoför: ${new Set(kapaliBugun.map((e) => e.worker_id)).size}`);

// ── 7) Tarihsel: bir şoför-günde birden çok satır var mı? ─────────────────
console.log(B("7 · TARİHSEL · şoför-gün başına satır sayısı"));
const { data: hepsi } = await db
  .from("time_entries").select("worker_id, started_at, ended_at")
  .order("started_at", { ascending: false }).limit(2000);
const perDay = new Map();
for (const e of hepsi ?? []) {
  const k = `${e.worker_id}|${viennaDay(e.started_at)}`;
  perDay.set(k, (perDay.get(k) ?? 0) + 1);
}
const coklu = [...perDay.entries()].filter(([, n]) => n > 1);
console.log(`toplam satır (son 2000): ${hepsi?.length}  |  şoför-gün: ${perDay.size}  |  1'den fazla satırlı şoför-gün: ${coklu.length}`);
for (const [k, n] of coklu.slice(0, 20)) {
  const [wid, d] = k.split("|");
  console.log(`   ${workers.find((x) => x.id === wid)?.name ?? wid}  ${d}  → ${n} satır`);
}

// ── 8) Şema: kural DB'de mi? ─────────────────────────────────────────────
console.log(B("8 · time_entries kolonları (yeniden açma yolunda yazılanlar)"));
const { data: ornek } = await db.from("time_entries").select("*").limit(1).maybeSingle();
console.log(Object.keys(ornek ?? {}).join(", "));
