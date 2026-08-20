#!/usr/bin/env node
/**
 * SAHİPSİZ OLAY — TANIM ÖLÇÜMÜ. HİÇBİR ŞEY YAZMAZ.
 *
 * SORU: "sahipsiz olay" kaç tane? Cevap TANIMA bağlı ve iki eski ölçüm iki
 * farklı sayı verdi (measure-skor-eksen.mjs → ~1.9k, measure-skor-eksen-3.mjs
 * → ~0.9k). Ekrana YAZILACAK sayı, panelin KPI'ında yazan "toplam olay" ile
 * skor tablosunun topladığı sayının FARKI olmak zorunda; başka her tanım
 * "sessiz eksik"i kapatmak yerine yerini değiştirir.
 *
 * Bu betik Analiz sayfasının `loadPeriod`unu birebir kurar ve BÜTÜN kovaları
 * tek tabloda sayar ki fark nereden geliyorsa görünsün.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-sahipsiz-olay.mjs [gun]
 */
import { supabaseAdmin } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  computeSafetyScores,
  computeTopDriversByType,
  drivenVehiclesFromEntries,
  workedDaysFromEntries,
  getWorkerShiftDistance,
  shiftKmForScoring,
  shiftWindowsForScoring,
  workerDrivingAt,
  scoreMinKmForSpan,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
} from "@/lib/analytics";
import { SAFETY_SCORE_WEIGHTS, TOP10_EVENT_TYPES } from "@/lib/analytics-shared";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { mapBounded } from "@/lib/db-fanout";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const ARG = process.argv[2] ?? "30";
const GUN = ARG === "tum" ? "tum" : Number(ARG);
const range =
  GUN === "tum"
    ? computeAnalyticsRange("tumzaman")
    : GUN === 30
      ? computeAnalyticsRange("ay")
      : GUN === 7
        ? computeAnalyticsRange("hafta")
        : {
            start: addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1)),
            end: computeAnalyticsRange("gun").end,
          };
const startISO = range.start.toISOString();
const endISO = range.end.toISOString();

console.log(`\n╔══ SAHİPSİZ OLAY · TANIM ÖLÇÜMÜ (yazma YOK) ══════════════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ pencere  ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);

const { vehicles, workers } = await listVehiclesAndWorkers();
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const testScope = await getTestScope();

const [events, idleEpisodes, entryRes] = await Promise.all([
  listEventsInRange(startISO, endISO),
  listIdleEpisodesInRange(startISO, endISO),
  withoutTestRows(
    supabaseAdmin
      .from("time_entries")
      .select("worker_id, vehicle_id, started_at")
      .lte("started_at", endISO)
      .or(`ended_at.is.null,ended_at.gte.${startISO}`),
    "worker_id",
    testScope.workerIds
  ),
]);
const rangeEntryRows = entryRes.data ?? [];
const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
const shiftWindowsByVehicle = shiftWindowsForScoring(shiftKmRes);
const spanEntries = await mapBounded(vehicles, async (v) => [
  v.id,
  await getVehicleDistanceSpan(v.id, startISO, endISO),
]);
const spanByVehicle = new Map(spanEntries);
const distanceByVehicle = new Map([...spanByVehicle].map(([id, s]) => [id, s.km]));

console.log(`║ evren    ${vehicles.length} araç · ${workers.length} şoför · ${events.length} alarm · ${idleEpisodes.length} rölanti`);
console.log(`║ 052      ${shiftKmRes.unavailable ?? "OK"} · pencere ${shiftWindowsByVehicle ? [...shiftWindowsByVehicle.values()].reduce((a, b) => a + b.length, 0) : 0} vardiya\n`);

// ── 1. ALARM TÜR DÖKÜMÜ ────────────────────────────────────────────────────
const turSayi = new Map();
for (const e of events) turSayi.set(e.event_type, (turSayi.get(e.event_type) ?? 0) + 1);
console.log("── 1. ALARM TÜRLERİ (listEventsInRange ham) ──");
const TOP = new Set(TOP10_EVENT_TYPES);
let top10Alarm = 0;
let agirlikliAlarm = 0;
let idlingAlarmSatiri = 0;
for (const [ty, n] of [...turSayi].sort((a, b) => b[1] - a[1])) {
  const inTop = TOP.has(ty);
  const w = SAFETY_SCORE_WEIGHTS[ty];
  if (inTop && ty !== "idling") top10Alarm += n;
  if (w !== undefined) agirlikliAlarm += n;
  if (ty === "idling") idlingAlarmSatiri += n;
  console.log(
    `   ${String(ty).padEnd(22)} ${String(n).padStart(6)}   top10=${inTop ? "E" : "H"}  ağırlık=${w ?? "—"}`
  );
}
console.log(`   ${"".padEnd(22)} ${"".padStart(6)}`);
console.log(`   TOP10 alarm (idling hariç)   ${String(top10Alarm).padStart(6)}`);
console.log(`   ağırlığı OLAN alarm          ${String(agirlikliAlarm).padStart(6)}`);
console.log(`   ⚠️ events içinde 'idling'     ${String(idlingAlarmSatiri).padStart(6)}  (skor sayar, KPI saymaz)`);
console.log(`   rölanti epizodu              ${String(idleEpisodes.length).padStart(6)}`);

// ── 2. PANEL KPI'ı ─────────────────────────────────────────────────────────
const topByType = computeTopDriversByType(events, idleEpisodes, vehiclesById, workersById);
const kpiToplam = TOP10_EVENT_TYPES.reduce((a, ty) => a + (topByType[ty]?.total ?? 0), 0);
console.log(`\n── 2. PANEL KPI "toplam olay" ──`);
for (const ty of TOP10_EVENT_TYPES) console.log(`   ${ty.padEnd(22)} ${String(topByType[ty]?.total ?? 0).padStart(6)}`);
console.log(`   ${"TOPLAM".padEnd(22)} ${String(kpiToplam).padStart(6)}  ← ekranda yazan sayı`);

// ── 3. SKOR EKSENİNDE ATIF ─────────────────────────────────────────────────
// computeSafetyScores'un İÇİNDEKİ kuralın aynısı, ama her kova ayrı sayılıyor.
let skorlanabilir = 0;
let sahipli = 0;
let sahipsiz = 0;
let sahipVarKadroDisi = 0;
const sahipsizArac = new Map();
const say = (vehicleId, atISO) => {
  skorlanabilir++;
  const wid = workerDrivingAt(shiftWindowsByVehicle, vehicleId, atISO);
  if (!wid) {
    sahipsiz++;
    sahipsizArac.set(vehicleId, (sahipsizArac.get(vehicleId) ?? 0) + 1);
    return;
  }
  if (!workersById.has(wid)) {
    sahipVarKadroDisi++;
    return;
  }
  sahipli++;
};
for (const e of events) {
  if (SAFETY_SCORE_WEIGHTS[e.event_type] === undefined) continue;
  say(e.vehicle_id, e.occurred_at);
}
for (const ep of idleEpisodes) say(ep.vehicle_id, ep.started_at);

// ── 4. ÜRETİM computeSafetyScores'un TOPLADIĞI ─────────────────────────────
const rows = computeSafetyScores(
  events,
  idleEpisodes,
  vehiclesById,
  workersById,
  distanceByVehicle,
  (vids) => scoreMinKmForSpan(range, vids.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })),
  drivenVehiclesFromEntries(rangeEntryRows),
  shiftKmForScoring(shiftKmRes),
  shiftWindowsByVehicle
);
const rowToplam = rows.reduce((a, r) => a + r.totalEvents, 0);

console.log(`\n── 3. SKOR EKSENİNDE ATIF ──`);
console.log(`   skorlanabilir olay           ${String(skorlanabilir).padStart(6)}`);
console.log(`   → bir şoföre YAZILAN         ${String(sahipli).padStart(6)}`);
console.log(`   → sahibi var ama KADRO DIŞI  ${String(sahipVarKadroDisi).padStart(6)}  (workersById'de yok)`);
console.log(`   → SAHİPSİZ                   ${String(sahipsiz).padStart(6)}`);
console.log(`   üretim satırlarının toplamı  ${String(rowToplam).padStart(6)}  (Σ row.totalEvents)`);
console.log(`   ✔ yazılan == Σ row.totalEvents ? ${sahipli === rowToplam ? "EVET" : "HAYIR ✗"}`);

console.log(`\n── 4. KİMLİK DENETİMİ ──`);
console.log(`   KPI toplam                   ${String(kpiToplam).padStart(6)}`);
console.log(`   skorlanabilir                ${String(skorlanabilir).padStart(6)}`);
console.log(`   fark (KPI − skorlanabilir)   ${String(kpiToplam - skorlanabilir).padStart(6)}`);
console.log(`   yazılan + sahipsiz + kadroDışı = ${sahipli + sahipsiz + sahipVarKadroDisi}`);
console.log(`   ✔ skorlanabilir == yazılan+sahipsiz+kadroDışı ? ${skorlanabilir === sahipli + sahipsiz + sahipVarKadroDisi ? "EVET" : "HAYIR ✗"}`);
console.log(`   ✔ KPI == yazılan + sahipsiz ? ${kpiToplam === sahipli + sahipsiz ? "EVET" : `HAYIR (fark ${kpiToplam - sahipli - sahipsiz})`}`);

// ── 5. ESKİ ÖLÇÜMÜN TANIMI (measure-skor-eksen.mjs) ────────────────────────
// O betik ATAMA ekseniyle kıyaslarken "hiçbir pencereye düşmeyen" olayı
// ağırlık süzgeci UYGULAMADAN sayıyordu. Farkı göstermek için ikisini de bas.
let pencereyeDusmeyenHam = 0;
for (const e of events) {
  if (!workerDrivingAt(shiftWindowsByVehicle, e.vehicle_id, e.occurred_at)) pencereyeDusmeyenHam++;
}
for (const ep of idleEpisodes) {
  if (!workerDrivingAt(shiftWindowsByVehicle, ep.vehicle_id, ep.started_at)) pencereyeDusmeyenHam++;
}
console.log(`\n── 5. TANIM FARKI ──`);
console.log(`   ağırlık süzgeci UYGULANMADAN sahipsiz  ${String(pencereyeDusmeyenHam).padStart(6)}`);
console.log(`   ağırlık süzgeciyle sahipsiz            ${String(sahipsiz).padStart(6)}`);
console.log(`   fark = ağırlıksız alarm türleri        ${String(pencereyeDusmeyenHam - sahipsiz).padStart(6)}`);

// ── 6. ARAÇ KIRILIMI ───────────────────────────────────────────────────────
console.log(`\n── 6. SAHİPSİZ OLAY · ARAÇ KIRILIMI (ilk 10) ──`);
const kirilim = [...sahipsizArac]
  .map(([vid, adet]) => ({
    plate: vehiclesById.get(vid)?.plate ?? "(bilinmeyen)",
    adet,
    vardiyaSayisi: (shiftWindowsByVehicle?.get(vid) ?? []).length,
    atanmis: vehiclesById.get(vid)?.assigned_worker_id
      ? (workersById.get(vehiclesById.get(vid).assigned_worker_id)?.name ?? "?")
      : "—",
  }))
  .sort((a, b) => b.adet - a.adet);
console.log(`   plaka        sahipsiz  aralıktaki vardiya  atanmış şoför`);
for (const r of kirilim.slice(0, 10)) {
  console.log(`   ${r.plate.padEnd(12)} ${String(r.adet).padStart(8)}  ${String(r.vardiyaSayisi).padStart(18)}  ${r.atanmis}`);
}
console.log(`   → sahipsiz olay üreten araç sayısı: ${kirilim.length}`);
console.log(`   → ilk 5'in payı: ${kirilim.slice(0, 5).reduce((a, b) => a + b.adet, 0)} / ${sahipsiz}`);

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ══════════════════════════\n`);
