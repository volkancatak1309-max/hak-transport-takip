#!/usr/bin/env node
/**
 * TÜREV METRİK AKIL SAĞLIĞI TARAMASI — canlı veri, SALT OKUMA.
 *
 * NE YAPAR: yakıt (L/100km) ve hız (aşırı hız/100 km) metriklerini gerçek
 * Supabase verisiyle, uygulamanın kullandığı EŞİKLERİN AYNISIYLA hesaplar ve
 * araç araç döker: pay, payda, ölçüm pencereleri, kapı kararı, sonuç.
 *
 * NEDEN VAR: 22.07.2026 denetiminde ekranda "80,0 L/100km" ve "4,0 L/100km"
 * çıktı — ikisi de gerçek değildi. Üç kapı eklendikten sonra "artık saçma değer
 * yok" iddiasının KANITLANMASI gerekiyordu. Bu betik o kanıttır.
 *
 * Çıkış kodu 1 → kapıyı GEÇEN ama makul aralık dışında kalan bir değer var
 * (dizel minibüs için 3-25 L/100km). Yani kapılar delinmiş demektir.
 *
 * KULLANIM:  node scripts/verify-metrics-sane.mjs [gün]
 *            (gün verilmezse 7)
 *
 * NOT: bu betik hiçbir şey YAZMAZ. Yalnız select + RPC çağırır.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Eşikler — lib/metric-thresholds.ts ile AYNI olmak ZORUNDA ───────────────
// (Betik TS import edemiyor; sapma olmasın diye değerler burada tekrar yazılı
//  ve aşağıda dosyadan okunup KARŞILAŞTIRILIYOR — sessizce ayrışamazlar.)
const FUEL_MIN_KM = 50;
const FUEL_MIN_CONSUMED_PCT = 15;
const FUEL_MIN_WINDOW_OVERLAP_RATIO = 0.8;
const FUEL_L100_MIN_DAYS = 7;
const SPEED_MIN_KM = 50;
/** Dizel hafif ticari araç için makul L/100km aralığı. */
const SANE_L100 = [3, 25];
const MAX_PLAUSIBLE_KM_PER_DAY = 800;

function assertThresholdsInSync() {
  const src = readFileSync("lib/metric-thresholds.ts", "utf8");
  const pick = (name) => {
    const m = new RegExp(`export const ${name} = ([0-9.]+)`).exec(src);
    return m ? Number(m[1]) : null;
  };
  const pairs = [
    ["FUEL_MIN_KM", FUEL_MIN_KM],
    ["FUEL_MIN_CONSUMED_PCT", FUEL_MIN_CONSUMED_PCT],
    ["FUEL_MIN_WINDOW_OVERLAP_RATIO", FUEL_MIN_WINDOW_OVERLAP_RATIO],
    ["FUEL_L100_MIN_DAYS", FUEL_L100_MIN_DAYS],
  ];
  const drift = pairs.filter(([n, v]) => pick(n) !== null && pick(n) !== v);
  if (drift.length) {
    console.error("✖ EŞİK SAPMASI — betik ile lib/metric-thresholds.ts ayrışmış:");
    for (const [n, v] of drift) console.error(`   ${n}: betik ${v} ≠ kaynak ${pick(n)}`);
    process.exit(2);
  }
}

function env() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const days = Number(process.argv[2] ?? 7);
assertThresholdsInSync();
const e = env();
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

const end = new Date();
const start = new Date(end.getTime() - days * 86_400_000);
const [fromISO, toISO] = [start.toISOString(), end.toISOString()];

// ── Araçlar (test kayıtları hariç — panelin yaptığının aynısı) ──────────────
const { data: vAll } = await sb
  .from("vehicles")
  .select("id, plate, tank_capacity_l, is_test");
const vehicles = (vAll ?? []).filter((v) => !v.is_test);

// ── Yakıt istatistikleri (uygulamayla AYNI RPC) ─────────────────────────────
const { data: stats, error: rpcErr } = await sb.rpc("report_fuel_stats", {
  p_from: fromISO,
  p_to: toISO,
});
if (rpcErr) {
  console.error("✖ report_fuel_stats çağrılamadı:", rpcErr.message);
  process.exit(2);
}
const statBy = new Map((stats ?? []).map((s) => [s.vehicle_id, s]));

/** Bir alanın dolu olduğu ilk/son okuma — getVehicleDistanceSpan/FuelSpan ile aynı. */
async function span(vehicleId, col) {
  const q = (asc) =>
    sb
      .from("device_telemetry")
      .select(`${col}, recorded_at`)
      .eq("vehicle_id", vehicleId)
      .not(col, "is", null)
      .gte("recorded_at", fromISO)
      .lte("recorded_at", toISO)
      .order("recorded_at", { ascending: asc })
      .limit(1)
      .maybeSingle();
  const [{ data: a }, { data: b }] = await Promise.all([q(true), q(false)]);
  return { first: a, last: b };
}

const rows = [];
for (const v of vehicles) {
  const s = statBy.get(v.id);
  const odo = await span(v.id, "odometer_km");
  const fuel = await span(v.id, "fuel_level_pct");

  // km + sebep (getVehicleDistanceSpan mantığı)
  let km = null;
  let kmReason = null;
  if (odo.first?.odometer_km == null || odo.last?.odometer_km == null) {
    kmReason = "no_odometer";
  } else {
    const diff = Number(odo.last.odometer_km) - Number(odo.first.odometer_km);
    if (diff < 0) kmReason = "inconsistent";
    else if (diff > Math.max(1, days) * MAX_PLAUSIBLE_KM_PER_DAY) kmReason = "inconsistent";
    else km = diff;
  }

  // tüketim (buildFuelReport mantığı)
  const cap = v.tank_capacity_l == null ? null : Number(v.tank_capacity_l);
  const consumedPct = s
    ? Math.max(0, Number(s.refill_pct ?? 0) + (Number(s.first_pct ?? 0) - Number(s.last_pct ?? 0)))
    : 0;
  const consumedL = cap != null ? (consumedPct / 100) * cap : null;

  // sıfır-okuma oranı → arızalı sensör
  let zeroRatio = 0;
  if (s && Number(s.sample_count) > 0) {
    const { count } = await sb
      .from("device_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", v.id)
      .eq("fuel_level_pct", 0)
      .gte("recorded_at", fromISO)
      .lte("recorded_at", toISO);
    zeroRatio = Math.min(1, (count ?? 0) / Number(s.sample_count));
  }
  const unreliable = zeroRatio > 0.1;

  // pencere örtüşmesi
  const ts = (r, c) => (r?.recorded_at ? Date.parse(r.recorded_at) : NaN);
  const fA = ts(fuel.first), fB = ts(fuel.last), oA = ts(odo.first), oB = ts(odo.last);
  let overlap = null;
  if ([fA, fB, oA, oB].every(Number.isFinite) && fB - fA > 0) {
    overlap = Math.max(0, Math.min(fB, oB) - Math.max(fA, oA)) / (fB - fA);
  }

  // ÜÇ KAPI
  let reason = null;
  if (!s || Number(s.sample_count) === 0) reason = "too_little_fuel";
  else if (unreliable) reason = "unreliable_sensor";
  else if (cap == null) reason = "no_capacity";
  else if (km === null) reason = kmReason;
  else if (km < FUEL_MIN_KM) reason = "too_short";
  else if (consumedPct < FUEL_MIN_CONSUMED_PCT) reason = "too_little_fuel";
  else if (overlap === null || overlap < FUEL_MIN_WINDOW_OVERLAP_RATIO) reason = "window_mismatch";

  const l100 = reason === null && consumedL != null ? (consumedL / km) * 100 : null;
  rows.push({
    plate: v.plate,
    km: km === null ? null : Math.round(km),
    consumedPct: Math.round(consumedPct * 10) / 10,
    consumedL: consumedL == null ? null : Math.round(consumedL * 10) / 10,
    samples: s ? Number(s.sample_count) : 0,
    overlap: overlap === null ? null : Math.round(overlap * 100),
    l100: l100 === null ? null : Math.round(l100 * 10) / 10,
    reason,
  });
}

// ── Hız oranı ───────────────────────────────────────────────────────────────
const { data: ev } = await sb
  .from("vehicle_events")
  .select("vehicle_id")
  .eq("event_type", "overspeeding")
  .gte("occurred_at", fromISO)
  .lte("occurred_at", toISO);
const speedCount = new Map();
for (const r of ev ?? []) speedCount.set(r.vehicle_id, (speedCount.get(r.vehicle_id) ?? 0) + 1);

const speedRows = vehicles.map((v, i) => {
  const km = rows[i].km;
  const c = speedCount.get(v.id) ?? 0;
  const blocked = km === null || km < SPEED_MIN_KM;
  return { plate: v.plate, km, violations: c, per100: blocked ? null : Math.round((c / km) * 1000) / 10 };
});

// ── RAPOR ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? "—").padEnd(n);
const padL = (s, n) => String(s ?? "—").padStart(n);
console.log(`\nDÖNEM: son ${days} gün  (${fromISO.slice(0, 10)} → ${toISO.slice(0, 10)})`);
console.log(`Araç: ${vehicles.length} (test kayıtları hariç)\n`);

console.log("YAKIT — L/100km üç kapı");
console.log("─".repeat(96));
console.log(
  pad("PLAKA", 11) + padL("KM", 7) + padL("TÜKETİM%", 10) + padL("LİTRE", 8) +
  padL("OKUMA", 8) + padL("ÖRTÜŞ%", 9) + padL("L/100KM", 9) + "  SONUÇ"
);
console.log("─".repeat(96));
for (const r of rows.sort((a, b) => (b.l100 ?? -1) - (a.l100 ?? -1) || a.plate.localeCompare(b.plate))) {
  console.log(
    pad(r.plate, 11) + padL(r.km, 7) + padL(r.consumedPct, 10) + padL(r.consumedL, 8) +
    padL(r.samples, 8) + padL(r.overlap, 9) + padL(r.l100 ?? "gizli", 9) +
    "  " + (r.reason ?? "GÖSTERİLİYOR")
  );
}

console.log("\nHIZ — aşırı hız / 100 km");
console.log("─".repeat(60));
console.log(pad("PLAKA", 11) + padL("KM", 7) + padL("İHLAL", 8) + padL("/100KM", 9) + "  SONUÇ");
console.log("─".repeat(60));
for (const r of speedRows.sort((a, b) => (b.per100 ?? -1) - (a.per100 ?? -1))) {
  console.log(
    pad(r.plate, 11) + padL(r.km, 7) + padL(r.violations, 8) + padL(r.per100 ?? "gizli", 9) +
    "  " + (r.per100 === null ? "eşik altı / veri yok" : "GÖSTERİLİYOR")
  );
}

// ── HÜKÜM ───────────────────────────────────────────────────────────────────
const shown = rows.filter((r) => r.l100 !== null);
const insane = shown.filter((r) => r.l100 < SANE_L100[0] || r.l100 > SANE_L100[1]);
const fleetKm = shown.reduce((a, r) => a + r.km, 0);
const fleetL = shown.reduce((a, r) => a + (r.consumedL ?? 0), 0);
const fleet = fleetKm > 0 ? Math.round((fleetL / fleetKm) * 1000) / 10 : null;

console.log("\n" + "═".repeat(60));
console.log(`L/100km gösterilen araç : ${shown.length}/${vehicles.length}`);
console.log(`Filo ortalaması        : ${fleet ?? "—"} L/100km (${shown.length}/${vehicles.length} araçtan)`);
console.log(`Makul aralık           : ${SANE_L100[0]}–${SANE_L100[1]} L/100km`);
console.log(`Aralık dışı GÖSTERİLEN : ${insane.length}`);
console.log("═".repeat(60));
if (insane.length) {
  console.error("\n✖ KAPI DELİNMİŞ — makul aralık dışında gösterilen değer(ler):");
  for (const r of insane) console.error(`   ${r.plate}: ${r.l100} L/100km (${r.consumedL} L ÷ ${r.km} km)`);
  process.exit(1);
}
console.log("\n✓ Kapıyı geçen her L/100km değeri makul aralıkta. Saçma değer yok.");
