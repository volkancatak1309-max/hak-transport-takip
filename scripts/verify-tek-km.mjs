#!/usr/bin/env node
/**
 * TEK KM MUHAFIZI — CANLIDA KANIT. YAZMA YOK.
 *
 * Tek iddiası var ve bu projenin bugünkü doktrini: AYNI ARAÇ, AYNI PENCERE →
 * Mesafe raporu · Yakıt raporu · Hız raporu · araç detayı özeti DÖRDÜ DE aynı
 * km'yi göstermeli. Kaynak `lib/km-axis.ts` çekirdeği (cihaz → sayaç → null),
 * toplama `lib/score-core.ts` → `aracCekirdekKm`.
 *
 * Kullanım:
 *   npm run verify:tek-km -- sonra /tmp/sonra.json
 *   ENV_FILE=.env.galzura-demo npm run verify:tek-km -- sonra /tmp/d.json
 *
 * `once` etiketiyle (değişiklikten önce, ör. `git stash`) bir dosya
 * saklanırsa `sonra` koşumu satır satır ÖNCE/SONRA tablosu da basar.
 */
import { buildDistanceReport, buildFuelReport, buildSpeedReport } from "@/lib/reports";
import { aracDonemOzeti } from "@/lib/vehicle-ozet";
import { computeAnalyticsRange, listVehiclesAndWorkers } from "@/lib/analytics";
import { viennaDayKey } from "@/lib/format";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const range = computeAnalyticsRange("ay");
const etiket = process.argv[2], dosya = process.argv[3];
let gecen = 0; const dusen = [];
const ok = (b, ad, k) => { if (b) { gecen++; console.log(`  ✓ ${ad}${k ? "  — " + k : ""}`); } else { dusen.push(`${ad} — ${k}`); console.log(`  ✗ ${ad}  — ${k}`); } };
const f = (x, d = 0) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));

const [mesafe, yakit, hiz] = await Promise.all([
  buildDistanceReport(range), buildFuelReport(range), buildSpeedReport(range),
]);
writeFileSync(dosya, JSON.stringify({ etiket,
  toplamKm: mesafe.totalKm, olculen: mesafe.measured,
  satirlar: mesafe.rows.map((r) => ({ plaka: r.plate, km: r.km, kmGun: r.kmPerDay })),
  hiz: hiz.rows.map((r) => ({ plaka: r.plate, km: r.distanceKm, per100: r.per100Km, sebep: r.per100Reason })),
}, null, 1));
console.log(`\n╔══ ${process.env.ENV_FILE ?? ".env.local"} · ${etiket.toUpperCase()} · ${viennaDayKey(range.start)}→${viennaDayKey(range.end)}`);
console.log(`║ mesafe: Σkm=${f(mesafe.totalKm)} · ölçülen=${mesafe.measured}/${mesafe.vehicleCount}`);
if (etiket !== "sonra") process.exit(0);

const oncePath = dosya.replace("sonra", "once");
if (existsSync(oncePath)) {
  const o = JSON.parse(readFileSync(oncePath, "utf8"));
  const om = new Map(o.satirlar.map((x) => [x.plaka, x]));
  const oh = new Map(o.hiz.map((x) => [x.plaka, x]));
  console.log(`\n── MESAFE RAPORU · satır satır ──`);
  console.log("  " + "PLAKA".padEnd(10) + "km ÖNCE→SONRA".padEnd(18) + "km/gün ÖNCE→SONRA".padEnd(20) + "hız/100km ÖNCE→SONRA");
  for (const r of mesafe.rows.slice().sort((a, b) => a.plate.localeCompare(b.plate))) {
    const x = om.get(r.plate), h = hiz.rows.find((q) => q.plate === r.plate), xh = oh.get(r.plate);
    console.log("  " + r.plate.padEnd(10) +
      `${f(x?.km)}→${f(r.km)}`.padEnd(18) +
      `${f(x?.kmGun, 1)}→${f(r.kmPerDay, 1)}`.padEnd(20) +
      `${f(xh?.per100, 1)}→${f(h?.per100Km, 1)}` + (h?.per100Reason ? ` (${h.per100Reason})` : ""));
  }
  console.log(`\n  Σkm ${f(o.toplamKm)} → ${f(mesafe.totalKm)} · ölçülen ${o.olculen} → ${mesafe.measured}`);
}

// ── PARİTE: mesafe km === yakıt km === hız km === /ozet km, HER ARAÇTA ────
const evren = await listVehiclesAndWorkers();
let sapan = 0; const s = [];
for (const v of evren.vehicles) {
  const m = mesafe.rows.find((x) => x.vehicleId === v.id)?.km ?? null;
  const y = yakit.rows.find((x) => x.vehicleId === v.id)?.km ?? null;
  const h = hiz.rows.find((x) => x.vehicleId === v.id)?.distanceKm ?? null;
  const esit = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.5);
  if (!esit(m, y) || !esit(m, h)) { sapan++; s.push(`${v.plate}: mesafe=${f(m)} yakıt=${f(y)} hız=${f(h)}`); }
}
ok(sapan === 0, `mesafe km === yakıt km === hız km (${evren.vehicles.length}/${evren.vehicles.length})`, s.join(" | ") || "sapma yok");

let sapan2 = 0; const s2 = [];
for (const v of evren.vehicles) {
  const m = mesafe.rows.find((x) => x.vehicleId === v.id)?.km ?? null;
  const o = (await aracDonemOzeti(v.id, range)).km;
  if (!(m === null && o === null) && !(m !== null && o !== null && Math.abs(m - o) < 0.5)) { sapan2++; s2.push(`${v.plate}: rapor=${f(m)} ozet=${f(o)}`); }
}
ok(sapan2 === 0, `mesafe km === /ozet km (${evren.vehicles.length}/${evren.vehicles.length})`, s2.join(" | ") || "sapma yok");

console.log(`\n╚══ ${dusen.length === 0 ? "✓" : "✗"} ${gecen} geçti · ${dusen.length} düştü`);
process.exit(dusen.length ? 1 : 0);
