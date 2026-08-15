#!/usr/bin/env node
/**
 * SAHTE 0 KM SAYIMI — cihazı sessiz araçlarda vardiya km'si.
 * ⚠️ SALT OKUMA. Hiçbir satır yazılmaz/güncellenmez.
 *
 * Ayrım:
 *   GERÇEK 0   → vardiya penceresinde telemetri VAR, odometre gerçekten değişmemiş
 *                (araç park etti) → 0 km doğru sayı.
 *   SAHTE 0    → vardiya penceresinde HİÇ telemetri yok (cihaz sessiz) ama
 *                start_km == end_km yazılmış → 0 km UYDURMA.
 *   ÖLÇÜLEMEZ  → end_km null (zaten "—" gösteriyor).
 *
 * Kullanım:
 *   node --import ./scripts/ts-server.mjs scripts/measure-sahte-sifir-km.mjs
 *   GUN=90 ile pencere değiştirilebilir.
 */
import { supabaseAdmin } from "@/lib/supabase";

const GUN = Number(process.env.GUN ?? 60);
const NOW = Date.now();
const FROM = new Date(NOW - GUN * 86400000).toISOString();

console.log(`\n╔══ SAHTE 0 KM SAYIMI ═══════════════════════════════════════════════`);
console.log(`║ pencere  son ${GUN} gün (${FROM.slice(0, 10)} → bugün)`);
console.log(`║ ⚠️ salt okuma\n`);

const { data: araclar } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, flespi_device_id, is_test");
const aracAd = new Map((araclar ?? []).map((v) => [v.id, v.plate]));

const { data: vardiyalar, error } = await supabaseAdmin
  .from("time_entries")
  .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_km, end_km, cargo_count")
  .gte("started_at", FROM)
  .order("started_at", { ascending: true });
if (error) { console.error("✗", error.message); process.exit(1); }

const { data: workers } = await supabaseAdmin.from("workers").select("id, name, is_active");
const wAd = new Map((workers ?? []).map((w) => [w.id, w.name]));

console.log(`── pencerede vardiya: ${(vardiyalar ?? []).length}\n`);

/** Vardiya penceresinde araçtan gelen telemetri satırı var mı + odometre var mı? */
async function pencere(vehicleId, a, b) {
  const to = b ?? new Date().toISOString();
  const [{ count: satir }, { data: odo }] = await Promise.all([
    supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId).gte("recorded_at", a).lte("recorded_at", to),
    supabaseAdmin.from("device_telemetry").select("odometer_km")
      .eq("vehicle_id", vehicleId).not("odometer_km", "is", null)
      .gte("recorded_at", a).lte("recorded_at", to).limit(1),
  ]);
  return { satir: satir ?? 0, odoVar: (odo ?? []).length > 0 };
}

const sinif = { sahteSifir: [], gercekSifir: [], olculemez: [], normal: [], odoYokAmaTelemetriVar: [] };

for (const v of vardiyalar ?? []) {
  if (!v.vehicle_id) continue;
  const p = await pencere(v.vehicle_id, v.started_at, v.ended_at);
  const km = v.end_km != null && v.start_km != null ? v.end_km - v.start_km : null;
  const kayit = {
    id: v.id, plaka: v.plate ?? aracAd.get(v.vehicle_id) ?? "—",
    sofor: wAd.get(v.worker_id) ?? "—",
    gun: String(v.started_at).slice(0, 10),
    start: v.start_km, end: v.end_km, km, paket: v.cargo_count,
    telemetriSatiri: p.satir, odoVar: p.odoVar,
    acik: v.ended_at == null,
  };
  if (km === null) sinif.olculemez.push(kayit);
  else if (km === 0 && p.satir === 0) sinif.sahteSifir.push(kayit);
  else if (km === 0 && !p.odoVar) sinif.odoYokAmaTelemetriVar.push(kayit);
  else if (km === 0) sinif.gercekSifir.push(kayit);
  else sinif.normal.push(kayit);
}

const n = (a) => String(a.length).padStart(4);
console.log(`── SINIFLANDIRMA ──`);
console.log(`  ${n(sinif.normal)}  normal (km > 0)`);
console.log(`  ${n(sinif.gercekSifir)}  GERÇEK 0 km — telemetri var, odometre değişmemiş (araç park etti)`);
console.log(`  ${n(sinif.sahteSifir)}  🔴 SAHTE 0 km — vardiya boyunca HİÇ telemetri yok, yine de 0 yazılmış`);
console.log(`  ${n(sinif.odoYokAmaTelemetriVar)}  🟡 telemetri var ama ODOMETRE yok → 0 yazılmış (donmuş bayat değer)`);
console.log(`  ${n(sinif.olculemez)}  end_km null → zaten "—"`);

console.log(`\n── 🔴 SAHTE 0 KM · araç bazında ──`);
const g = new Map();
for (const k of [...sinif.sahteSifir, ...sinif.odoYokAmaTelemetriVar]) {
  const o = g.get(k.plaka) ?? { n: 0, paket: 0, ilk: k.gun, son: k.gun, soforler: new Set() };
  o.n++; o.paket += k.paket ?? 0; o.son = k.gun; o.soforler.add(k.sofor);
  g.set(k.plaka, o);
}
console.log(`  ${"plaka".padEnd(11)}${"vardiya".padStart(8)}${"paket".padStart(8)}  ${"ilk".padEnd(11)}${"son".padEnd(11)}şoför`);
for (const [p, o] of [...g.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${p.padEnd(11)}${String(o.n).padStart(8)}${String(o.paket).padStart(8)}  ${o.ilk.padEnd(11)}${o.son.padEnd(11)}${[...o.soforler].join(", ")}`);
}

console.log(`\n── 🔴 SAHTE 0 KM · şoför bazında (kaç günlük emeği 0 km görünüyor) ──`);
const s = new Map();
for (const k of [...sinif.sahteSifir, ...sinif.odoYokAmaTelemetriVar]) {
  const o = s.get(k.sofor) ?? { n: 0, paket: 0, gunler: [] };
  o.n++; o.paket += k.paket ?? 0; o.gunler.push(k.gun);
  s.set(k.sofor, o);
}
for (const [w, o] of [...s.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${w.padEnd(22)} ${String(o.n).padStart(3)} vardiya · ${String(o.paket).padStart(5)} paket · ${o.gunler[0]} → ${o.gunler[o.gunler.length - 1]}`);
}

console.log(`\n── ÖRNEK SATIRLAR (ilk 15 sahte 0) ──`);
for (const k of [...sinif.sahteSifir, ...sinif.odoYokAmaTelemetriVar].slice(0, 15)) {
  console.log(`  ${k.gun} ${k.plaka.padEnd(11)} ${k.sofor.padEnd(20)} start ${String(k.start).padStart(7)} → end ${String(k.end).padStart(7)} = ${k.km} km · paket ${k.paket ?? "—"} · pencerede telemetri ${k.telemetriSatiri}`);
}

console.log(`\n── "end_km null" olanlar da doğru mu gösteriliyor? (ilk 10) ──`);
for (const k of sinif.olculemez.slice(0, 10)) {
  console.log(`  ${k.gun} ${k.plaka.padEnd(11)} ${k.sofor.padEnd(20)} start ${String(k.start).padStart(7)} → end ${k.end} · açık ${k.acik} · telemetri ${k.telemetriSatiri}`);
}

// ── ŞOFÖR AYLIK TOPLAMI — ekranın BUGÜN gösterdiği sayı ─────────────────
console.log(`\n── ŞOFÖR TOPLAMI: ekranın gösterdiği km ↔ kaç vardiya sessizce dışarıda ──`);
console.log(`   (panel/rapor toplamı: end_km ve start_km dolu olan vardiyaların farkı)`);
console.log(`   ${"şoför".padEnd(22)}${"vardiya".padStart(8)}${"ekranda km".padStart(12)}${"sayılmayan vardiya".padStart(20)}  durum`);
const tot = new Map();
for (const v of vardiyalar ?? []) {
  if (!v.worker_id) continue;
  const o = tot.get(v.worker_id) ?? { n: 0, km: 0, disarida: 0, sahte: 0, plakalar: new Set() };
  o.n++;
  if (v.plate) o.plakalar.add(v.plate);
  if (v.end_km != null && v.start_km != null) {
    const d = v.end_km - v.start_km;
    o.km += d;
    if (d === 0) o.sahte++;
  } else o.disarida++;
  tot.set(v.worker_id, o);
}
for (const [wid, o] of [...tot.entries()].sort((a, b) => (b[1].disarida + b[1].sahte) - (a[1].disarida + a[1].sahte)).slice(0, 12)) {
  const bozuk = o.disarida + o.sahte;
  console.log(
    `   ${String(wAd.get(wid) ?? wid.slice(0, 8)).padEnd(22)}${String(o.n).padStart(8)}${String(Math.round(o.km)).padStart(12)}` +
    `${String(o.disarida).padStart(20)}  ${bozuk > 0 ? `🔴 ${bozuk}/${o.n} vardiya km'siz (${[...o.plakalar].join(",")})` : "temiz"}`
  );
}

// Şu an sessiz araçların listesi (son telemetri > 2 gün)
console.log(`\n── ŞU AN SESSİZ ARAÇLAR (DB tarafı) ──`);
for (const v of (araclar ?? []).filter((x) => x.flespi_device_id)) {
  const { data: t } = await supabaseAdmin.from("device_telemetry")
    .select("recorded_at").eq("vehicle_id", v.id)
    .order("recorded_at", { ascending: false }).limit(1);
  const son = t?.[0]?.recorded_at ?? null;
  const gun = son ? (NOW - Date.parse(son)) / 86400000 : 9999;
  if (gun > 2) console.log(`  🔴 ${v.plate.padEnd(11)} son telemetri ${String(son ?? "hiç").slice(0, 16)} (${gun.toFixed(1)} gün)`);
}

console.log(`\n╚══ SAYIM BİTTİ · hiçbir satır değiştirilmedi ═══\n`);
