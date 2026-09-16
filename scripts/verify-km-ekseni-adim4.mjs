#!/usr/bin/env node
/**
 * KM EKSENİ ADIM 4 — PANEL YÜZEYLERİ. CANLI kanıt, **SALT OKUMA.**
 *
 * Adım 3 mobil uçları çevirmişti; bu tur panel tarafını (Analiz toplamı, pano,
 * arşiv, çalışan detayı, şoför paneli, araç ekranları) aynı çekirdeğe bağlıyor.
 * CSV (lib/report-csv.ts) ve Almanca PDF (lib/report-de.ts) BİLEREK DIŞARIDA.
 *
 * "ÖNCE" = `kmDiff` ile BAĞIMSIZ yeniden hesaplanan sayaç ekseni.
 *
 * Kullanım:  ENV_FILE=.env.local npm run verify:km-ekseni-adim4
 */
import { supabaseAdmin } from "@/lib/supabase";
import { kmDiff } from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import { markKmKarar, kmEkseniCoz, kmPencere } from "@/lib/km-axis";
import { buildPerformanceReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
import { getDashboardData } from "@/lib/admin-dashboard";
import { UNRESTRICTED, getFleetScope } from "@/lib/fleet-scope";
import { buildFleetComparison } from "@/lib/fleet-compare";
import { startOfTodayVienna, endOfTodayVienna } from "@/lib/format";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptk") ? "HAK61" : url.includes("ftbaz") ? "Sendigo" : "galzura-demo";

let gecen = 0;
const dusen = [];
const ok = (b, k, kanit) => {
  if (k) { gecen++; console.log(`  ✓ ${b}${kanit ? `   [${kanit}]` : ""}`); }
  else { dusen.push({ b, kanit }); console.log(`  ✗ ${b}   [${kanit}]`); }
};
const n0 = (x) => (x == null ? "—" : Number(x).toFixed(0));

console.log(`\n═══ ${KIRACI} ═══`);

// ══ 1 · ANALİZ TOPLAMI — önce/sonra ════════════════════════════════════════
console.log("\n────────── Analiz totalKm (hafta) ──────────");
const range = computeAnalyticsRange("hafta");
const rapor = await buildPerformanceReport(range);

// ÖNCE: aynı evren, sayaç ekseni. buildPerformanceReport'un elemelerini
// TEKRARLAMAK yerine raporun kendi satır kümesinden türetiyoruz: rapor artık
// karar taşıyor, `kmDiff` ile yeniden hesap için ham satırlar gerekiyor.
const { data: hamAy } = await supabaseAdmin
  .from("time_entries")
  .select("id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km")
  .gte("started_at", range.start.toISOString())
  .lte("started_at", range.end.toISOString());
const isaretli = await markKmMeasured(hamAy ?? []);
const kararli = await markKmKarar(isaretli);
const onceHam = isaretli.reduce((a, e) => a + (kmDiff(e) ?? 0), 0);
const sonraHam = kararli.reduce((a, e) => a + (e.km_karar.km ?? 0), 0);
console.log(
  `  ham evren (eleme YOK): önce ${n0(onceHam)} → sonra ${n0(sonraHam)} km` +
    `  (${sonraHam - onceHam > 0 ? "+" : ""}${n0(sonraHam - onceHam)}, %${onceHam > 0 ? (((sonraHam - onceHam) / onceHam) * 100).toFixed(1) : "0"})`
);
console.log(`  🔑 rapor.totalKm (elemeli, ekranda görünen): ${n0(rapor.totalKm)} km`);
ok("Analiz toplamı bir sayı döndü", typeof rapor.totalKm === "number", n0(rapor.totalKm));

// ── ÇELİŞKİ: skor tablosunun distanceKm toplamı ────────────────────────────
const skorluSatir = rapor.rows.filter((r) => r.scoreKm != null);
const skorKmToplam = skorluSatir.reduce((a, r) => a + (r.scoreKm ?? 0), 0);
const satirKmToplam = rapor.rows.reduce((a, r) => a + (r.km ?? 0), 0);
console.log(
  `\n  skor tablosu Σ scoreKm (${skorluSatir.length} şoför) : ${n0(skorKmToplam)} km` +
    `\n  rapor satırları Σ km    (${rapor.rows.length} şoför) : ${n0(satirKmToplam)} km`
);
ok(
  "rapor.totalKm = Σ satır km (iç tutarlılık)",
  Math.abs(rapor.totalKm - satirKmToplam) < 0.5,
  `${n0(rapor.totalKm)} vs ${n0(satirKmToplam)}`
);
/**
 * ⚠️ ÇELİŞKİ TAM KAPANMAZ ve sebebi yapısal — ölçüp SÖYLÜYORUZ:
 * skor tablosunun `scoreKm`i 052'nin HAM şoför toplamıdır (kapsama kapısı YOK,
 * lib/analytics.ts getWorkerShiftDistance) ve YALNIZ skorlanabilen şoförleri
 * kapsar. Rapor toplamı ise kapsama kapısından geçmiş karar + TÜM şoförler.
 * İki sayı aynı olguyu ölçmüyor; beklenti "eşit" değil, "artık aynı eksende".
 */
const fark = rapor.totalKm - skorKmToplam;
console.log(
  `  ℹ fark ${fark > 0 ? "+" : ""}${n0(fark)} km — beklenen: skor tablosu YALNIZ` +
    ` skorlanan ${skorluSatir.length} şoförü ve KAPSAMA KAPISI OLMADAN sayar.`
);

// ══ 2 · PANO GÜNLÜK KM — önce/sonra ════════════════════════════════════════
console.log("\n────────── yönetici panosu · bugün ──────────");
const bugunBas = startOfTodayVienna().toISOString();
const bugunSon = endOfTodayVienna().toISOString();
const dash = await getDashboardData(bugunBas, bugunSon, UNRESTRICTED);
const { data: bugunHam } = await supabaseAdmin
  .from("time_entries")
  .select("id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km")
  .gte("started_at", bugunBas)
  .lte("started_at", bugunSon);
const bIsaretli = await markKmMeasured(bugunHam ?? []);
const bKararli = await markKmKarar(bIsaretli);
const panoOnce = bIsaretli.reduce((a, e) => a + (kmDiff(e) ?? 0), 0);
const panoSonra = bKararli.reduce((a, e) => a + (e.km_karar.km ?? 0), 0);
const panoKm = dash.todayOps?.totalKmToday ?? null;
console.log(
  `  bugün ${bIsaretli.length} vardiya · ham: önce ${n0(panoOnce)} → sonra ${n0(panoSonra)} km`
);
console.log(`  🔑 panonun gösterdiği (todayOps.totalKmToday): ${n0(panoKm)} km`);
ok(
  "🔑 pano km = çekirdek toplamı (sayaç ekseninden FARKLI)",
  panoKm !== null && Math.abs(panoKm - panoSonra) < 0.5,
  `pano ${n0(panoKm)} · çekirdek ${n0(panoSonra)} · eski ${n0(panoOnce)}`
);
ok("pano km bir sayı ya da null", panoKm === null || typeof panoKm === "number", n0(panoKm));
const dagilim = {};
for (const e of bKararli) dagilim[e.km_karar.kaynak] = (dagilim[e.km_karar.kaynak] ?? 0) + 1;
console.log(`  kaynak dağılımı: ${JSON.stringify(dagilim)}`);

// ══ 3 · FİLO KARŞILAŞTIRMA denklik.km ══════════════════════════════════════
console.log("\n────────── filo karşılaştırma · denklik ──────────");
const kars = await buildFleetComparison(range, UNRESTRICTED);
for (const [ad, d] of Object.entries(kars.denklik)) {
  ok(
    `denklik ${ad} hâlâ eşit`,
    d.esit === true,
    `Σ=${n0(d.filolarToplami)} kaynak=${n0(d.kaynakToplam)}`
  );
}

// ══ 4 · ARAÇ EKRANI kmKaynak taşıyor mu ════════════════════════════════════
console.log("\n────────── araç ekranı ──────────");
const { data: arac } = await supabaseAdmin.from("vehicles").select("id, plate").limit(1).maybeSingle();
if (arac) {
  const { getVehicleDetail } = await import("@/lib/vehicles");
  const d = await getVehicleDetail(arac.id).catch(() => null);
  if (d && Array.isArray(d.recent) && d.recent.length) {
    ok(
      "araç son vardiyalarında kmKaynak var",
      d.recent.every((r) => typeof r.kmKaynak === "string"),
      `${d.recent.length} satır · ${d.recent[0]?.kmKaynak}`
    );
  } else {
    console.log("  (araç detayı ya da vardiya yok — atlandı)");
  }
}

// ══ 5 · ŞEF KAPSAMI BOZULMADI ══════════════════════════════════════════════
const { data: filo } = await supabaseAdmin.from("fleets").select("code").order("sort_order").limit(1).maybeSingle();
if (filo) {
  const scope = await getFleetScope(filo.code);
  const sef = await buildFleetComparison(range, scope);
  ok("şef kapsamında denklik.km eşit", sef.denklik.km.esit === true, `Σ=${n0(sef.denklik.km.filolarToplami)}`);
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} km ekseni Adım 4: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
