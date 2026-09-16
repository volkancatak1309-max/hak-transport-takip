#!/usr/bin/env node
/**
 * FİLO KARŞILAŞTIRMA UCU — MALİYET ÖLÇÜMÜ (16. madde, Adım 1). SALT OKUMA.
 *
 * Soru üç tane:
 *   1. Toplam süre ne (hafta/ay), 5 koşumun MEDYANI?
 *   2. Toplayıcı başına süre ve PostgREST çağrı sayısı ne?
 *   3. Aynı okuma kaç kez yapılıyor (yani kaçı ZATEN yapılmış işin tekrarı)?
 *
 * Sayaç uydurma değil: `lib/query-counter.ts` zaten var (#84 Adım 0) ve
 * `supabaseAdmin` her `from()`/`rpc()` çağrısını ona yazıyor. Burada yalnız
 * kabı açıyoruz — ölçüm aracı ölçtüğü şeyi değiştirmiyor.
 *
 * ⚠️ SOĞUK/SICAK ÖNBELLEK: ilk koşum Postgres tarafında soğuktur. Bu yüzden
 * ısınma koşumu ayrı basılır ve karara MEDYAN girer, ortalama değil.
 *
 * Kullanım: ENV_FILE=.env.local npm run measure:filo-karsilastir
 */
import { supabaseAdmin } from "@/lib/supabase";
import { sayacIle } from "@/lib/query-counter";
import { computeAnalyticsRange } from "@/lib/analytics";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptk")
  ? "HAK61"
  : url.includes("ftbaz")
    ? "Sendigo"
    : "galzura-demo";

const {
  computeTopDriversByType,
  computeIdleWaste,
  getWorkerShiftDistance,
  listVehiclesAndWorkers,
} = await import("@/lib/analytics");
const { listEventsInRange, listIdleEpisodesInRange } = await import("@/lib/telemetry");
const { buildPerformanceReport, buildFuelReport } = await import("@/lib/reports");
const { resolveCostRates } = await import("@/lib/cost-rates-db");
const { listFleets } = await import("@/lib/fleets-db");
const { buildFleetComparison } = await import("@/lib/fleet-compare");

const KAPSAM = { fleet: null, restricted: false, vehicleIds: null, workerIds: null };

const ms = (t) => `${Math.round(t)} ms`;
const medyan = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Bir işi sayaç kabında koşar; süre + çağrı dökümü döner. */
async function olc(is) {
  return sayacIle(async (oku) => {
    const t0 = performance.now();
    const sonuc = await is();
    const sure = performance.now() - t0;
    const s = oku();
    return { sure, cagri: s.toplam, kaynak: { ...s.kaynak }, sonuc };
  });
}

const DONEMLER = ["hafta", "ay"];

console.log(`\n═══ ${KIRACI} · filo karşılaştırma maliyeti ═══`);

for (const donem of DONEMLER) {
  const range = computeAnalyticsRange(donem);
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  console.log(
    `\n━━━━━━━━━━ ${donem.toUpperCase()} (${startISO.slice(0, 10)} → ${endISO.slice(0, 10)}) ━━━━━━━━━━`
  );

  // ── 1. UÇTAN UCA: ısınma + 5 koşum ──────────────────────────────────────
  const isinma = await olc(() => buildFleetComparison(range, KAPSAM));
  const koşumlar = [];
  let sonCagri = 0;
  let sonKaynak = {};
  for (let i = 0; i < 5; i++) {
    const r = await olc(() => buildFleetComparison(range, KAPSAM));
    koşumlar.push(r.sure);
    sonCagri = r.cagri;
    sonKaynak = r.kaynak;
  }
  console.log(
    `\nUÇTAN UCA  ısınma ${ms(isinma.sure)} · 5 koşum [${koşumlar.map((x) => Math.round(x)).join(", ")}] ` +
      `→ MEDYAN ${ms(medyan(koşumlar))}`
  );
  console.log(`           PostgREST çağrısı: ${sonCagri}`);

  // ── 2. TOPLAYICI BAŞINA ─────────────────────────────────────────────────
  // Her biri KENDİ kabında, yalıtılmış — biri ötekinin okumasından yararlanmaz.
  const olcumler = [];
  const ekle = async (ad, is) => {
    const r = await olc(is);
    olcumler.push({ ad, sure: r.sure, cagri: r.cagri, kaynak: r.kaynak });
    return r.sonuc;
  };

  await ekle("listFleets", () => listFleets());
  const evren = await ekle("listVehiclesAndWorkers", () => listVehiclesAndWorkers());
  const events = await ekle("listEventsInRange", () => listEventsInRange(startISO, endISO));
  const idle = await ekle("listIdleEpisodesInRange", () =>
    listIdleEpisodesInRange(startISO, endISO)
  );
  await ekle("getWorkerShiftDistance (052)", () =>
    getWorkerShiftDistance(startISO, endISO)
  );
  const yakit = await ekle("buildFuelReport", () => buildFuelReport(range));
  await ekle("buildPerformanceReport", () => buildPerformanceReport(range));
  await ekle("resolveCostRates", () =>
    resolveCostRates(yakit.available ? yakit.fleetLPer100Km : null, new Date(), range.end)
  );
  // CPU toplayıcılar — DB'ye gitmiyorlar, girdiyi hazır alıyorlar.
  const vById = new Map(evren.vehicles.map((v) => [v.id, v]));
  const wById = new Map(evren.workers.map((w) => [w.id, w]));
  await ekle("computeTopDriversByType (CPU)", async () =>
    computeTopDriversByType(events, idle, vById, wById)
  );
  await ekle("computeIdleWaste (CPU)", async () =>
    computeIdleWaste(idle, vById, wById)
  );

  const genislik = Math.max(...olcumler.map((o) => o.ad.length));
  console.log(`\nTOPLAYICI BAŞINA (yalıtılmış, tek koşum)`);
  console.log(
    `  ${"toplayıcı".padEnd(genislik)}  ${"süre".padStart(9)}  ${"çağrı".padStart(6)}  döküm`
  );
  for (const o of olcumler) {
    const dok = Object.entries(o.kaynak)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(" ");
    console.log(
      `  ${o.ad.padEnd(genislik)}  ${ms(o.sure).padStart(9)}  ${String(o.cagri).padStart(6)}  ${dok || "—"}`
    );
  }
  const toplamYalitik = olcumler.reduce((a, o) => a + o.sure, 0);
  const toplamCagri = olcumler.reduce((a, o) => a + o.cagri, 0);
  console.log(
    `  ${"Σ (ardışık koşsalar)".padEnd(genislik)}  ${ms(toplamYalitik).padStart(9)}  ${String(toplamCagri).padStart(6)}`
  );

  // ── 3. TEKRAR EDEN OKUMALAR ─────────────────────────────────────────────
  // Ucun GERÇEK turundaki döküm: aynı tabloyu iki kez okuyan var mı?
  console.log(`\nUCUN GERÇEK TURUNDAKİ DÖKÜM (${sonCagri} çağrı)`);
  for (const [k, v] of Object.entries(sonKaynak).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(genislik)}  ${String(v).padStart(4)}×`);
  }
}

console.log("");
