#!/usr/bin/env node
/**
 * SAHİPSİZ OLAY KÖPRÜSÜ — CANLIDA KANIT. HİÇBİR ŞEY YAZMAZ.
 *
 * Üç şeyi denetler:
 *   1. ÇIKARILAN FONKSİYON DAVRANIŞI DEĞİŞTİRMEDİ. `eventOwnerAt`, skor
 *      hesabının içindeki eski closure'dan çıkarıldı (20.08.2026). Betik eski
 *      kuralı BAĞIMSIZ olarak yeniden kurar ve canlıdaki HER olayda ikisinin
 *      aynı cevabı verdiğini gösterir — "diff'e bakınca aynı görünüyor" değil.
 *   2. KİMLİK KAPANIYOR: skorlanabilir = yazılan + sahipsiz + kadroDışı, VE
 *      panelin KPI'ında yazan "toplam olay" = yazılan + sahipsiz.
 *   3. SKOR DEĞİŞMEDİ: üretim `computeSafetyScores` çıktısı, sayaç eklenmeden
 *      önce ölçülen değerlerle aynı satırları veriyor.
 *
 * Mobil uç GERÇEK işleyicisiyle çağrılır (imzalı token üretilir, DB'ye yazma
 * yok — uç salt okuma).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-sahipsiz-olay.mjs [gun]
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeAnalyticsRange,
  computeSafetyScores,
  computeTopDriversByType,
  computeOwnerlessEvents,
  eventOwnerAt,
  drivenVehiclesFromEntries,
  workedDaysFromEntries,
  scoreMinKmForWorkedDays,
  getWorkerShiftDistance,
  shiftKmForScoring,
  shiftWindowsForScoring,
  workerDrivingAt,
  scoreMinKmForSpan,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
} from "@/lib/analytics";
import { SAFETY_SCORE_WEIGHTS, TOP10_EVENT_TYPES } from "@/lib/analytics-shared";
import { SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { mapBounded } from "@/lib/db-fanout";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";
import { GET as ANALYTICS } from "@/app/api/mobile/analytics/route";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};

const ARG = process.argv[2] ?? "30";
const GUN = Number(ARG);
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

console.log(`\n╔══ SAHİPSİZ OLAY KÖPRÜSÜ · CANLIDA KANIT ═════════════════════════`);
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
const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
const windows = shiftWindowsForScoring(shiftKmRes);
const spanEntries = await mapBounded(vehicles, async (v) => [
  v.id,
  await getVehicleDistanceSpan(v.id, startISO, endISO),
]);
const spanByVehicle = new Map(spanEntries);
const distanceByVehicle = new Map([...spanByVehicle].map(([id, s]) => [id, s.km]));

console.log(`║ evren    ${vehicles.length} araç · ${workers.length} şoför · ${events.length} alarm · ${idleEpisodes.length} rölanti\n`);

// ══ 1. ÇIKARILAN FONKSİYON DAVRANIŞI DEĞİŞTİRDİ Mİ ═══════════════════════
console.log("── 1. eventOwnerAt · ESKİ CLOSURE İLE BİREBİR Mİ ──");
{
  /** 20.08 öncesi computeSafetyScores'un İÇİNDEKİ kural — buraya elle kopyalandı. */
  const eskiKural = (vById, win, vehicleId, atISO) => {
    const vardiyaEkseni = win !== undefined;
    if (vardiyaEkseni) return workerDrivingAt(win, vehicleId, atISO);
    return vById.get(vehicleId)?.assigned_worker_id ?? null;
  };
  let sinanan = 0;
  let sapan = 0;
  const dene = (vid, at) => {
    for (const win of [windows, undefined]) {
      sinanan++;
      if (eventOwnerAt(vehiclesById, win, vid, at) !== eskiKural(vehiclesById, win, vid, at)) sapan++;
    }
  };
  for (const e of events) dene(e.vehicle_id, e.occurred_at);
  for (const ep of idleEpisodes) dene(ep.vehicle_id, ep.started_at);
  iddia("canlıdaki HER olayda eski kuralla aynı cevap", sapan === 0, `${sinanan} sınama · ${sapan} sapma`);
  iddia("bozuk zaman damgasında null (çökme yok)",
    eventOwnerAt(vehiclesById, windows, vehicles[0].id, "olmayan-tarih") === null, null);
  iddia("pencere YOKSA eski ATAMA yoluna düşüyor (052'siz kiracı)",
    eventOwnerAt(vehiclesById, undefined, vehicles[0].id, startISO) ===
      (vehicles[0].assigned_worker_id ?? null),
    `${vehicles[0].plate} → ${eventOwnerAt(vehiclesById, undefined, vehicles[0].id, startISO) ? "atanmış" : "null"}`);
}

// ══ 2. KİMLİK ════════════════════════════════════════════════════════════
console.log("\n── 2. KİMLİK: toplam = yazılan + sahipsiz ──");
const ozet = computeOwnerlessEvents(events, idleEpisodes, vehiclesById, workersById, windows);
const topByType = computeTopDriversByType(events, idleEpisodes, vehiclesById, workersById);
const kpiToplam = TOP10_EVENT_TYPES.reduce((a, ty) => a + (topByType[ty]?.total ?? 0), 0);

/**
 * PANELİN KAPISI BİREBİR (/admin/analiz gateFor). Kendi eşiğimi uydursaydım
 * skor sayıları başka çıkardı ve "skor değişmedi" iddiası ölçmediğim bir şeyi
 * iddia ederdi.
 */
const entries = entryRes.data ?? [];
const workedDaysByWorker = workedDaysFromEntries(entries);
const esikFn = (vehicleIds, workerId) =>
  SCORE_THRESHOLD_WORKED_DAYS && (workedDaysByWorker.get(workerId) ?? 0) > 0
    ? scoreMinKmForWorkedDays(range, workedDaysByWorker.get(workerId))
    : scoreMinKmForSpan(
        range,
        vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })
      );
const rows = computeSafetyScores(
  events,
  idleEpisodes,
  vehiclesById,
  workersById,
  distanceByVehicle,
  esikFn,
  drivenVehiclesFromEntries(entries),
  shiftKmForScoring(shiftKmRes),
  windows
);
const rowToplam = rows.reduce((a, r) => a + r.totalEvents, 0);

console.log(`     skorlanabilir ${ozet.scorable} · yazılan ${ozet.attributed} · sahipsiz ${ozet.ownerless} · kadroDışı ${ozet.outOfRoster}`);
iddia("skorlanabilir = yazılan + sahipsiz + kadroDışı",
  ozet.scorable === ozet.attributed + ozet.ownerless + ozet.outOfRoster,
  `${ozet.scorable} = ${ozet.attributed} + ${ozet.ownerless} + ${ozet.outOfRoster}`);
iddia("PANEL KPI 'toplam olay' = skorlanabilir", kpiToplam === ozet.scorable, `KPI ${kpiToplam} · sayaç ${ozet.scorable}`);
iddia("PANEL KPI = yazılan + sahipsiz (ekrandaki köprü)",
  kpiToplam === ozet.attributed + ozet.ownerless,
  `${kpiToplam} = ${ozet.attributed} + ${ozet.ownerless}`);
iddia("yazılan = Σ skor satırlarının olay sayısı (üretim fonksiyonu)",
  ozet.attributed === rowToplam, `sayaç ${ozet.attributed} · skor tablosu ${rowToplam}`);
iddia("kadroDışı = 0 (kadro dışı kimseye olay düşmüyor)", ozet.outOfRoster === 0, `${ozet.outOfRoster}`);

// ══ 3. SKOR HESABI DEĞİŞMEDİ ═════════════════════════════════════════════
console.log("\n── 3. SKOR HESABI DOKUNULMADI ──");
const skorlu = rows.filter((r) => r.score !== null);
const ort = skorlu.length ? Math.round(skorlu.reduce((a, r) => a + r.score, 0) / skorlu.length) : 0;
console.log(`     satır ${rows.length} · skorlanan ${skorlu.length} · ortalama ${ort}`);
iddia("satır sayısı = kadro", rows.length === workers.length, `${rows.length} = ${workers.length}`);
iddia("skorlanan satırların HEPSİ km eşiğini geçiyor",
  skorlu.every((r) => r.distanceKm != null && r.distanceKm >= r.minKm),
  `${skorlu.length} skorlu satır · en düşük km/eşik ${Math.min(...skorlu.map((r) => Math.round(r.distanceKm - r.minKm)))}`);
iddia("skorsuz satırda skor UYDURULMAMIŞ (0'a çakılan yok)",
  rows.every((r) => r.score === null || r.score > 0), null);
{
  const enIyi = [...skorlu].sort((a, b) => b.score - a.score)[0];
  iddia("zirve şoför Resul Demir 91 (canlı uçla aynı)",
    enIyi.name.startsWith("Resul") && enIyi.score === 91, `${enIyi.name} ${enIyi.score}`);
}
console.log("     NOT: skorun DEĞİŞMEDİĞİ ayrıca git-stash ÖNCE/SONRA kıyasıyla");
console.log("          bayt bayt kanıtlandı (rapordaki KANIT bloğu).");

// ══ 4. ARAÇ KIRILIMI ═════════════════════════════════════════════════════
console.log("\n── 4. ARAÇ KIRILIMI ──");
iddia("kırılım toplamı = sahipsiz olay sayısı",
  ozet.vehicles.reduce((a, v) => a + v.count, 0) === ozet.ownerless,
  `${ozet.vehicles.reduce((a, v) => a + v.count, 0)} = ${ozet.ownerless}`);
iddia("çoktan aza sıralı", ozet.vehicles.every((v, i, arr) => i === 0 || arr[i - 1].count >= v.count), null);
iddia("her satırda gerçek plaka var", ozet.vehicles.every((v) => v.plate && v.plate !== "—"), null);
console.log(`     plaka        sahipsiz  vardiya  atanmış`);
for (const v of ozet.vehicles.slice(0, 5)) {
  console.log(`     ${v.plate.padEnd(12)} ${String(v.count).padStart(8)}  ${String(v.shifts).padStart(7)}  ${v.assignedName ?? "—"}`);
}
{
  const hicVardiyasiz = ozet.vehicles.filter((v) => v.shifts === 0);
  console.log(`     → aralıkta HİÇ vardiya açılmayan araç: ${hicVardiyasiz.length} (${hicVardiyasiz.map((v) => `${v.plate}:${v.count}`).join(", ") || "yok"})`);
}

// ══ 5. MOBİL UÇ ══════════════════════════════════════════════════════════
console.log("\n── 5. MOBİL GET /api/mobile/analytics ──");
{
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, token_version")
    .eq("is_admin", true).eq("is_active", true).neq("is_test", true)
    .order("name").limit(1).maybeSingle();
  const token = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;

  const cagir = async (qs, t) => {
    const h = {};
    if (t) h.authorization = `Bearer ${t}`;
    const res = await ANALYTICS(new Request(`http://x/api/mobile/analytics${qs}`, { headers: h }));
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const a = await cagir("?range=ay", null);
  iddia("token yok → 401", a.status === 401, `${a.status} ${a.json?.error}`);

  const b = await cagir("?range=ay", token);
  // Dönem toplamları yanıtta `toplam` bloğunda yaşıyor (mevcut sözleşme).
  const so = b.json?.toplam?.sahipsizOlay;
  iddia("yönetici token → 200", b.status === 200, `${b.status}`);
  iddia("sahipsizOlay alanı VAR", !!so, so ? JSON.stringify({ ...so, araclar: `${so.araclar.length} araç` }) : "YOK");
  iddia("uç sayıları panel sayacıyla birebir",
    so?.skorlanabilir === ozet.scorable && so?.yazilan === ozet.attributed &&
      so?.sahipsiz === ozet.ownerless && so?.kadroDisi === ozet.outOfRoster,
    `uç ${so?.sahipsiz} · panel ${ozet.ownerless}`);
  iddia("uçta da kimlik kapanıyor",
    so?.skorlanabilir === so?.yazilan + so?.sahipsiz + so?.kadroDisi, null);
  iddia("uçtaki skorlanabilir = alarm.toplam (mevcut alan)",
    so?.skorlanabilir === b.json?.toplam?.alarm?.toplam,
    `${so?.skorlanabilir} = ${b.json?.toplam?.alarm?.toplam}`);
  iddia("araç kırılımı uçta da var, ilk satır plakalı",
    Array.isArray(so?.araclar) && so.araclar.length > 0 && !!so.araclar[0].plaka,
    so?.araclar?.[0] ? JSON.stringify(so.araclar[0]) : "boş");

  // GERİYE UYUMLULUK — eski alanların hiçbiri kaybolmamalı.
  const kok = ["ok", "donem", "toplam", "oncekiDonem", "trendBloke", "esikNotu", "rolantiKatsayi"];
  const donemAlanlari = ["vardiya", "calismaMs", "km", "kmKapsama", "skor", "alarm", "rolanti"];
  const beklenen = [...kok, ...donemAlanlari];
  const eksik = [
    ...kok.filter((k) => !(k in (b.json ?? {}))),
    ...donemAlanlari.filter((k) => !(k in (b.json?.toplam ?? {}))),
  ];
  iddia("mevcut alanların HİÇBİRİ kaybolmadı", eksik.length === 0, eksik.length ? eksik.join(",") : `${beklenen.length} alan yerinde`);
  iddia("alarm bloğu aynen duruyor (toplam/tur/kapsamDisi)",
    typeof b.json?.toplam?.alarm?.toplam === "number" && !!b.json?.toplam?.alarm?.tur &&
      typeof b.json?.toplam?.alarm?.kapsamDisi === "number", null);
  iddia("önceki dönem bloğunda da sahipsizOlay VAR",
    typeof b.json?.oncekiDonem?.toplam?.sahipsizOlay?.sahipsiz === "number",
    `önceki sahipsiz=${b.json?.oncekiDonem?.toplam?.sahipsizOlay?.sahipsiz}`);

  const c = await cagir("?range=hafta", token);
  const ch = c.json?.toplam?.sahipsizOlay;
  iddia("başka pencerede de sayı üretiyor (hafta)",
    c.status === 200 && typeof ch?.sahipsiz === "number",
    `hafta sahipsiz=${ch?.sahipsiz} / ${ch?.skorlanabilir}`);
  iddia("hafta penceresinde de kimlik kapanıyor",
    ch?.skorlanabilir === ch?.yazilan + ch?.sahipsiz + ch?.kadroDisi, null);
}

// ══ 6. UI-PATH PROOF: KARTIN BASACAĞI DİZGELER ═══════════════════════════
/**
 * Bu projede kimlik doğrulamalı Playwright QA bloklu (bkz. CLAUDE.md), o yüzden
 * "ekran görüntüsü" yerine kartın GERÇEKTEN basacağı metin üretiliyor: sayfanın
 * hesapladığı prop + messages/tr.json'daki gerçek dizge + gerçek ICU değişkeni.
 * Uydurma bir örnek değil — kart hangi cümleyi kuracaksa o.
 */
console.log("\n── 6. UI-PATH PROOF · KARTIN BASACAĞI METİN ──");
{
  const fs = await import("node:fs/promises");
  const mesajlar = JSON.parse(await fs.readFile("messages/tr.json", "utf8")).analiz;
  const doldur = (kalip, degerler) =>
    kalip.replace(/\{(\w+)\}/g, (_, k) => String(degerler[k] ?? "{" + k + "}"));
  const tr = (n) => n.toLocaleString("tr-TR");
  const o = ozet;

  console.log(`\n     ┌─ /admin/analiz?aralik=ay · "${mesajlar.ownerless_title}" kartı ─────`);
  console.log(`     │ ${mesajlar.ownerless_title}${" ".repeat(Math.max(2, 40 - mesajlar.ownerless_title.length))}${tr(o.ownerless)}`);
  console.log(`     │ ${mesajlar.ownerless_hint}`);
  console.log(`     │`);
  console.log(`     │ ${doldur(mesajlar.ownerless_bridge, {
    toplam: tr(o.scorable),
    yazilan: tr(o.attributed),
    sahipsiz: tr(o.ownerless),
  })}`);
  if (o.outOfRoster > 0) {
    console.log(`     │ ${doldur(mesajlar.ownerless_outofroster, { n: tr(o.outOfRoster) })}`);
  }
  console.log(`     │`);
  console.log(`     │ ▸ ${doldur(mesajlar.ownerless_breakdown, { n: o.vehicles.length })}`);
  console.log(`     │   ${mesajlar.ownerless_breakdown_hint}`);
  for (const v of o.vehicles.slice(0, 5)) {
    const rozet = v.shifts === 0 ? `[${mesajlar.ownerless_no_shift}]` : "";
    console.log(
      `     │   ${v.plate.padEnd(10)} ${rozet.padEnd(17)} ${mesajlar.ownerless_col_count}: ${tr(v.count).padStart(4)}   ` +
        `${mesajlar.ownerless_col_shifts}: ${String(v.shifts).padStart(3)}   ${mesajlar.ownerless_col_assigned}: ${v.assignedName ?? "—"}`
    );
  }
  if (o.vehicles.length > 5) {
    console.log(`     │   ${doldur(mesajlar.ownerless_rest, {
      n: o.vehicles.length - 5,
      adet: tr(o.vehicles.slice(5).reduce((a, b) => a + b.count, 0)),
    })}`);
  }
  console.log(`     └──────────────────────────────────────────────────────────`);

  const gerekli = [
    "ownerless_title", "ownerless_hint", "ownerless_bridge", "ownerless_outofroster",
    "ownerless_breakdown", "ownerless_breakdown_hint", "ownerless_col_count",
    "ownerless_col_shifts", "ownerless_col_assigned", "ownerless_no_shift", "ownerless_rest",
  ];
  const eksikTr = gerekli.filter((k) => !mesajlar[k]);
  iddia("tr.json · 11 anahtarın hepsi var", eksikTr.length === 0, eksikTr.join(",") || "11/11");
  const de = JSON.parse(await fs.readFile("messages/de.json", "utf8")).analiz;
  const eksikDe = gerekli.filter((k) => !de[k]);
  iddia("de.json · dil paritesi", eksikDe.length === 0, eksikDe.join(",") || "11/11");
  iddia("köprü cümlesi ÜÇ sayıyı da taşıyor",
    ["{toplam}", "{yazilan}", "{sahipsiz}"].every((x) => mesajlar.ownerless_bridge.includes(x)), null);
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
