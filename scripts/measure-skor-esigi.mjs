#!/usr/bin/env node
/**
 * GÜVENLİK SKORU — EŞİK ve AĞIRLIK ÖLÇÜMÜ. HİÇBİR ŞEY YAZMAZ.
 *
 * YÖNTEM: `buildPerformanceReport`in kullandığı GİRDİLERİN AYNISI kurulur ve
 * `computeSafetyScores` AYNEN çağrılır. Senaryolar arasında değişen tek şey
 * SABİTLERDİR (km eşiği ve olay ağırlıkları) — hesabın kendisi üretim kodudur.
 * Yani buradaki hiçbir sayı ikinci bir formülden çıkmıyor.
 *
 * TARİHSEL TABAN (40 km/gün · 300 km taban · hızlanma 12) betiğe GÖMÜLÜDÜR:
 * sabitler değiştikten sonra da ÖNCE/SONRA karşılaştırması tekrar üretilebilsin.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-skor-esigi.mjs [gun]
 *   (gun varsayılan 30)
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  computeSafetyScores,
  drivenVehiclesFromEntries,
  workedDaysFromEntries,
  getWorkerShiftDistance,
  shiftKmForScoring,
  scoreMinKmForWorkedDays,
  scoreMinKmForSpan,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
  rangeElapsedDays,
} from "@/lib/analytics";
import {
  SAFETY_SCORE_K,
  SCORE_MIN_KM_PER_DAY,
  SCORE_MIN_KM_FLOOR,
} from "@/lib/metric-thresholds";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { mapBounded } from "@/lib/db-fanout";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

/** 12.08.2026 kararlarından ÖNCEKİ sabitler — karşılaştırmanın sabit tabanı. */
const TABAN = { perDay: 40, floor: 300, accel: 12, ad: "ÖNCE (40/300/12)" };
const YURURLUK = {
  perDay: SCORE_MIN_KM_PER_DAY,
  floor: SCORE_MIN_KM_FLOOR,
  accel: SAFETY_SCORE_WEIGHTS.harsh_acceleration,
  ad: `YÜRÜRLÜK (${SCORE_MIN_KM_PER_DAY}/${SCORE_MIN_KM_FLOOR}/${SAFETY_SCORE_WEIGHTS.harsh_acceleration})`,
};

const GUN = Number(process.argv[2] ?? 30);
const range =
  GUN === 30 ? computeAnalyticsRange("ay")
  : GUN === 7 ? computeAnalyticsRange("hafta")
  : { start: addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1)), end: computeAnalyticsRange("gun").end };

const n = (x, w = 6) => String(x).padStart(w);
const f1 = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(1));
const ad8 = (s) => s.slice(0, 8).padEnd(9);

console.log(`\n╔══ GÜVENLİK SKORU · EŞİK + AĞIRLIK ÖLÇÜMÜ (yazma YOK) ═════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ pencere  ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);

// ── buildPerformanceReport'un girdileri, birebir ──────────────────────────
const startISO = range.start.toISOString();
const endISO = range.end.toISOString();
const { vehicles, workers } = await listVehiclesAndWorkers();
const [events, idleEpisodes, spanEntries] = await Promise.all([
  listEventsInRange(startISO, endISO),
  listIdleEpisodesInRange(startISO, endISO),
  mapBounded(vehicles, async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)]),
]);
const distanceByVehicle = new Map(spanEntries.map(([id, s]) => [id, s.km]));
const spanByVehicle = new Map(spanEntries.map(([id, s]) => [id, { firstAt: s.firstAt, lastAt: s.lastAt }]));

const scope = await getTestScope();
const driverScope = await getDriverScope();
const { data: entryData } = await fetchAllRows(
  (from, to) =>
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km")
          .gte("started_at", startISO).lte("started_at", endISO)
          .order("started_at", { ascending: true }).order("id").range(from, to),
        "worker_id", scope.workerIds
      ),
      "worker_id", driverScope
    ),
  "measure/time_entries"
);
const entries = entryData ?? [];
const workedDaysByWorker = workedDaysFromEntries(entries);
const drivenVehicles = drivenVehiclesFromEntries(entries);
const shiftKm = shiftKmForScoring(await getWorkerShiftDistance(startISO, endISO));
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const gecenGun = rangeElapsedDays(range);

/** Rapora giren evren: aralıkta vardiyası VEYA olayı olanlar (reports.ts:472). */
const olayliWorker = new Set();
for (const e of events) {
  const v = vehiclesById.get(e.vehicle_id);
  if (v?.assigned_worker_id) olayliWorker.add(v.assigned_worker_id);
}
const vardiyaliWorker = new Set(entries.map((e) => e.worker_id).filter(Boolean));
const raporda = (rows) => rows.filter((r) => vardiyaliWorker.has(r.workerId) || olayliWorker.has(r.workerId));

/**
 * Eşik — `scoreMinKmForWorkedDays`in AYNADAKİ hâli, sabitleri parametreli.
 * Ayna doğruluğu aşağıda ÜRETİM fonksiyonuna karşı ölçülüyor (iddia #0).
 */
function esikFn(perDay, floor) {
  return (vehicleIds, workerId) => {
    const wd = workedDaysByWorker.get(workerId) ?? 0;
    if (SCORE_THRESHOLD_WORKED_DAYS && wd > 0) {
      return Math.max(floor, perDay * Math.min(gecenGun, Math.max(1, wd)));
    }
    // Bayrak kapalıysa üretim scoreMinKmForSpan'e düşer; oranla ölçekliyoruz.
    const taban = scoreMinKmForSpan(
      range,
      vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })
    );
    return Math.max(floor, (taban / SCORE_MIN_KM_PER_DAY) * perDay);
  };
}

/** Senaryoyu ÜRETİM koduyla koşar: yalnız ağırlık sabiti geçici olarak değişir. */
function skorla({ perDay, floor, accel }) {
  const eski = SAFETY_SCORE_WEIGHTS.harsh_acceleration;
  SAFETY_SCORE_WEIGHTS.harsh_acceleration = accel;
  try {
    return raporda(
      computeSafetyScores(
        events, idleEpisodes, vehiclesById, workersById, distanceByVehicle,
        esikFn(perDay, floor), drivenVehicles, shiftKm
      )
    );
  } finally {
    SAFETY_SCORE_WEIGHTS.harsh_acceleration = eski;
  }
}

const ozet = (rows) => {
  const s = rows.filter((r) => r.score !== null);
  return {
    skorlanan: s.length, toplam: rows.length,
    ort: s.length ? Math.round(s.reduce((a, r) => a + r.score, 0) / s.length) : null,
    min: s.length ? Math.min(...s.map((r) => r.score)) : null,
    max: s.length ? Math.max(...s.map((r) => r.score)) : null,
  };
};

// ══ 0. AYNA DENETİMİ ═════════════════════════════════════════════════════
console.log(`\n── 0. AYNA DENETİMİ (yerel eşik = üretim eşiği) ──`);
{
  let sapan = 0;
  for (const w of workersById.values()) {
    const vids = [...(drivenVehicles.get(w.id) ?? [])];
    const yerel = esikFn(SCORE_MIN_KM_PER_DAY, SCORE_MIN_KM_FLOOR)(vids, w.id);
    const uretim =
      SCORE_THRESHOLD_WORKED_DAYS && (workedDaysByWorker.get(w.id) ?? 0) > 0
        ? scoreMinKmForWorkedDays(range, workedDaysByWorker.get(w.id))
        : scoreMinKmForSpan(range, vids.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null }));
    if (Math.abs(yerel - uretim) > 1e-9) sapan++;
  }
  console.log(`  ${sapan === 0 ? "✓" : "✗"} ${workersById.size} şoförün hepsinde yerel eşik = scoreMinKmForWorkedDays  (${sapan} sapma)`);
}

// ══ 1. EŞİK: NE, NEREDE ══════════════════════════════════════════════════
console.log(`\n── 1. EŞİK: NE, NEREDE ──`);
console.log(`  Ölçüt KM (vardiya sayısı ya da süre DEĞİL).`);
console.log(`  eşik = max(FLOOR, PER_DAY × çalışılan gün)   ·  tavan: geçen gün (${gecenGun})`);
console.log(`  YÜRÜRLÜK: FLOOR=${SCORE_MIN_KM_FLOOR} · PER_DAY=${SCORE_MIN_KM_PER_DAY}  → lib/metric-thresholds.ts`);
console.log(`  Kapı: computeSafetyScores → qualifies = reliableKm != null && reliableKm >= eşik`);

// ══ 2. EŞİK MATRİSİ ══════════════════════════════════════════════════════
console.log(`\n── 2. EŞİK MATRİSİ (ağırlıklar YÜRÜRLÜKTEKİ hâliyle sabit) ──`);
console.log(`  ${"PER_DAY".padStart(8)} ${"FLOOR".padStart(6)} ${"skorlanan".padStart(10)} ${"ort".padStart(4)} ${"min–max".padStart(9)}`);
for (const perDay of [40, 20]) {
  for (const floor of [300, 200, 150, 0]) {
    const o = ozet(skorla({ perDay, floor, accel: YURURLUK.accel }));
    const isaret = perDay === YURURLUK.perDay && floor === YURURLUK.floor ? "  ← yürürlük" : "";
    console.log(`  ${n(perDay, 8)} ${n(floor, 6)} ${n(`${o.skorlanan}/${o.toplam}`, 10)} ${n(o.ort ?? "—", 4)} ${n(`${o.min ?? "—"}–${o.max ?? "—"}`, 9)}${isaret}`);
  }
}

// ══ 3. BAĞLAYICI KISIT ═══════════════════════════════════════════════════
console.log(`\n── 3. HANGİ KISIT BAĞLIYOR (PER_DAY=${SCORE_MIN_KM_PER_DAY}) ──`);
console.log(`  ${SCORE_MIN_KM_PER_DAY} × gün, ${SCORE_MIN_KM_FLOOR} km tabanı ancak ${Math.ceil(SCORE_MIN_KM_FLOOR / SCORE_MIN_KM_PER_DAY)} günden sonra aşar.`);
console.log(`  ${"çalışgün".padStart(8)} ${"çarpan".padStart(7)} ${"taban".padStart(6)} ${"eşik".padStart(6)}  bağlayan`);
for (const g of [1, 3, 5, 10, 15, 16, 20, 30]) {
  const carpan = SCORE_MIN_KM_PER_DAY * Math.min(gecenGun, g);
  const esik = Math.max(SCORE_MIN_KM_FLOOR, carpan);
  console.log(`  ${n(g, 8)} ${n(carpan, 7)} ${n(SCORE_MIN_KM_FLOOR, 6)} ${n(esik, 6)}  ${carpan >= SCORE_MIN_KM_FLOOR ? "ÇARPAN" : "TABAN"}`);
}
{
  const tabanli = [], carpanli = [];
  for (const w of workersById.values()) {
    const wd = workedDaysByWorker.get(w.id) ?? 0;
    if (wd === 0) continue;
    (SCORE_MIN_KM_PER_DAY * Math.min(gecenGun, wd) >= SCORE_MIN_KM_FLOOR ? carpanli : tabanli).push(wd);
  }
  console.log(`  CANLI: ${tabanli.length} şoförü TABAN bağlıyor (çalışgün ≤ ${Math.ceil(SCORE_MIN_KM_FLOOR / SCORE_MIN_KM_PER_DAY) - 1}), ${carpanli.length} şoförü ÇARPAN.`);
}

// ══ 4. CEZA DAĞILIMI ve AĞIRLIK SENARYOLARI ══════════════════════════════
console.log(`\n── 4. CEZANIN OLAY TİPİNE GÖRE DAĞILIMI ──`);
const tipSayim = {};
for (const e of events) tipSayim[e.event_type] = (tipSayim[e.event_type] ?? 0) + 1;
tipSayim.idling = idleEpisodes.length;
function dagilim(accelW) {
  const w = { ...SAFETY_SCORE_WEIGHTS, harsh_acceleration: accelW };
  const katki = {};
  let top = 0;
  for (const [t, c] of Object.entries(tipSayim)) {
    const k = c * (w[t] ?? 0);
    katki[t] = k;
    top += k;
  }
  return { katki, top };
}
console.log(`  ${"olay tipi".padEnd(20)} ${"sayı".padStart(6)} ${"ağırlık".padStart(7)} ${"ceza".padStart(7)} ${"pay".padStart(6)}`);
{
  const { katki, top } = dagilim(YURURLUK.accel);
  for (const [t, c] of Object.entries(tipSayim).sort((a, b) => katki[b[0]] - katki[a[0]])) {
    const w = t === "harsh_acceleration" ? YURURLUK.accel : SAFETY_SCORE_WEIGHTS[t] ?? 0;
    console.log(`  ${t.padEnd(20)} ${n(c, 6)} ${n(w, 7)} ${n(katki[t], 7)} ${n("%" + ((katki[t] / top) * 100).toFixed(1), 6)}`);
  }
}
console.log(`\n  harsh_acceleration AĞIRLIK SENARYOLARI (frekans oranı: hızlanma/fren = ${f1((tipSayim.harsh_acceleration ?? 0) / (tipSayim.harsh_braking || 1))}×)`);
console.log(`  ${"ağırlık".padStart(7)} ${"hızlanma payı".padStart(14)} ${"en büyük tip".padStart(20)} ${"payı".padStart(6)} ${"skorlanan".padStart(10)} ${"ort".padStart(4)} ${"min–max".padStart(9)}`);
for (const aw of [12, 6, 5, 4, 3, 2]) {
  const { katki, top } = dagilim(aw);
  const enBuyuk = Object.entries(katki).sort((a, b) => b[1] - a[1])[0];
  const o = ozet(skorla({ perDay: SCORE_MIN_KM_PER_DAY, floor: SCORE_MIN_KM_FLOOR, accel: aw }));
  const isaret = aw === YURURLUK.accel ? "  ← yürürlük" : "";
  console.log(
    `  ${n(aw, 7)} ${n("%" + ((katki.harsh_acceleration / top) * 100).toFixed(1), 14)} ${enBuyuk[0].padStart(20)} ${n("%" + ((enBuyuk[1] / top) * 100).toFixed(1), 6)} ${n(`${o.skorlanan}/${o.toplam}`, 10)} ${n(o.ort ?? "—", 4)} ${n(`${o.min ?? "—"}–${o.max ?? "—"}`, 9)}${isaret}`
  );
}

// ══ 5. ÖNCE / SONRA ══════════════════════════════════════════════════════
console.log(`\n── 5. ÖNCE / SONRA ──`);
const oncekiRows = skorla(TABAN);
const sonrakiRows = skorla(YURURLUK);
const oOnce = ozet(oncekiRows);
const oSonra = ozet(sonrakiRows);
console.log(`  ${"".padEnd(22)} ${"skorlanan".padStart(10)} ${"ort".padStart(4)} ${"min–max".padStart(9)}`);
for (const [ad, o] of [[TABAN.ad, oOnce], [YURURLUK.ad, oSonra]]) {
  console.log(`  ${ad.padEnd(22)} ${n(`${o.skorlanan}/${o.toplam}`, 10)} ${n(o.ort ?? "—", 4)} ${n(`${o.min ?? "—"}–${o.max ?? "—"}`, 9)}`);
}

/** Skorlu satırların 1 tabanlı sırası (computeSafetyScores kendi sıralamasıyla). */
const siraHaritasi = (rows) => new Map(rows.filter((r) => r.score !== null).map((r, i) => [r.workerId, i + 1]));
const sOnce = siraHaritasi(oncekiRows);
const sSonra = siraHaritasi(sonrakiRows);
const onceById = new Map(oncekiRows.map((r) => [r.workerId, r]));

const skorluSonra = sonrakiRows.filter((r) => r.score !== null);
function satirYaz(r) {
  const o = onceById.get(r.workerId);
  const oncekiSira = sOnce.get(r.workerId) ?? null;
  const sira = sSonra.get(r.workerId);
  const d = oncekiSira === null ? null : oncekiSira - sira;
  const ok = d === null ? "YENİ" : d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "  =";
  console.log(
    `  ${n(sira, 4)}. ${ad8(r.name)} ${n(Math.round(r.distanceKm ?? 0), 6)}km ${n(o?.score ?? "—", 5)} → ${n(r.score, 4)}  ${n(oncekiSira ?? "—", 5)} → ${n(sira, 4)}  ${ok}`
  );
}
console.log(`\n  İLK 5 (yeni sıraya göre)   ${"km".padStart(8)} ${"skor ö→s".padStart(12)} ${"sıra ö→s".padStart(13)}`);
for (const r of skorluSonra.slice(0, 5)) satirYaz(r);
console.log(`  SON 5`);
for (const r of skorluSonra.slice(-5)) satirYaz(r);

{
  const hareket = skorluSonra
    .filter((r) => sOnce.has(r.workerId))
    .map((r) => ({ ad: r.name, d: sOnce.get(r.workerId) - sSonra.get(r.workerId) }));
  const yukselen = hareket.filter((h) => h.d > 0).sort((a, b) => b.d - a.d);
  const dusen = hareket.filter((h) => h.d < 0).sort((a, b) => a.d - b.d);
  const yeni = skorluSonra.filter((r) => !sOnce.has(r.workerId));
  console.log(`\n  HAM SIRA (tüm liste): ${yukselen.length} yükseldi · ${dusen.length} düştü · ${hareket.length - yukselen.length - dusen.length} yerinde · ${yeni.length} YENİ girdi`);
  if (yukselen[0]) console.log(`     en çok yükselen  ${ad8(yukselen[0].ad)} ▲${yukselen[0].d}`);
  if (dusen[0]) console.log(`     en çok düşen     ${ad8(dusen[0].ad)} ▼${-dusen[0].d}`);

  /**
   * NÜFUS ETKİSİ AYRIŞTIRILIYOR: liste 11'den 19'a çıktığı için eski üyelerin
   * HAM sırası kaçınılmaz olarak düşer — bu bir kötüleşme değil, payda değişimi.
   * Gerçek hareketi görmek için eski 11 kişilik kadro KENDİ İÇİNDE sıralanıyor.
   */
  const eskiKadro = new Set([...sOnce.keys()]);
  const kadroSonra = skorluSonra.filter((r) => eskiKadro.has(r.workerId));
  const sKadro = new Map(kadroSonra.map((r, i) => [r.workerId, i + 1]));
  const kadroHareket = kadroSonra
    .map((r) => ({ ad: r.name, d: sOnce.get(r.workerId) - sKadro.get(r.workerId) }))
    .filter((h) => h.d !== 0);
  console.log(`  ESKİ KADRO İÇİNDE (${eskiKadro.size} kişi kendi arasında): ${kadroHareket.filter((h) => h.d > 0).length} yükseldi · ${kadroHareket.filter((h) => h.d < 0).length} düştü · ${eskiKadro.size - kadroHareket.length} yerinde`);
  for (const h of kadroHareket.sort((a, b) => b.d - a.d)) {
    console.log(`     ${ad8(h.ad)} ${h.d > 0 ? "▲" + h.d : "▼" + -h.d}`);
  }
}

// ══ 6. ANİ HIZLANMASI EN ÇOK OLAN ŞOFÖR ══════════════════════════════════
console.log(`\n── 6. ANİ HIZLANMASI EN ÇOK OLAN ŞOFÖR ──`);
{
  const evByWorker = new Map();
  for (const e of events) {
    const v = vehiclesById.get(e.vehicle_id);
    if (!v?.assigned_worker_id) continue;
    const a = evByWorker.get(v.assigned_worker_id) ?? {};
    a[e.event_type] = (a[e.event_type] ?? 0) + 1;
    evByWorker.set(v.assigned_worker_id, a);
  }
  const adaylar = [...evByWorker.entries()]
    .filter(([, ev]) => (ev.harsh_acceleration ?? 0) > 0)
    .sort((a, b) => (b[1].harsh_acceleration ?? 0) - (a[1].harsh_acceleration ?? 0))
    .slice(0, 3);
  if (!adaylar.length) console.log("  (ani hızlanma olayı yok)");
  for (const [wid, ev] of adaylar) {
    const o = onceById.get(wid);
    const s = sonrakiRows.find((r) => r.workerId === wid);
    console.log(`\n  ${ad8(s?.name ?? o?.name ?? "?")} · ${Math.round(s?.distanceKm ?? 0)} km · ani hızlanma ${ev.harsh_acceleration}`);
    console.log(`     kırılım: ${Object.entries(ev).map(([t, c]) => `${t.replace("harsh_", "")}×${c}`).join(" · ")}`);
    for (const [ad, sen, row] of [[TABAN.ad, TABAN, o], [YURURLUK.ad, YURURLUK, s]]) {
      const hizCeza = (ev.harsh_acceleration ?? 0) * sen.accel;
      const c1000 = row?.distanceKm ? row.penalty / (row.distanceKm / 1000) : null;
      console.log(
        `     ${ad.padEnd(22)} ceza ${n(row?.penalty ?? "—", 6)} (hızlanma payı ${n(hizCeza, 5)} = %${row?.penalty ? ((hizCeza / row.penalty) * 100).toFixed(0) : "—"})` +
          ` · ${f1(c1000)}/1000km · SKOR ${row?.score ?? "—"}`
      );
    }
  }
}

// ══ 7. İHLAL YOĞUNLUĞU ═══════════════════════════════════════════════════
console.log(`\n── 7. İHLAL YOĞUNLUĞU (eşikler CİHAZDA, kodda değil) ──`);
{
  const aktifArac = new Set(events.map((e) => e.vehicle_id)).size;
  console.log(`  ${events.length} olay + ${idleEpisodes.length} rölanti epizodu · ${aktifArac}/${vehicles.length} araç · ${gecenGun} gün`);
  console.log(`  → ${f1(events.length / Math.max(1, aktifArac * gecenGun))} alarm/araç-gün`);
  console.log(`  ⚠️ harsh_* / overspeeding eşikleri Teltonika FMC003 setparam'larında (AVL 253/254).`);
  console.log(`     Kod yalnız cihazın kararını SAYAR (lib/flespi.ts:413) — ağırlık ≠ eşik.`);
}
console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı · K=${SAFETY_SCORE_K} ═══\n`);
