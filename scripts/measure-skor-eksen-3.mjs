#!/usr/bin/env node
/**
 * SKOR EKSEN DÜZELTMESİ — ÖNCE/SONRA. HİÇBİR ŞEY YAZMAZ.
 *
 * YÖNTEM: ÜRETİM `computeSafetyScores` İKİ KEZ, AYNI girdilerle çağrılır.
 * Değişen TEK ŞEY 9. argüman:
 *   ÖNCE  → shiftWindowsByVehicle YOK  (olaylar ATAMA ekseninde — eski davranış)
 *   SONRA → shiftWindowsByVehicle VAR  (olaylar VARDİYA ekseninde — düzeltme)
 * Yani buradaki hiçbir sayı ikinci bir formülden çıkmıyor; ÖNCE sütunu
 * düzeltmeden önceki canlı ekranın ta kendisidir.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-skor-eksen-3.mjs [gun]
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
} from "@/lib/analytics";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
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
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 17) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ SKOR EKSEN DÜZELTMESİ · ÖNCE/SONRA (yazma YOK) ════════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ pencere  ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);

// ── Üretim girdileri (Analiz sayfası loadPeriod ile birebir) ────────────────
const { vehicles, workers } = await listVehiclesAndWorkers();
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const scope = await getTestScope();
const driverScope = await getDriverScope();

const [events, idleEpisodes, spanEntries] = await Promise.all([
  listEventsInRange(startISO, endISO),
  listIdleEpisodesInRange(startISO, endISO),
  mapBounded(vehicles, async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)]),
]);
const distanceByVehicle = new Map(spanEntries.map(([id, s]) => [id, s.km]));
const spanByVehicle = new Map(spanEntries.map(([id, s]) => [id, { firstAt: s.firstAt, lastAt: s.lastAt }]));

const { data: entryData } = await fetchAllRows(
  (from, to) =>
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("id, worker_id, vehicle_id, started_at, ended_at")
          .gte("started_at", startISO)
          .lte("started_at", endISO)
          .order("started_at", { ascending: true })
          .order("id")
          .range(from, to),
        "worker_id",
        scope.workerIds
      ),
      "worker_id",
      driverScope
    ),
  "eksen3/time_entries"
);
const entries = entryData ?? [];
const workedDaysByWorker = workedDaysFromEntries(entries);
const drivenVehicles = drivenVehiclesFromEntries(entries);
const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
const shiftKm = shiftKmForScoring(shiftKmRes);
const shiftWindows = shiftWindowsForScoring(shiftKmRes);

console.log(`║ evren    ${vehicles.length} araç · ${workers.length} şoför · ${events.length} olay · ${idleEpisodes.length} rölanti`);
console.log(`║ 052      ${shiftKmRes.unavailable ?? "OK"} · km ${shiftKm?.size ?? "—"} şoför · pencere ${shiftWindows ? [...shiftWindows.values()].reduce((a, v) => a + v.length, 0) : "—"} vardiya / ${shiftWindows?.size ?? "—"} araç`);

const esikFn = (vehicleIds, workerId) =>
  SCORE_THRESHOLD_WORKED_DAYS && (workedDaysByWorker.get(workerId) ?? 0) > 0
    ? scoreMinKmForWorkedDays(range, workedDaysByWorker.get(workerId))
    : scoreMinKmForSpan(
        range,
        vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })
      );

/** ÜRETİM fonksiyonu. Tek fark: 9. argüman. */
const skorla = (pencere) =>
  computeSafetyScores(
    events, idleEpisodes, vehiclesById, workersById, distanceByVehicle,
    esikFn, drivenVehicles, shiftKm, pencere
  );

/** Rapora giren evren (lib/reports.ts satır kapısıyla aynı mantık). */
const olayliWorker = (pencere) => {
  const s = new Set();
  for (const e of events) {
    const wid = pencere
      ? workerDrivingAt(pencere, e.vehicle_id, e.occurred_at)
      : vehiclesById.get(e.vehicle_id)?.assigned_worker_id ?? null;
    if (wid) s.add(wid);
  }
  return s;
};
const vardiyaliWorker = new Set(entries.map((e) => e.worker_id).filter(Boolean));
const raporda = (rows, pencere) => {
  const ol = olayliWorker(pencere);
  return rows.filter((r) => vardiyaliWorker.has(r.workerId) || ol.has(r.workerId));
};

const oncekiTum = skorla(undefined);
const sonrakiTum = skorla(shiftWindows);
const onceki = raporda(oncekiTum, undefined);
const sonraki = raporda(sonrakiTum, shiftWindows);

const ozet = (rows) => {
  const s = rows.filter((r) => r.score !== null);
  return {
    skorlanan: s.length,
    toplam: rows.length,
    ort: s.length ? Math.round(s.reduce((a, r) => a + r.score, 0) / s.length) : null,
    min: s.length ? Math.min(...s.map((r) => r.score)) : null,
    max: s.length ? Math.max(...s.map((r) => r.score)) : null,
  };
};

// ══ 1. OLAY MUHASEBESİ ═══════════════════════════════════════════════════
console.log(`\n── 1. OLAY MUHASEBESİ (skorlanabilir olay = alarm + rölanti) ──`);
{
  let skorlanabilir = 0;
  for (const e of events) if (SAFETY_SCORE_WEIGHTS[e.event_type] !== undefined) skorlanabilir++;
  skorlanabilir += idleEpisodes.length;
  const topla = (rows) => rows.reduce((a, r) => a + r.totalEvents, 0);
  const cezaTop = (rows) => rows.reduce((a, r) => a + r.penalty, 0);
  const o = topla(oncekiTum), s = topla(sonrakiTum);
  console.log(`  skorlanabilir olay toplamı        ${n(skorlanabilir, 7)}`);
  console.log(`  ÖNCE  şoförlere yazılan (atama)   ${n(o, 7)}   ceza ${n(cezaTop(oncekiTum), 7)}`);
  console.log(`  SONRA şoförlere yazılan (vardiya) ${n(s, 7)}   ceza ${n(cezaTop(sonrakiTum), 7)}`);
  console.log(`  → SONRA sahipsiz kalan            ${n(skorlanabilir - s, 7)}  (%${(((skorlanabilir - s) / skorlanabilir) * 100).toFixed(1)})`);
  console.log(`  → ÖNCE sahipsiz kalan             ${n(skorlanabilir - o, 7)}  (%${(((skorlanabilir - o) / skorlanabilir) * 100).toFixed(1)})`);

  // Doğru şoföre TAŞINAN olay: atama ile vardiya farklı şoför diyor.
  let tasindi = 0, ayni = 0, dustu = 0, kazandi = 0;
  for (const e of [...events.filter((x) => SAFETY_SCORE_WEIGHTS[x.event_type] !== undefined)
    .map((x) => ({ v: x.vehicle_id, at: x.occurred_at })),
    ...idleEpisodes.map((x) => ({ v: x.vehicle_id, at: x.started_at }))]) {
    const a = vehiclesById.get(e.v)?.assigned_worker_id ?? null;
    const b = shiftWindows ? workerDrivingAt(shiftWindows, e.v, e.at) : null;
    if (a && b && a === b) ayni++;
    else if (a && b && a !== b) tasindi++;
    else if (a && !b) dustu++;
    else if (!a && b) kazandi++;
  }
  console.log(`  \n  olay olay kırılım:`);
  console.log(`     aynı şoförde kaldı              ${n(ayni, 7)}`);
  console.log(`     BAŞKA şoföre TAŞINDI            ${n(tasindi, 7)}  ← yanlış kişiden alınıp doğru kişiye verildi`);
  console.log(`     atamada vardı, vardiyada YOK    ${n(dustu, 7)}  ← sahipsiz kaldı`);
  console.log(`     atamada YOKTU, vardiyada var    ${n(kazandi, 7)}  ← atanmamış araç, vardiya sayesinde sahiplendi`);
}

// ══ 2. ÖZET ══════════════════════════════════════════════════════════════
console.log(`\n── 2. SKOR ÖZETİ ──`);
const oO = ozet(onceki), oS = ozet(sonraki);
console.log(`  ${"".padEnd(24)} ${"skorlanan".padStart(10)} ${"ort".padStart(4)} ${"min–max".padStart(9)}`);
console.log(`  ${"ÖNCE  (atama ekseni)".padEnd(24)} ${n(`${oO.skorlanan}/${oO.toplam}`, 10)} ${n(oO.ort ?? "—", 4)} ${n(`${oO.min ?? "—"}–${oO.max ?? "—"}`, 9)}`);
console.log(`  ${"SONRA (vardiya ekseni)".padEnd(24)} ${n(`${oS.skorlanan}/${oS.toplam}`, 10)} ${n(oS.ort ?? "—", 4)} ${n(`${oS.min ?? "—"}–${oS.max ?? "—"}`, 9)}`);

// ══ 3. ŞOFÖR ŞOFÖR DEĞİŞİM ═══════════════════════════════════════════════
const onceById = new Map(onceki.map((r) => [r.workerId, r]));
const sonraById = new Map(sonraki.map((r) => [r.workerId, r]));
const siraHaritasi = (rows) => new Map(rows.filter((r) => r.score !== null).map((r, i) => [r.workerId, i + 1]));
const sO = siraHaritasi(onceki), sS = siraHaritasi(sonraki);

console.log(`\n── 3. ŞOFÖR BAZINDA (skor değişimine göre) ──`);
console.log(`  ${ad("şoför")} ${n("olay ö→s", 12)} ${n("ceza ö→s", 13)} ${n("km", 6)} ${n("skor ö→s", 12)} ${n("Δ", 5)} ${n("sıra ö→s", 12)}`);
const hepsi = [...new Set([...onceById.keys(), ...sonraById.keys()])].map((id) => {
  const o = onceById.get(id), s = sonraById.get(id);
  const d = o?.score != null && s?.score != null ? s.score - o.score : null;
  return { id, o, s, d, ad: (s ?? o).name };
});
hepsi.sort((a, b) => Math.abs(b.d ?? -1) - Math.abs(a.d ?? -1) || (b.s?.score ?? -1) - (a.s?.score ?? -1));
let degisen = 0, enBuyuk = { ad: "—", d: 0 };
for (const h of hepsi) {
  if (h.d !== null && h.d !== 0) {
    degisen++;
    if (Math.abs(h.d) > Math.abs(enBuyuk.d)) enBuyuk = { ad: h.ad, d: h.d };
  }
  const oS_ = sO.get(h.id) ?? null, sS_ = sS.get(h.id) ?? null;
  console.log(
    `  ${ad(h.ad)} ${n(`${h.o?.totalEvents ?? "—"}→${h.s?.totalEvents ?? "—"}`, 12)} ${n(`${h.o?.penalty ?? "—"}→${h.s?.penalty ?? "—"}`, 13)} ${n(h.s?.distanceKm == null ? "—" : Math.round(h.s.distanceKm), 6)} ${n(`${h.o?.score ?? "—"}→${h.s?.score ?? "—"}`, 12)} ${n(h.d === null ? "—" : (h.d > 0 ? "+" : "") + h.d, 5)} ${n(`${oS_ ?? "—"}→${sS_ ?? "—"}`, 12)}`
  );
}
console.log(`\n  → skoru DEĞİŞEN şoför: ${degisen}  ·  en büyük değişim: ${enBuyuk.ad} ${enBuyuk.d > 0 ? "+" : ""}${enBuyuk.d} puan`);

// ══ 4. İLK 5 / SON 5 ═════════════════════════════════════════════════════
const skorlu = (rows) => rows.filter((r) => r.score !== null);
console.log(`\n── 4. SIRALAMA ──`);
const bas = (rows, sira, etiket) => {
  const s = skorlu(rows);
  console.log(`  ${etiket}  (${s.length} skorlanan)`);
  console.log(`     İLK 5: ${s.slice(0, 5).map((r, i) => `${i + 1}.${r.name.split(" ")[0]}(${r.score})`).join("  ")}`);
  console.log(`     SON 5: ${s.slice(-5).map((r, i) => `${s.length - 5 + i + 1}.${r.name.split(" ")[0]}(${r.score})`).join("  ")}`);
};
bas(onceki, sO, "ÖNCE  (atama ekseni) ");
bas(sonraki, sS, "SONRA (vardiya ekseni)");

// ══ 5. HAMDİ KURUBAŞ ═════════════════════════════════════════════════════
console.log(`\n── 5. VAKA: atanmış araçtan BAŞKASINI sürenler ──`);
for (const w of workersById.values()) {
  const atanmis = vehicles.filter((v) => v.assigned_worker_id === w.id).map((v) => v.plate).sort();
  const surulen = [...(drivenVehicles.get(w.id) ?? [])].map((id) => vehiclesById.get(id)?.plate ?? "?").sort();
  if (surulen.length === 0) continue;
  if (atanmis.join(",") === surulen.join(",")) continue;
  const o = onceById.get(w.id), s = sonraById.get(w.id);
  console.log(`\n  ${w.name}`);
  console.log(`     atanmış ${atanmis.join(",") || "—"}  ·  sürdüğü ${surulen.join(",")}`);
  console.log(`     olay ${o?.totalEvents ?? "—"} → ${s?.totalEvents ?? "—"}  ·  ceza ${o?.penalty ?? "—"} → ${s?.penalty ?? "—"}  ·  km ${s?.distanceKm == null ? "—" : Math.round(s.distanceKm)}`);
  console.log(`     SKOR ${o?.score ?? "—"} → ${s?.score ?? "—"}  ·  sıra ${sO.get(w.id) ?? "—"} → ${sS.get(w.id) ?? "—"}`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
