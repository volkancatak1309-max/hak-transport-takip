#!/usr/bin/env node
/**
 * YAKIT RAPORU PAYDASI ÇEKİRDEKTE — KAPI PARİTESİ KANITI. YAZMA YOK.
 *
 * Asıl iddiası tek cümle: `buildFuelReport` ile `/vehicles/[id]/ozet` AYNI
 * araç için AYNI km'yi ve AYNI kapı sonucunu vermeli. İki yüzey farklı payda
 * kullandığı sürece bu tutmuyordu (DO-671GY: 701 km ↔ 64 km).
 *
 * Kullanım:
 *   npm run verify:yakit-payda -- sonra /tmp/sonra.json
 *   ENV_FILE=.env.galzura-demo npm run verify:yakit-payda -- sonra /tmp/d.json
 *
 * `once` etiketiyle çalıştırılıp dosya saklanırsa (değişiklikten ÖNCE, ör.
 * `git stash` ile) `sonra` koşumu satır satır ÖNCE/SONRA tablosu da basar.
 */
import { buildFuelReport } from "@/lib/reports";
import { aracDonemOzeti } from "@/lib/vehicle-ozet";
import { buildFleetComparison } from "@/lib/fleet-compare";
import { computeAnalyticsRange, listVehiclesAndWorkers } from "@/lib/analytics";
import { UNRESTRICTED } from "@/lib/fleet-scope";
import { viennaDayKey } from "@/lib/format";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const KIRACI = process.env.ENV_FILE ?? ".env.local";
const range = computeAnalyticsRange("ay");
const etiket = process.argv[2];            // "once" | "sonra"
const dosya = process.argv[3];
let gecen = 0; const dusen = [];
const ok = (b, ad, k) => { if (b) { gecen++; console.log(`  ✓ ${ad}${k ? "  — " + k : ""}`); } else { dusen.push(`${ad} — ${k}`); console.log(`  ✗ ${ad}  — ${k}`); } };
const f = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));

const rapor = await buildFuelReport(range);
const kayit = rapor.rows.map((r) => ({
  plaka: r.plate, km: r.km, litre: r.consumedLiters, l100: r.lPer100Km,
  gizli: r.dataUnreliable, sebep: r.guvenilirlikSebep, kapsama: r.kapsama,
}));
writeFileSync(dosya, JSON.stringify({ etiket, kiraci: KIRACI,
  filoL100: rapor.fleetLPer100Km, l100Arac: rapor.l100VehicleCount,
  litre: rapor.totalConsumedLiters, satirlar: kayit }, null, 1));
console.log(`\n╔══ ${KIRACI} · ${etiket.toUpperCase()} · ${viennaDayKey(range.start)}→${viennaDayKey(range.end)}`);
console.log(`║ gizli=${kayit.filter((x) => x.gizli).length}/${kayit.length} · filo L/100=${f(rapor.fleetLPer100Km)} (${rapor.l100VehicleCount} araç) · Σlitre=${f(rapor.totalConsumedLiters, 0)}`);

if (etiket !== "sonra") process.exit(0);

// ── SATIR SATIR ÖNCE/SONRA ────────────────────────────────────────────────
const oncePath = dosya.replace("sonra", "once");
if (existsSync(oncePath)) {
  const o = JSON.parse(readFileSync(oncePath, "utf8"));
  const om = new Map(o.satirlar.map((x) => [x.plaka, x]));
  console.log(`\n── SATIR SATIR (km · L/100 · gizli) ──`);
  console.log("  " + "PLAKA".padEnd(10) + "km ÖNCE→SONRA".padEnd(20) + "L/100 ÖNCE→SONRA".padEnd(22) + "gizli ÖNCE→SONRA");
  for (const r of kayit.sort((a, b) => a.plaka.localeCompare(b.plaka))) {
    const x = om.get(r.plaka);
    const deg = x && (x.km !== r.km || x.gizli !== r.gizli);
    if (!deg) continue;
    const seb = r.sebep ? `${r.sebep.kod}${"yuzde" in r.sebep ? `{%${r.sebep.yuzde}}` : "deger" in r.sebep ? `{${r.sebep.deger}}` : ""}` : "";
    console.log("  " + r.plaka.padEnd(10) +
      `${f(x.km, 0)}→${f(r.km, 0)}`.padEnd(20) +
      `${f(x.l100)}→${f(r.l100)}`.padEnd(22) +
      `${x.gizli ? "gizli" : "açık"}→${r.gizli ? "gizli" : "açık"}  ${seb}`);
  }
  console.log(`\n  filo L/100 ${f(o.filoL100)} (${o.l100Arac} araç) → ${f(rapor.fleetLPer100Km)} (${rapor.l100VehicleCount} araç)`);
  console.log(`  Σlitre      ${f(o.litre, 0)} → ${f(rapor.totalConsumedLiters, 0)}`);
}

// ── KAPI PARİTESİ: yakıt raporu ↔ /ozet, HER ARAÇTA ───────────────────────
const evren = await listVehiclesAndWorkers();
let sapan = 0; const sapanlar = [];
for (const v of evren.vehicles) {
  const r = rapor.rows.find((x) => x.vehicleId === v.id);
  const o = await aracDonemOzeti(v.id, range);
  const raporGizli = r?.dataUnreliable ?? true;
  const ozetGizli = !o.yakit.guvenilir;
  const kmEsit = (r?.km ?? null) === o.km || (r?.km != null && o.km != null && Math.abs(r.km - o.km) < 0.5);
  if (raporGizli !== ozetGizli || !kmEsit) {
    sapan++;
    sapanlar.push(`${v.plate}: rapor(km=${f(r?.km, 0)} gizli=${raporGizli}) ozet(km=${f(o.km, 0)} gizli=${ozetGizli})`);
  }
}
ok(sapan === 0, `kapı sonucu + km: yakıt raporu === /ozet (${evren.vehicles.length}/${evren.vehicles.length})`, sapanlar.join(" | ") || "sapma yok");

// ── FİLO ──────────────────────────────────────────────────────────────────
const k = await buildFleetComparison(range, UNRESTRICTED);
console.log(`\n── FİLO ──`);
for (const s of [...k.filolar, k.toplam]) {
  console.log(`  ${s.ad.padEnd(11)} km=${f(s.km, 0).padStart(6)} litre=${f(s.yakitLitre, 0).padStart(6)} L/100=${f(s.yakitL100).padStart(6)} (güvenilir ${s.yakitGuvenilirArac}/${s.aracSayisi})`);
}
const bordo = k.filolar.find((x) => /bordo/i.test(x.ad));
if (bordo) ok(bordo.yakitL100 === null && bordo.yakitGuvenilirArac === 0, "Bordo l100 null · 0 güvenilir araç", `l100=${f(bordo.yakitL100)} guvenilir=${bordo.yakitGuvenilirArac}/${bordo.aracSayisi}`);
const d = k.denklik;
ok(Object.values(d).filter((x) => x.esit).length === 5, "denklik 5/5",
  Object.entries(d).map(([n, x]) => `${n}=${x.esit ? "✓" : "✗"}`).join(" "));

console.log(`\n╚══ ${dusen.length === 0 ? "✓" : "✗"} ${gecen} geçti · ${dusen.length} düştü`);
for (const x of dusen) console.log("   ✗ " + x);
process.exit(dusen.length ? 1 : 0);
