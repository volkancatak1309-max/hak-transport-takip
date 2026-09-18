#!/usr/bin/env node
/**
 * YAKIT GÜVENİLİRLİK KAPISI + FİLO NORMALİZE KIYASI — CANLIDA KANIT.
 *
 * HİÇBİR ŞEY YAZMAZ. Kuralın kopyası da YAZILMAZ: `yakitKapisi` üretim
 * fonksiyonunun kendisi çağrılır, üç yüzeyin (yakıt raporu · araç özeti · filo
 * karşılaştırma) çıktısı onunla karşılaştırılır.
 *
 * Kullanım:
 *   npm run verify:yakit-guvenilirlik
 *   ENV_FILE=.env.galzura-demo npm run verify:yakit-guvenilirlik -- W-GF-106
 *
 * İkinci argüman: /ozet ucunda yakıtı GİZLENMESİ beklenen araçların plakası
 * (virgülle). Verilmezse o bölüm atlanır.
 */
import { buildFuelReport } from "@/lib/reports";
import { aracDonemOzeti } from "@/lib/vehicle-ozet";
import { buildFleetComparison } from "@/lib/fleet-compare";
import { computeAnalyticsRange, listVehiclesAndWorkers } from "@/lib/analytics";
import { yakitKapisi, YAKIT_MIN_KAPSAMA, YAKIT_L100_MIN, YAKIT_L100_MAX } from "@/lib/fuel-vehicle";
import { viennaDayKey } from "@/lib/format";
import { UNRESTRICTED } from "@/lib/fleet-scope";

const KIRACI = process.env.ENV_FILE ?? ".env.local";
const range = computeAnalyticsRange("ay");
let gecen = 0; const dusen = [];
const ok = (b, ad, k) => { if (b) { gecen++; console.log(`  ✓ ${ad}${k ? "  — " + k : ""}`); } else { dusen.push(`${ad} — ${k}`); console.log(`  ✗ ${ad}  — ${k}`); } };
const f = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));

console.log(`\n╔══ ${KIRACI} · ${viennaDayKey(range.start)} → ${viennaDayKey(range.end)}`);
console.log(`║ kural: kapsama ≥ %${YAKIT_MIN_KAPSAMA * 100} · ${YAKIT_L100_MIN} ≤ L/100 ≤ ${YAKIT_L100_MAX} · depo dolu`);

const t0 = Date.now();
const rapor = await buildFuelReport(range);
console.log(`║ buildFuelReport ${Date.now() - t0} ms · araç=${rapor.vehicleCount}`);

// ── Gizlenen araçlar + sebepleri ──────────────────────────────────────────
const gizli = rapor.rows.filter((r) => r.dataUnreliable);
console.log(`\n── GİZLENEN (${gizli.length}/${rapor.rows.length}) ──`);
for (const r of gizli.sort((a, b) => a.plate.localeCompare(b.plate))) {
  const g = r.guvenilirlikSebep;
  const par = g && "yuzde" in g ? ` %${g.yuzde}` : g && "deger" in g ? ` ${g.deger}` : "";
  console.log(`  ${r.plate.padEnd(10)} ${String(g?.kod ?? "—").padEnd(18)}${par.padEnd(9)} litre=${f(r.consumedLiters)} l100=${f(r.lPer100Km)} kapsama=${r.kapsama === null ? "—" : "%" + f(r.kapsama * 100, 0)}`);
}
console.log(`\n── GÖSTERİLEN (${rapor.rows.length - gizli.length}) ──`);
for (const r of rapor.rows.filter((r) => !r.dataUnreliable && r.lPer100Km !== null).sort((a, b) => b.lPer100Km - a.lPer100Km)) {
  console.log(`  ${r.plate.padEnd(10)} l100=${f(r.lPer100Km).padStart(6)} litre=${f(r.consumedLiters).padStart(7)} km=${f(r.km, 0).padStart(6)} kapsama=%${f((r.kapsama ?? 0) * 100, 0)}`);
}
console.log(`\n  filo L/100 = ${f(rapor.fleetLPer100Km)} · ${rapor.l100VehicleCount} araçtan · Σlitre=${f(rapor.totalConsumedLiters, 0)} · Σ€=${f(rapor.totalCostEur, 0)}`);

// ── SÖZLEŞME ──────────────────────────────────────────────────────────────
ok(rapor.rows.every((r) => (r.consumedLiters === null) === r.dataUnreliable || !r.hasData),
  "gizli satırda litre null", `${rapor.rows.filter((r) => r.dataUnreliable && r.consumedLiters !== null).length} sapma`);
ok(rapor.rows.every((r) => !r.dataUnreliable || r.lPer100Km === null), "gizli satırda l100 null");
ok(rapor.rows.every((r) => r.dataUnreliable === (r.guvenilirlikSebep !== null)), "dataUnreliable ⇔ sebep var");
ok(rapor.rows.every((r) => r.lPer100Km === null || (r.lPer100Km >= YAKIT_L100_MIN && r.lPer100Km <= YAKIT_L100_MAX)),
  `gösterilen her l100 ∈ [${YAKIT_L100_MIN},${YAKIT_L100_MAX}]`);
ok(rapor.rows.every((r) => r.dataUnreliable || r.kapsama === null || r.kapsama >= YAKIT_MIN_KAPSAMA),
  `gösterilen her kapsama ≥ %${YAKIT_MIN_KAPSAMA * 100}`);

// saf kapı: aynı girdi → aynı karar
{
  const a = yakitKapisi({ hamLitre: 100, hamSebep: null, km: 1000, kapsama: 0.9, eurPerL: 2 });
  const b = yakitKapisi({ hamLitre: 100, hamSebep: null, km: 1000, kapsama: 0.5, eurPerL: 2 });
  const c = yakitKapisi({ hamLitre: 1000, hamSebep: null, km: 100, kapsama: 0.9, eurPerL: 2 });
  ok(a.guvenilir && a.l100 === 10 && a.euro === 200, "saf kapı: geçerli satır", `l100=${a.l100} €=${a.euro}`);
  ok(!b.guvenilir && b.sebep.kod === "kapsama_dusuk" && b.sebep.yuzde === 50 && b.litre === null,
    "saf kapı: kapsama_dusuk{50} + litre null", JSON.stringify(b.sebep));
  ok(!c.guvenilir && c.sebep.kod === "l100_aralik_disi" && c.sebep.deger === 1000,
    "saf kapı: l100_aralik_disi{1000}", JSON.stringify(c.sebep));
}

// ── FİLO KARŞILAŞTIRMA ────────────────────────────────────────────────────
const k = await buildFleetComparison(range, UNRESTRICTED);
console.log(`\n── FİLO KARŞILAŞTIRMA ──`);
for (const s of [...k.filolar, k.toplam]) {
  console.log(`  ${s.ad.padEnd(10)} araç=${String(s.aracSayisi).padStart(2)} km=${f(s.km, 0).padStart(6)} litre=${f(s.yakitLitre, 0).padStart(6)} L/100=${f(s.yakitL100).padStart(6)} (güvenilir ${s.yakitGuvenilirArac}/${s.aracSayisi})`);
}
console.log(`\n  NORMALİZE:`);
for (const m of k.normalize) {
  const sat = m.filolar.map((d) => `${d.ad}=${f(d.deger, 2)}${d.yuzdeFark === null ? "" : ` (${d.yuzdeFark >= 0 ? "+" : ""}${f(d.yuzdeFark, 0)}%)`}${d.enIyi ? " ▲" : ""}${d.enKotu ? " ▼" : ""}`).join("  ·  ");
  console.log(`    ${m.anahtar.padEnd(22)} [${m.yon.padEnd(9)}] ort=${f(m.ortalama, 2).padStart(7)}   ${sat}`);
}
const yonsuz = k.normalize.find((m) => m.yon === "yonsuz");
ok(yonsuz.filolar.every((d) => !d.enIyi && !d.enKotu), "yönsüz metrikte en iyi/en kötü işareti YOK", yonsuz.anahtar);
for (const m of k.normalize.filter((m) => m.yon !== "yonsuz")) {
  const olculen = m.filolar.filter((d) => d.deger !== null);
  const beklenen = olculen.length >= 2 && new Set(olculen.map((d) => d.deger)).size > 1 ? 1 : 0;
  ok(m.filolar.filter((d) => d.enIyi).length === beklenen, `${m.anahtar}: tek "en iyi"`, `${m.filolar.filter((d) => d.enIyi).length}`);
}
const d = k.denklik;
const say = Object.values(d).filter((x) => x.esit).length;
ok(say === 5, "denklik 5/5", Object.entries(d).map(([n, x]) => `${n}=${x.esit ? "✓" : "✗ " + f(x.filolarToplami, 1) + "/" + f(x.kaynakToplam, 1)}`).join(" "));

// ── ARAÇ ÖZETİ (hedef araç) ───────────────────────────────────────────────
const evren = await listVehiclesAndWorkers();
for (const plaka of (process.argv[2] ?? "").split(",").filter(Boolean)) {
  const v = evren.vehicles.find((x) => x.plate === plaka);
  if (!v) continue;
  const o = await aracDonemOzeti(v.id, range);
  const g = o.yakit.l100.sebep;
  console.log(`\n── /ozet ${plaka}: km=${f(o.km, 0)} litre=${f(o.yakit.litre)} €=${f(o.yakit.euro)} l100=${f(o.yakit.l100.deger)} kapsama=${o.yakit.kapsama === null ? "—" : "%" + f(o.yakit.kapsama * 100, 0)} guvenilir=${o.yakit.guvenilir}`);
  console.log(`   sebep=${JSON.stringify(g)}`);
  ok(o.yakit.litre === null && o.yakit.euro === null && o.yakit.l100.deger === null && g !== null,
    `/ozet ${plaka}: yakıt üçlüsü null + sebep`, JSON.stringify(g));
}

console.log(`\n╚══ ${dusen.length === 0 ? "✓" : "✗"} ${gecen} geçti · ${dusen.length} düştü`);
for (const x of dusen) console.log("   ✗ " + x);
process.exit(dusen.length ? 1 : 0);
