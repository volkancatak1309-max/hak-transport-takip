#!/usr/bin/env node
/**
 * OLAY AĞIRLIKLARI — TEMİZ PENCEREDE ÖLÇÜM. HİÇBİR ŞEY DEĞİŞTİRMEZ.
 *
 * TEMİZ PENCERE: 23.07.2026 → bugün. Teltonika eşikleri 22–23 Temmuz'da
 * değişti (cihaz yanıtlarıyla kanıtlı, bkz. scripts/measure-flespi-ayarlar.mjs);
 * o tarihten önceki olaylar SIKI eşiklerle üretildi ve oran hesabını kirletir.
 *
 * YÖNTEM: üretim `computeSafetyScores` AYNEN çağrılır. Senaryolar arasında
 * değişen tek şey `SAFETY_SCORE_WEIGHTS` sabitidir (geçici olarak yamanır,
 * `finally` ile geri konur). Hiçbir sayı ikinci bir formülden çıkmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-agirlik-temiz-pencere.mjs [YYYY-MM-DD]
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
  shiftWindowsForScoring,
  workerDrivingAt,
  scoreMinKmForWorkedDays,
  scoreMinKmForSpan,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
  rangeElapsedDays,
} from "@/lib/analytics";
import { SAFETY_SCORE_K, SCORE_MIN_KM_PER_DAY, SCORE_MIN_KM_FLOOR } from "@/lib/metric-thresholds";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { mapBounded } from "@/lib/db-fanout";
import { viennaDayKey, addCalendarDaysVienna, startOfDayViennaFromYmd } from "@/lib/format";

/** Eşik değişiminin ertesi günü — ilk TAM temiz gün. */
const TEMIZ_BAS = process.argv[2] ?? "2026-07-23";
const bugun = viennaDayKey(new Date());
const range = computeAnalyticsRange("ozel", TEMIZ_BAS, bugun);

/** Yürürlükteki ağırlıkların anlık kopyası (yama sonrası geri koymak için). */
const YURURLUK = { ...SAFETY_SCORE_WEIGHTS };
/**
 * ŞİDDET SIRASI — deponun ORİJİNAL politika kararı (12.08 öncesi ağırlıklar).
 * "Bir olay ne kadar kötü" sorusunun cevabı; frekanstan BAĞIMSIZ.
 */
const SIDDET = { overspeeding: 25, jamming: 25, harsh_braking: 12, harsh_acceleration: 12, harsh_cornering: 12, idling: 5 };

const n = (x, w = 6) => String(x).padStart(w);
const f = (x, d = 2) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));

console.log(`\n╔══ OLAY AĞIRLIKLARI · TEMİZ PENCERE ÖLÇÜMÜ (yazma YOK) ════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ pencere  ${TEMIZ_BAS} → ${bugun}  (${rangeElapsedDays(range)} gün)`);
console.log(`║ gerekçe  eşikler 22–23.07'de değişti; öncesi SIKI eşik, oranı kirletir`);

// ── Girdiler (buildPerformanceReport'un aynısı) ───────────────────────────
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
  (a, b) =>
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin.from("time_entries")
          .select("id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km")
          .gte("started_at", startISO).lte("started_at", endISO)
          .order("started_at", { ascending: true }).order("id").range(a, b),
        "worker_id", scope.workerIds
      ),
      "worker_id", driverScope
    ),
  "agirlik/time_entries"
);
const entries = entryData ?? [];
const workedDaysByWorker = workedDaysFromEntries(entries);
const drivenVehicles = drivenVehiclesFromEntries(entries);
const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
const shiftKm = shiftKmForScoring(shiftKmRes);
/**
 * EKSEN (15.08.2026): olay atfı da vardiya penceresinden — üretimin geçtiğinin
 * aynısı. ⚠️ Mutlak sayılar 12–13.08 kayıtlarıyla AYNI DEĞİLDİR (o gün pay
 * ATAMA ekseninden geliyordu); ağırlık senaryoları arası KARŞILAŞTIRMA geçerli
 * kalır, çünkü eksen tüm senaryolarda aynıdır.
 */
const shiftWindows = shiftWindowsForScoring(shiftKmRes);
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const gecenGun = rangeElapsedDays(range);

const olayliWorker = new Set();
for (const e of events) {
  const wid = shiftWindows
    ? workerDrivingAt(shiftWindows, e.vehicle_id, e.occurred_at)
    : vehiclesById.get(e.vehicle_id)?.assigned_worker_id ?? null;
  if (wid) olayliWorker.add(wid);
}
const vardiyaliWorker = new Set(entries.map((e) => e.worker_id).filter(Boolean));
const raporda = (rows) => rows.filter((r) => vardiyaliWorker.has(r.workerId) || olayliWorker.has(r.workerId));

const esikFn = (vehicleIds, workerId) =>
  SCORE_THRESHOLD_WORKED_DAYS && (workedDaysByWorker.get(workerId) ?? 0) > 0
    ? scoreMinKmForWorkedDays(range, workedDaysByWorker.get(workerId))
    : scoreMinKmForSpan(range, vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null }));

function skorla(agirliklar) {
  const eski = { ...SAFETY_SCORE_WEIGHTS };
  Object.assign(SAFETY_SCORE_WEIGHTS, agirliklar);
  try {
    return raporda(
      computeSafetyScores(events, idleEpisodes, vehiclesById, workersById, distanceByVehicle, esikFn, drivenVehicles, shiftKm, shiftWindows)
    );
  } finally {
    Object.assign(SAFETY_SCORE_WEIGHTS, eski);
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

// ══ 1. OLAY ORANLARI ═════════════════════════════════════════════════════
console.log(`\n── 1. TEMİZ PENCEREDE OLAY ORANLARI ──`);
const sayim = {};
for (const e of events) sayim[e.event_type] = (sayim[e.event_type] ?? 0) + 1;
sayim.idling = idleEpisodes.length;
const aktifArac = new Set([...events.map((e) => e.vehicle_id), ...idleEpisodes.map((e) => e.vehicle_id)]).size || 1;
const aracGun = aktifArac * gecenGun;
const toplamOlay = Object.values(sayim).reduce((a, b) => a + b, 0);
console.log(`  ${aktifArac} araç × ${gecenGun} gün = ${aracGun} araç-gün · toplam ${toplamOlay} olay`);
console.log(`\n  ${"tip".padEnd(20)}${"sayı".padStart(7)}${"araç-gün".padStart(10)}${"pay".padStart(8)}${"frene oran".padStart(11)}`);
const fren = sayim.harsh_braking || 1;
for (const [t, c] of Object.entries(sayim).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(20)}${n(c, 7)}${n(f(c / aracGun), 10)}${n("%" + f((c / toplamOlay) * 100, 1), 8)}${n(f(c / fren) + "×", 11)}`);
}

// ══ 2. AĞIRLIK ÖNERİSİ ═══════════════════════════════════════════════════
console.log(`\n── 2. AĞIRLIK TÜRETİMİ ──`);
console.log(`  İLKE: bir tipin ceza içindeki PAYI, ne kadar SIK tetiklendiğine değil`);
console.log(`        ne kadar TEHLİKELİ olduğuna göre belirlenmeli. Frekans cihaz`);
console.log(`        eşiğinin sonucudur (bir konfigürasyon kararı), güvenlik yargısı değil.`);
console.log(`        ağırlık_t = k × şiddet_t / sayı_t   ·   k: toplam ceza ölçeğini KORUR`);
console.log(`        (K=${SAFETY_SCORE_K} kalibrasyonu ancak toplam ölçek sabit kalırsa geçerli kalır)`);

const mevcutToplamCeza = Object.entries(sayim).reduce((a, [t, c]) => a + c * (YURURLUK[t] ?? 0), 0);
/**
 * SEYREK TİP KORUMASI: ters-frekans, az görülen tipin ağırlığını uçurur —
 * tek bir jamming olayı skoru silerdi. Sayısı MIN_ORNEK altındaki tipler
 * yeniden ölçeklenmez, şiddet ağırlığını KORUR.
 */
const MIN_ORNEK = 50;
const olcekli = Object.keys(sayim).filter((t) => sayim[t] >= MIN_ORNEK);
const seyrek = Object.keys(sayim).filter((t) => sayim[t] < MIN_ORNEK);
const seyrekCeza = seyrek.reduce((a, t) => a + sayim[t] * (YURURLUK[t] ?? 0), 0);
const k = (mevcutToplamCeza - seyrekCeza) / olcekli.reduce((a, t) => a + SIDDET[t], 0);
const oneri = { ...YURURLUK };
for (const t of olcekli) oneri[t] = Math.max(1, Math.round((k * SIDDET[t]) / sayim[t]));
console.log(`\n  ölçeklenen tipler (≥${MIN_ORNEK} olay): ${olcekli.join(", ")}`);
console.log(`  seyrek → şiddet ağırlığı KORUNUR: ${seyrek.length ? seyrek.map((t) => `${t}(${sayim[t]})`).join(", ") : "yok"}`);
console.log(`\n  ${"tip".padEnd(20)}${"sayı".padStart(7)}${"şiddet".padStart(8)}${"yürürlük".padStart(9)}${"ÖNERİ".padStart(7)}${"pay ö→s".padStart(15)}`);
const payi = (ag) => {
  const top = Object.entries(sayim).reduce((a, [t, c]) => a + c * (ag[t] ?? 0), 0);
  return (t) => (sayim[t] * (ag[t] ?? 0)) / top;
};
const payY = payi(YURURLUK), payO = payi(oneri);
for (const t of Object.keys(sayim).sort((a, b) => sayim[b] - sayim[a])) {
  console.log(
    `  ${t.padEnd(20)}${n(sayim[t], 7)}${n(SIDDET[t] ?? "—", 8)}${n(YURURLUK[t] ?? "—", 9)}${n(oneri[t] ?? "—", 7)}` +
      `${n(`%${f(payY(t) * 100, 1)} → %${f(payO(t) * 100, 1)}`, 15)}`
  );
}
const yeniToplam = Object.entries(sayim).reduce((a, [t, c]) => a + c * (oneri[t] ?? 0), 0);
console.log(`\n  toplam ceza ölçeği: ${mevcutToplamCeza} → ${yeniToplam}  (%${f(((yeniToplam / mevcutToplamCeza) - 1) * 100, 1)} sapma — K geçerli kalsın diye ~0 hedeflendi)`);

// ══ 3. SKORLAR ═══════════════════════════════════════════════════════════
const rowsY = skorla(YURURLUK);
const rowsO = skorla(oneri);
const oY = ozet(rowsY), oO = ozet(rowsO);
console.log(`\n── 3. SKORLAR (temiz pencere) ──`);
console.log(`  ${"senaryo".padEnd(34)}${"skorlanan".padStart(10)}${"ort".padStart(5)}${"min–max".padStart(9)}`);
console.log(`  ${`YÜRÜRLÜK (hızlanma ${YURURLUK.harsh_acceleration})`.padEnd(34)}${n(`${oY.skorlanan}/${oY.toplam}`, 10)}${n(oY.ort ?? "—", 5)}${n(`${oY.min ?? "—"}–${oY.max ?? "—"}`, 9)}`);
console.log(`  ${`ÖNERİ (${olcekli.map((t) => `${t.replace("harsh_", "")[0]}${oneri[t]}`).join("/")})`.padEnd(34)}${n(`${oO.skorlanan}/${oO.toplam}`, 10)}${n(oO.ort ?? "—", 5)}${n(`${oO.min ?? "—"}–${oO.max ?? "—"}`, 9)}`);

// ══ 4. SIRALAMA ══════════════════════════════════════════════════════════
const sira = (rows) => new Map(rows.filter((r) => r.score !== null).map((r, i) => [r.workerId, i + 1]));
const sY = sira(rowsY), sO = sira(rowsO);
const yById = new Map(rowsY.map((r) => [r.workerId, r]));
const skorluO = rowsO.filter((r) => r.score !== null);
const yaz = (r) => {
  const y = yById.get(r.workerId);
  const a = sY.get(r.workerId) ?? null, b = sO.get(r.workerId);
  const d = a === null ? null : a - b;
  console.log(
    `  ${n(b, 4)}. ${r.name.slice(0, 8).padEnd(9)}${n(Math.round(r.distanceKm ?? 0), 6)}km` +
      `${n(y?.score ?? "—", 6)} → ${n(r.score, 4)}${n(a ?? "—", 6)} → ${n(b, 4)}  ${d === null ? "YENİ" : d > 0 ? "▲" + d : d < 0 ? "▼" + -d : "  ="}`
  );
};
console.log(`\n── 4. SIRALAMA (öneri sırasına göre) ──`);
console.log(`  ${"".padEnd(15)}${"km".padStart(8)}${"skor y→ö".padStart(13)}${"sıra y→ö".padStart(14)}`);
console.log(`  İLK 5`);
for (const r of skorluO.slice(0, 5)) yaz(r);
console.log(`  SON 5`);
for (const r of skorluO.slice(-5)) yaz(r);
{
  const h = skorluO.filter((r) => sY.has(r.workerId)).map((r) => sY.get(r.workerId) - sO.get(r.workerId));
  console.log(`\n  hareket: ${h.filter((x) => x > 0).length} yükseldi · ${h.filter((x) => x < 0).length} düştü · ${h.filter((x) => x === 0).length} yerinde · en büyük ${Math.max(0, ...h.map(Math.abs))} basamak`);
}

// ══ 5. PENCERE NE ZAMAN TEMİZLENİR ═══════════════════════════════════════
console.log(`\n── 5. 30 GÜNLÜK PENCERE NE ZAMAN TAMAMEN TEMİZ ──`);
{
  const ilkTemiz = startOfDayViennaFromYmd(TEMIZ_BAS);
  // Kayan pencere: start = bugün − 29 gün. start ≥ ilkTemiz olacak ilk gün.
  const hedef = viennaDayKey(addCalendarDaysVienna(ilkTemiz, 29));
  const kalan = Math.ceil((startOfDayViennaFromYmd(hedef).getTime() - startOfDayViennaFromYmd(bugun).getTime()) / 86400000);
  console.log(`  30 günlük kayan pencere = bugün − 29 gün.`);
  console.log(`  Pencerenin başı ${TEMIZ_BAS}'e ulaşacağı gün: ${hedef}  (bugünden ${kalan} gün sonra)`);
  console.log(`  O tarihe kadar "ay" görünümü ${Math.max(0, 29 - Math.floor((startOfDayViennaFromYmd(bugun).getTime() - ilkTemiz.getTime()) / 86400000))} gün kirli veri taşıyor.`);
}
console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir sabit değiştirilmedi ═══\n`);
