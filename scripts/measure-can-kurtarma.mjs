/**
 * ÖLÇÜM — Can Özsavaş'ın ezilen 14.08 sabah vardiyasının km'leri.
 * Salt okuma. Kaynak: device_telemetry odometresi (lib/auto-shift.ts
 * resolveStartKm/resolveEndKm ile AYNI alan: odometer_km).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const KOK = "C:/Users/90553/Desktop/business/hak-transport-takip";
const o = {};
for (const l of readFileSync(`${KOK}/.env.sendigo`, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(l.trim());
  if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = createClient(o.NEXT_PUBLIC_SUPABASE_URL, o.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const TZ = "Europe/Vienna";
const vt = (iso) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "medium" })
    .format(new Date(iso));
const B = (s) => `\n${"═".repeat(72)}\n  ${s}\n${"═".repeat(72)}`;

const CAN = "dbf30980-185c-43c0-b2dc-872a8806e5da";
const SATIR = "9f7f25ea-a3af-4cb2-9163-b54f3b55ab85";

// ── 1) Mevcut satır ────────────────────────────────────────────────────────
console.log(B("1 · EZİLEN SATIRIN ŞU ANKİ HÂLİ"));
const { data: row } = await c.from("time_entries").select("*").eq("id", SATIR).maybeSingle();
console.log(
  `  id=${row.id}\n  created_at   ${vt(row.created_at)}  ← sabahki vardiyanın doğuş anı\n` +
    `  started_at   ${vt(row.started_at)}\n  ended_at     ${row.ended_at ? vt(row.ended_at) : "AÇIK"}\n` +
    `  start_km     ${row.start_km}\n  end_km       ${row.end_km}\n  plate        ${row.plate}\n` +
    `  vehicle_id   ${row.vehicle_id}\n  notes        ${JSON.stringify(row.notes)}\n` +
    `  updated_by   ${row.updated_by}  start_source=${row.start_source}`
);
const VEH = row.vehicle_id;

// ── 2) Aracın 14.08 telemetri odometresi ───────────────────────────────────
console.log(B("2 · DO-MDC1 ODOMETRE (14.08, Viyana)"));
const gunBasi = "2026-08-13T22:00:00Z"; // 14.08 00:00 Viyana (UTC+2)
const { data: tel } = await c
  .from("device_telemetry")
  .select("recorded_at, odometer_km, speed_kph, ignition")
  .eq("vehicle_id", VEH)
  .gte("recorded_at", gunBasi)
  .not("odometer_km", "is", null)
  .order("recorded_at")
  .limit(20000);
console.log(`  odometreli kayıt: ${tel?.length ?? 0}`);
if (!tel?.length) {
  console.log("  ⚠️ ODOMETRE OKUMASI YOK — km telemetriden çözülemez.");
}

/** Verilen ISO penceresinde ilk/son odometre. */
function pencere(ad, bas, bit) {
  const icinde = (tel ?? []).filter((r) => r.recorded_at >= bas && r.recorded_at <= bit);
  console.log(`\n  ── ${ad}  (${vt(bas)} → ${vt(bit)}) ──`);
  if (!icinde.length) {
    console.log("     bu pencerede odometre okuması YOK");
    return null;
  }
  const ilk = icinde[0], son = icinde[icinde.length - 1];
  console.log(`     kayıt   : ${icinde.length}`);
  console.log(`     İLK     : ${vt(ilk.recorded_at)}  odo=${ilk.odometer_km}`);
  console.log(`     SON     : ${vt(son.recorded_at)}  odo=${son.odometer_km}`);
  console.log(`     mesafe  : ${(son.odometer_km - ilk.odometer_km).toFixed(1)} km`);
  return { ilk, son, n: icinde.length };
}

// 07:10 → 09:28 Viyana = 05:10 → 07:28 UTC
const sabah = pencere("SABAH VARDİYASI 07:10→09:28", "2026-08-14T05:10:00Z", "2026-08-14T07:28:30Z");
// 09:28 → 20:00 Viyana arası boşluk (araç kimde?)
const bosluk = pencere("ARADAKİ BOŞLUK 09:28→20:00", "2026-08-14T07:28:30Z", "2026-08-14T18:00:00Z");
// 20:00 → şimdi
pencere("AKŞAM VARDİYASI 20:00→şimdi", "2026-08-14T18:00:00Z", new Date().toISOString());

// ── 3) Referans: satırdaki start_km ile telemetri uyuşuyor mu? ─────────────
console.log(B("3 · start_km=289209 DOĞRU MU?"));
if (sabah) {
  console.log(`  telemetri 07:10 civarı odo : ${sabah.ilk.odometer_km}`);
  console.log(`  satırdaki start_km          : ${row.start_km}`);
  console.log(`  fark                        : ${(row.start_km - sabah.ilk.odometer_km).toFixed(1)} km`);
}

// ── 4) Aynı araç başka bir vardiyada mı? (boşlukta kim kullandı) ───────────
console.log(B("4 · DO-MDC1'İ 14.08'DE KULLANAN VARDİYALAR"));
const { data: ayniArac } = await c
  .from("time_entries")
  .select("id, worker_id, started_at, ended_at, start_km, end_km")
  .eq("vehicle_id", VEH)
  .gte("started_at", "2026-08-12T00:00:00Z")
  .order("started_at");
const { data: ws } = await c.from("workers").select("id, name");
for (const e of ayniArac ?? []) {
  console.log(
    `  ${(ws.find((w) => w.id === e.worker_id)?.name ?? "—").padEnd(16)} ` +
      `${vt(e.started_at)} → ${e.ended_at ? vt(e.ended_at) : "AÇIK"}  km ${e.start_km}→${e.end_km}`
  );
}

// ── 5) shift_edit_log şeması var mı? ───────────────────────────────────────
console.log(B("5 · shift_edit_log"));
const { data: log, error: logErr } = await c.from("shift_edit_log").select("*").limit(1);
console.log(logErr ? `  ⚠️ ${logErr.message}` : `  kolonlar: ${Object.keys(log?.[0] ?? {}).join(", ") || "(tablo boş)"}`);
const { count } = await c.from("shift_edit_log").select("*", { count: "exact", head: true });
console.log(`  satır sayısı: ${count ?? "—"}`);

// ── 6) Yönetici kimliği (updated_by) ───────────────────────────────────────
console.log(B("6 · YENİDEN AÇAN YÖNETİCİ"));
const { data: adm } = await c.from("workers").select("id, name, is_admin").eq("id", row.updated_by).maybeSingle();
console.log(`  ${adm?.name ?? "?"}  id=${row.updated_by}  is_admin=${adm?.is_admin}`);
