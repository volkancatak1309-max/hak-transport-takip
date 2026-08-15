#!/usr/bin/env node
/**
 * SKOR EKSEN UYUŞMAZLIĞI — ÖLÇÜM. HİÇBİR ŞEY YAZMAZ.
 *
 * SORU: computeSafetyScores'ta pay (olay/ceza) ile payda (km) FARKLI eksenden
 * geliyor mu, ve geliyorsa kaç şoförü ne kadar etkiliyor?
 *   · km      → shiftKmByWorker  (vardiya penceresi, migration 052)
 *   · olaylar → vehicles.assigned_worker_id (kağıt üzerindeki atama)
 *
 * Betik ÜRETİM sorgularının aynısını kurar (Analiz sayfası loadPeriod'u ile
 * birebir), sonra olayları İKİ ayrı eksende eşler ve farkı basar. Skor
 * hesabına dokunmaz — bu betik yalnız GİRDİYİ ölçer.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-skor-eksen.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  drivenVehiclesFromEntries,
  getWorkerShiftDistance,
  shiftKmForScoring,
  listVehiclesAndWorkers,
} from "@/lib/analytics";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

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
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 16) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ SKOR EKSEN UYUŞMAZLIĞI · ÖLÇÜM (yazma YOK) ════════════════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ pencere  ${GUN} gün · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);

// ── Üretim girdileri (Analiz sayfası loadPeriod ile birebir) ────────────────
const { vehicles, workers } = await listVehiclesAndWorkers();
const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
const workersById = new Map(workers.map((w) => [w.id, w]));
const scope = await getTestScope();
const driverScope = await getDriverScope();

const [events, idleEpisodes] = await Promise.all([
  listEventsInRange(startISO, endISO),
  listIdleEpisodesInRange(startISO, endISO),
]);

/**
 * VARDİYALAR — Analiz sayfası aralıkla KESİŞEN vardiyaları alır
 * (started_at <= end AND (ended_at is null OR ended_at >= start)).
 * Aynısı kuruluyor; ayrıca sayfalı okuma (1000 satır tavanı).
 */
const { data: entryData } = await fetchAllRows(
  (from, to) =>
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin
          .from("time_entries")
          .select("id, worker_id, vehicle_id, started_at, ended_at")
          .lte("started_at", endISO)
          .or(`ended_at.is.null,ended_at.gte.${startISO}`)
          .order("started_at", { ascending: true })
          .order("id")
          .range(from, to),
        "worker_id",
        scope.workerIds
      ),
      "worker_id",
      driverScope
    ),
  "measure-eksen/time_entries"
);
const entries = (entryData ?? []).filter((e) => e.worker_id && e.vehicle_id);
const drivenVehicles = drivenVehiclesFromEntries(entries);
const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
const shiftKm = shiftKmForScoring(shiftKmRes);

console.log(`║ evren    ${vehicles.length} araç · ${workers.length} şoför`);
console.log(`║ veri     ${events.length} olay · ${idleEpisodes.length} rölanti · ${entries.length} vardiya`);
console.log(`║ 052      ${shiftKmRes.unavailable ?? "OK"} · km haritası ${shiftKm ? shiftKm.size : "undefined"} şoför`);

// ══ 1. EKSEN 1: ATAMA (üretimin BUGÜNKÜ olay eşlemesi) ════════════════════
/** vehicle → assigned_worker_id (yalnız şoför evrenindeyse) */
const atananSofor = new Map();
for (const v of vehicles) {
  if (v.assigned_worker_id && workersById.has(v.assigned_worker_id)) {
    atananSofor.set(v.id, v.assigned_worker_id);
  }
}

// ══ 2. EKSEN 2: VARDİYA PENCERESİ ════════════════════════════════════════
/**
 * araç → o araçta açılmış vardiya pencereleri (başlangıç/bitiş ms).
 * ended_at null ise pencere aralık sonunda kapanır — 052'nin coalesce'ıyla aynı.
 */
const pencerelerByVehicle = new Map();
const endMs = Date.parse(endISO);
for (const e of entries) {
  const arr = pencerelerByVehicle.get(e.vehicle_id) ?? [];
  arr.push({
    workerId: e.worker_id,
    entryId: e.id,
    a: Date.parse(e.started_at),
    b: e.ended_at ? Date.parse(e.ended_at) : endMs,
  });
  pencerelerByVehicle.set(e.vehicle_id, arr);
}
for (const arr of pencerelerByVehicle.values()) arr.sort((x, y) => x.a - y.a);

/** Bir olayı vardiya penceresine eşle. Çakışma varsa hepsini döndür. */
function vardiyaEsle(vehicleId, iso) {
  const t = Date.parse(iso);
  const arr = pencerelerByVehicle.get(vehicleId) ?? [];
  return arr.filter((p) => t >= p.a && t <= p.b);
}

// ── Olayları tek listede topla (ceza ağırlığıyla) ──────────────────────────
const olaylar = [];
for (const e of events) {
  const w = SAFETY_SCORE_WEIGHTS[e.event_type];
  if (w === undefined) continue;
  olaylar.push({ vehicleId: e.vehicle_id, at: e.occurred_at, tip: e.event_type, agirlik: w });
}
for (const ep of idleEpisodes) {
  olaylar.push({
    vehicleId: ep.vehicle_id,
    at: ep.started_at,
    tip: "idling",
    agirlik: SAFETY_SCORE_WEIGHTS.idling ?? 0,
  });
}

// ══ 3. SORU 3 (ÖNCE): VARDİYA EŞLEMESİ TEKNİK OLARAK MÜMKÜN MÜ? ══════════
console.log(`\n── 3. VARDİYA EŞLEMESİ MÜMKÜN MÜ (olay zamanı × vardiya penceresi) ──`);
let esles0 = 0, esles1 = 0, eslesCok = 0;
let atamaVar = 0, atamaYok = 0;
const eslesmeyenPlaka = new Map();
for (const o of olaylar) {
  const m = vardiyaEsle(o.vehicleId, o.at);
  if (m.length === 0) {
    esles0++;
    const plate = vehiclesById.get(o.vehicleId)?.plate ?? o.vehicleId.slice(0, 8);
    eslesmeyenPlaka.set(plate, (eslesmeyenPlaka.get(plate) ?? 0) + 1);
  } else if (m.length === 1) esles1++;
  else eslesCok++;
  if (atananSofor.has(o.vehicleId)) atamaVar++;
  else atamaYok++;
}
const T = olaylar.length;
const pct = (x) => `%${((x / Math.max(1, T)) * 100).toFixed(1)}`;
console.log(`  toplam skorlanabilir olay: ${T}  (${events.length} alarm + ${idleEpisodes.length} rölanti)`);
console.log(`  VARDİYA ekseni : ${n(esles1)} tek eşleşme ${pct(esles1)} · ${n(eslesCok)} ÇOK eşleşme ${pct(eslesCok)} · ${n(esles0)} eşleşmedi ${pct(esles0)}`);
console.log(`  ATAMA  ekseni  : ${n(atamaVar)} atanmış araç ${pct(atamaVar)} · ${n(atamaYok)} atanmamış ${pct(atamaYok)}`);
if (eslesmeyenPlaka.size) {
  console.log(`  → vardiyasız olayların araç dağılımı (ilk 12):`);
  for (const [p, c] of [...eslesmeyenPlaka].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${ad(p, 12)} ${n(c)}`);
  }
}

// ══ 4. SORU 1: KAÇ ŞOFÖR ETKİLENİYOR ═════════════════════════════════════
/** Şoför → { atamaCeza, atamaOlay } (üretimin BUGÜNKÜ hesabı) */
const atamaAcc = new Map();
/** Şoför → { vardiyaCeza, vardiyaOlay } (düzeltilmiş eksen) */
const vardiyaAcc = new Map();
let sahipsizCeza = 0, sahipsizOlay = 0;

const bump = (m, wid, agirlik) => {
  const c = m.get(wid) ?? { ceza: 0, olay: 0 };
  c.ceza += agirlik;
  c.olay += 1;
  m.set(wid, c);
};

for (const o of olaylar) {
  // ATAMA ekseni — computeSafetyScores'un bugün yaptığı
  const aw = atananSofor.get(o.vehicleId);
  if (aw) bump(atamaAcc, aw, o.agirlik);

  // VARDİYA ekseni — çakışma varsa İLK (en erken başlayan) vardiya sahibine.
  const m = vardiyaEsle(o.vehicleId, o.at);
  if (m.length === 0) {
    sahipsizCeza += o.agirlik;
    sahipsizOlay += 1;
  } else {
    const sahip = m[0].workerId;
    if (workersById.has(sahip)) bump(vardiyaAcc, sahip, o.agirlik);
    else {
      sahipsizCeza += o.agirlik;
      sahipsizOlay += 1;
    }
  }
}

console.log(`\n── 1+2. ŞOFÖR BAZINDA EKSEN FARKI (30 gün) ──`);
console.log(`  ${ad("şoför")} ${n("atama", 7)} ${n("vardiya", 8)} ${n("fark", 6)} ${n("km", 7)}  atanmış araç → fiilen sürülen`);
const satirlar = [];
for (const w of workersById.values()) {
  const a = atamaAcc.get(w.id) ?? { ceza: 0, olay: 0 };
  const v = vardiyaAcc.get(w.id) ?? { ceza: 0, olay: 0 };
  const km = shiftKm?.get(w.id) ?? null;
  const atanmis = vehicles.filter((x) => x.assigned_worker_id === w.id).map((x) => x.plate);
  const surulen = [...(drivenVehicles.get(w.id) ?? [])]
    .map((id) => vehiclesById.get(id)?.plate ?? id.slice(0, 8))
    .sort();
  if (a.olay === 0 && v.olay === 0 && km == null) continue;
  satirlar.push({ w, a, v, km, atanmis, surulen });
}
satirlar.sort((x, y) => Math.abs(y.v.olay - y.a.olay) - Math.abs(x.v.olay - x.a.olay));
let etkilenen = 0;
for (const s of satirlar) {
  const fark = s.v.olay - s.a.olay;
  if (fark !== 0) etkilenen++;
  const uyusmaz =
    s.atanmis.join(",") !== s.surulen.join(",") ? " ⚠" : "  ";
  console.log(
    `  ${ad(s.w.name)} ${n(s.a.olay, 7)} ${n(s.v.olay, 8)} ${n(fark > 0 ? "+" + fark : fark, 6)} ${n(s.km == null ? "—" : Math.round(s.km), 7)}${uyusmaz}${(s.atanmis.join(",") || "—")} → ${surulenKisa(s.surulen)}`
  );
}
function surulenKisa(arr) {
  if (arr.length === 0) return "—";
  if (arr.length <= 4) return arr.join(",");
  return `${arr.slice(0, 4).join(",")}+${arr.length - 4}`;
}
console.log(`\n  → olay sayısı DEĞİŞEN şoför: ${etkilenen}/${satirlar.length}`);
console.log(`  → sahipsiz kalan (hiçbir vardiyaya düşmeyen): ${sahipsizOlay} olay · ${sahipsizCeza} ceza puanı`);

// ══ 5. TERS DURUM: başkasının ihlalini yiyen ═════════════════════════════
console.log(`\n── 2b. TERS DURUM: atama ekseninde BAŞKASININ olayını yiyen ──`);
/**
 * Bir araçtaki olay, ATAMA'ya göre A'ya yazılıyor ama VARDİYA'ya göre B'nin
 * penceresinde. Yani A, B'nin ihlalini yiyor.
 */
const yanlisAtif = new Map(); // `${atananW}|${gercekW}|${plate}` → sayı
for (const o of olaylar) {
  const aw = atananSofor.get(o.vehicleId);
  const m = vardiyaEsle(o.vehicleId, o.at);
  const gw = m.length ? m[0].workerId : null;
  if (!aw || !gw) continue;
  if (aw === gw) continue;
  const plate = vehiclesById.get(o.vehicleId)?.plate ?? "?";
  const k = `${aw}|${gw}|${plate}`;
  yanlisAtif.set(k, (yanlisAtif.get(k) ?? 0) + 1);
}
if (yanlisAtif.size === 0) console.log("  (yok)");
for (const [k, c] of [...yanlisAtif].sort((a, b) => b[1] - a[1])) {
  const [awid, gwid, plate] = k.split("|");
  console.log(
    `  ${ad(workersById.get(awid)?.name ?? "?")} ← ${n(c, 4)} olay, gerçekte ${ad(workersById.get(gwid)?.name ?? "?")} (${plate})`
  );
}

// ══ 6. HAMDİ KUR (canlı örnek) DETAY ═════════════════════════════════════
console.log(`\n── ÖRNEK VAKA DETAYI ──`);
for (const s of satirlar.slice(0, 3)) {
  console.log(`\n  ${s.w.name}`);
  console.log(`     atanmış:  ${s.atanmis.join(",") || "—"}`);
  console.log(`     sürdüğü:  ${s.surulen.join(",") || "—"}`);
  console.log(`     olay atama ekseninde ${s.a.olay} (ceza ${s.a.ceza}) → vardiya ekseninde ${s.v.olay} (ceza ${s.v.ceza})`);
  console.log(`     km (052): ${s.km == null ? "—" : Math.round(s.km)}`);
  // araç kırılımı
  const kir = new Map();
  for (const o of olaylar) {
    const m = vardiyaEsle(o.vehicleId, o.at);
    if (m.length && m[0].workerId === s.w.id) {
      const p = vehiclesById.get(o.vehicleId)?.plate ?? "?";
      kir.set(p, (kir.get(p) ?? 0) + 1);
    }
  }
  if (kir.size) {
    console.log(`     vardiya ekseni araç kırılımı: ${[...kir].map(([p, c]) => `${p}×${c}`).join(" · ")}`);
  }
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
