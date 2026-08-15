#!/usr/bin/env node
/**
 * SKOR EKSEN — 2. ÖLÇÜM: "VARDİYASIZ OLAY" NEDEN? HİÇBİR ŞEY YAZMAZ.
 *
 * 1. ölçümde 4892 olayın 1897'si (%38,8) hiçbir vardiya penceresine düşmedi.
 * Düzeltmeyi yapmadan ÖNCE bunun SEBEBİ bilinmeli: gerçekten mesai dışı sürüş
 * mü, yoksa penceremiz mi dar/eksik? Yanlış cevap 17.000 ceza puanını sessizce
 * siler ve HERKESİN skorunu şişirir.
 *
 * Ölçülen:
 *   A. Filtre etkisi — onlyDrivers/withoutTestRows elediği vardiyalar yüzünden
 *      mi eşleşmiyor? (ham time_entries ile tekrar eşle)
 *   B. Saat dağılımı — mesai dışı mı, mesai içi mi?
 *   C. En yakın vardiyaya uzaklık — kenar payı meselesi mi?
 *   D. O araçta O GÜN hiç vardiya var mıydı?
 *   E. Çok-eşleşen 25 olay: hangi vardiyalar çakışıyor?
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-skor-eksen-2.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { computeAnalyticsRange, listVehiclesAndWorkers } from "@/lib/analytics";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";
import { TENANT_TZ } from "@/lib/tz";

const GUN = Number(process.argv[2] ?? 30);
const range =
  GUN === 30
    ? computeAnalyticsRange("ay")
    : GUN === 7
      ? computeAnalyticsRange("hafta")
      : {
          start: addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1)),
          end: computeAnalyticsRange("gun").end,
        };
const startISO = range.start.toISOString();
const endISO = range.end.toISOString();
const endMs = Date.parse(endISO);
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 16) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ VARDİYASIZ OLAY · SEBEP ÖLÇÜMÜ (yazma YOK) ════════════════════`);
console.log(`║ pencere ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);

const { vehicles, workers } = await listVehiclesAndWorkers();
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const scope = await getTestScope();
const driverScope = await getDriverScope();

const [events, idleEpisodes] = await Promise.all([
  listEventsInRange(startISO, endISO),
  listIdleEpisodesInRange(startISO, endISO),
]);

const olaylar = [];
for (const e of events) {
  const w = SAFETY_SCORE_WEIGHTS[e.event_type];
  if (w === undefined) continue;
  olaylar.push({ vehicleId: e.vehicle_id, at: e.occurred_at, tip: e.event_type, agirlik: w });
}
for (const ep of idleEpisodes) {
  olaylar.push({ vehicleId: ep.vehicle_id, at: ep.started_at, tip: "idling", agirlik: SAFETY_SCORE_WEIGHTS.idling ?? 0 });
}

/** Pencere seti kur. */
function pencereKur(rows) {
  const m = new Map();
  for (const e of rows) {
    if (!e.worker_id || !e.vehicle_id) continue;
    const arr = m.get(e.vehicle_id) ?? [];
    arr.push({
      workerId: e.worker_id,
      a: Date.parse(e.started_at),
      b: e.ended_at ? Date.parse(e.ended_at) : endMs,
      acik: !e.ended_at,
    });
    m.set(e.vehicle_id, arr);
  }
  for (const arr of m.values()) arr.sort((x, y) => x.a - y.a);
  return m;
}
const esle = (pen, vid, iso) => {
  const t = Date.parse(iso);
  return (pen.get(vid) ?? []).filter((p) => t >= p.a && t <= p.b);
};

// ══ A. FİLTRE ETKİSİ ═════════════════════════════════════════════════════
console.log(`\n── A. FİLTRE ETKİSİ (hangi vardiya seti kaç olayı yakalıyor) ──`);
const SELECT = "id, worker_id, vehicle_id, started_at, ended_at";
const q = () =>
  supabaseAdmin
    .from("time_entries")
    .select(SELECT)
    .lte("started_at", endISO)
    .or(`ended_at.is.null,ended_at.gte.${startISO}`)
    .order("started_at", { ascending: true })
    .order("id");

const [{ data: hamData }, { data: uretimData }] = await Promise.all([
  fetchAllRows((from, to) => q().range(from, to), "eksen2/ham"),
  fetchAllRows(
    (from, to) =>
      onlyDrivers(withoutTestRows(q().range(from, to), "worker_id", scope.workerIds), "worker_id", driverScope),
    "eksen2/uretim"
  ),
]);
const ham = hamData ?? [];
const uretim = uretimData ?? [];
const penHam = pencereKur(ham);
const penUretim = pencereKur(uretim);

const say = (pen) => olaylar.filter((o) => esle(pen, o.vehicleId, o.at).length > 0).length;
const hamEsl = say(penHam);
const uretimEsl = say(penUretim);
console.log(`  toplam olay ${olaylar.length}`);
console.log(`  ÜRETİM vardiya seti (${uretim.length} satır) → ${uretimEsl} eşleşti  (%${((uretimEsl / olaylar.length) * 100).toFixed(1)})`);
console.log(`  HAM    vardiya seti (${ham.length} satır) → ${hamEsl} eşleşti  (%${((hamEsl / olaylar.length) * 100).toFixed(1)})`);
console.log(`  → filtrelerin ELEDİĞİ vardiyalar ${hamEsl - uretimEsl} olayı açıklıyor`);

// eşleşmeyenleri sabitle (üretim setine göre)
const eslesmeyen = olaylar.filter((o) => esle(penUretim, o.vehicleId, o.at).length === 0);
console.log(`  eşleşmeyen: ${eslesmeyen.length} olay · ${eslesmeyen.reduce((s, o) => s + o.agirlik, 0)} ceza`);

// ══ B. SAAT DAĞILIMI ═════════════════════════════════════════════════════
console.log(`\n── B. SAAT DAĞILIMI (Viyana) ──`);
const saatOf = (iso) =>
  Number(new Date(iso).toLocaleString("en-GB", { timeZone: TENANT_TZ, hour: "2-digit", hour12: false }));
const gunOf = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: TENANT_TZ, weekday: "short" });
const saatE = new Array(24).fill(0);
const saatT = new Array(24).fill(0);
for (const o of olaylar) saatT[saatOf(o.at)]++;
for (const o of eslesmeyen) saatE[saatOf(o.at)]++;
console.log(`  saat  eşleşmeyen / toplam   oran`);
for (let h = 0; h < 24; h++) {
  if (saatT[h] === 0) continue;
  const bar = "█".repeat(Math.round((saatE[h] / Math.max(1, Math.max(...saatT))) * 30));
  console.log(`  ${n(h, 4)}  ${n(saatE[h], 6)} / ${n(saatT[h], 6)}   ${n("%" + ((saatE[h] / saatT[h]) * 100).toFixed(0), 5)} ${bar}`);
}
const gunE = new Map(), gunT = new Map();
for (const o of olaylar) gunT.set(gunOf(o.at), (gunT.get(gunOf(o.at)) ?? 0) + 1);
for (const o of eslesmeyen) gunE.set(gunOf(o.at), (gunE.get(gunOf(o.at)) ?? 0) + 1);
console.log(`  gün   eşleşmeyen / toplam`);
for (const g of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
  if (!gunT.get(g)) continue;
  console.log(`  ${ad(g, 5)} ${n(gunE.get(g) ?? 0, 6)} / ${n(gunT.get(g), 6)}   ${n("%" + (((gunE.get(g) ?? 0) / gunT.get(g)) * 100).toFixed(0), 5)}`);
}

// ══ C. EN YAKIN VARDİYAYA UZAKLIK ════════════════════════════════════════
console.log(`\n── C. EN YAKIN VARDİYAYA UZAKLIK (aynı araç) ──`);
const kova = { "0-5dk": 0, "5-30dk": 0, "30dk-2sa": 0, "2-8sa": 0, "8-24sa": 0, "1gün+": 0, "hiç vardiya yok": 0 };
for (const o of eslesmeyen) {
  const arr = penUretim.get(o.vehicleId) ?? [];
  if (!arr.length) { kova["hiç vardiya yok"]++; continue; }
  const t = Date.parse(o.at);
  let en = Infinity;
  for (const p of arr) en = Math.min(en, t < p.a ? p.a - t : t - p.b);
  const dk = en / 60000;
  if (dk <= 5) kova["0-5dk"]++;
  else if (dk <= 30) kova["5-30dk"]++;
  else if (dk <= 120) kova["30dk-2sa"]++;
  else if (dk <= 480) kova["2-8sa"]++;
  else if (dk <= 1440) kova["8-24sa"]++;
  else kova["1gün+"]++;
}
for (const [k, v] of Object.entries(kova)) {
  console.log(`  ${ad(k, 18)} ${n(v, 6)}  %${((v / Math.max(1, eslesmeyen.length)) * 100).toFixed(1)}`);
}

// ══ D. O ARAÇTA O GÜN VARDİYA VAR MIYDI ══════════════════════════════════
console.log(`\n── D. O ARAÇTA O GÜN VARDİYA VAR MIYDI ──`);
const gunluVardiya = new Set();
for (const e of uretim) {
  if (!e.vehicle_id) continue;
  gunluVardiya.add(`${e.vehicle_id}|${viennaDayKey(e.started_at)}`);
}
let gunVar = 0, gunYok = 0;
for (const o of eslesmeyen) {
  if (gunluVardiya.has(`${o.vehicleId}|${viennaDayKey(o.at)}`)) gunVar++;
  else gunYok++;
}
console.log(`  o gün o araçta vardiya VAR ama olay pencerenin dışında : ${n(gunVar)}  %${((gunVar / Math.max(1, eslesmeyen.length)) * 100).toFixed(1)}`);
console.log(`  o gün o araçta HİÇ vardiya yok                          : ${n(gunYok)}  %${((gunYok / Math.max(1, eslesmeyen.length)) * 100).toFixed(1)}`);

// ══ E. ÇOK EŞLEŞEN OLAYLAR ═══════════════════════════════════════════════
console.log(`\n── E. ÇOK EŞLEŞEN OLAYLAR (aynı araçta çakışan vardiya) ──`);
const cok = olaylar.filter((o) => esle(penUretim, o.vehicleId, o.at).length > 1);
console.log(`  ${cok.length} olay birden fazla vardiyaya düşüyor`);
const cift = new Map();
for (const o of cok) {
  const m = esle(penUretim, o.vehicleId, o.at);
  const isim = m.map((p) => workersById.get(p.workerId)?.name ?? p.workerId.slice(0, 8)).sort().join(" + ");
  const plate = vehiclesById.get(o.vehicleId)?.plate ?? "?";
  const k = `${plate} : ${isim}`;
  cift.set(k, (cift.get(k) ?? 0) + 1);
}
for (const [k, v] of [...cift].sort((a, b) => b[1] - a[1])) console.log(`  ${n(v, 5)} × ${k}`);

// ══ F. AÇIK VARDİYA ETKİSİ ═══════════════════════════════════════════════
console.log(`\n── F. AÇIK VARDİYA (ended_at null) ──`);
const acik = uretim.filter((e) => !e.ended_at);
console.log(`  ${acik.length}/${uretim.length} vardiya açık — pencereleri aralık sonunda kapanıyor (052 ile aynı kural)`);
for (const e of acik.slice(0, 10)) {
  console.log(`     ${ad(workersById.get(e.worker_id)?.name ?? "?")} ${ad(vehiclesById.get(e.vehicle_id)?.plate ?? "?", 10)} başladı ${e.started_at}`);
}

// ══ G. ARAÇ BAZINDA EŞLEŞME ORANI ════════════════════════════════════════
console.log(`\n── G. ARAÇ BAZINDA EŞLEŞME ORANI ──`);
const aracT = new Map(), aracE = new Map(), aracV = new Map();
for (const o of olaylar) aracT.set(o.vehicleId, (aracT.get(o.vehicleId) ?? 0) + 1);
for (const o of eslesmeyen) aracE.set(o.vehicleId, (aracE.get(o.vehicleId) ?? 0) + 1);
for (const e of uretim) if (e.vehicle_id) aracV.set(e.vehicle_id, (aracV.get(e.vehicle_id) ?? 0) + 1);
const sat = [...aracT].map(([vid, t]) => ({
  plate: vehiclesById.get(vid)?.plate ?? vid.slice(0, 8),
  t, e: aracE.get(vid) ?? 0, v: aracV.get(vid) ?? 0,
}));
sat.sort((a, b) => b.e - a.e);
console.log(`  ${ad("plaka", 12)} ${n("olay", 6)} ${n("eşlşmz", 7)} ${n("oran", 6)} ${n("vardiya", 8)}`);
for (const s of sat) {
  console.log(`  ${ad(s.plate, 12)} ${n(s.t, 6)} ${n(s.e, 7)} ${n("%" + ((s.e / s.t) * 100).toFixed(0), 6)} ${n(s.v, 8)}`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
