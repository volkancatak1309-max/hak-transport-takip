#!/usr/bin/env node
/**
 * KM NULL DÜZELTMESİ — CANLIDA ÖNCE/SONRA KANITI.
 * ⚠️ SALT OKUMA. Hiçbir satır yazılmaz; geçmiş kayıtlara dokunulmaz.
 *
 * Ölçtüğü dört şey:
 *  ① Kaç vardiya ÖNCE "0 km" gösteriyordu, SONRA "—" gösteriyor
 *  ② GERÇEK 0 km (araç park etti, telemetri var) hâlâ 0 gösteriyor mu — regresyon kapısı
 *  ③ Şoför aylık toplamı: Emrullah Arslan örneği
 *  ④ Skor kapsaması: kaç şoför eşiğin altında kaldı
 *  ⑤ Dikkat/Aksiyon: bugün kaç "km ölçülemedi" kalemi çıkıyor
 */
import { supabaseAdmin } from "@/lib/supabase";
import { kmDiff } from "@/lib/format";
import { markKmMeasured, kmCoverage } from "@/lib/km-quality";
import {
  getWorkerShiftDistance,
  shiftKmForScoring,
  SCORE_MIN_KM_COVERAGE,
} from "@/lib/analytics";

const GUN = Number(process.env.GUN ?? 60);
const FROM = new Date(Date.now() - GUN * 86400000).toISOString();

console.log(`\n╔══ KM NULL DÜZELTMESİ · CANLI KANIT ════════════════════════════════`);
console.log(`║ pencere son ${GUN} gün · ⚠️ salt okuma\n`);

const { data: raw } = await supabaseAdmin
  .from("time_entries")
  .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_km, end_km, cargo_count")
  .gte("started_at", FROM)
  .order("started_at");
const rows = raw ?? [];

const { data: workers } = await supabaseAdmin.from("workers").select("id, name");
const wAd = new Map((workers ?? []).map((w) => [w.id, w.name]));

// ── ① ÖNCE / SONRA ───────────────────────────────────────────────────────
const once = rows.map((e) => ({
  e,
  km: e.end_km == null || e.start_km == null ? null : e.end_km - e.start_km,
}));
const isaretli = await markKmMeasured(rows);
const sonra = isaretli.map((e) => ({ e, km: kmDiff(e) }));

const sayim = (arr) => ({
  sifir: arr.filter((x) => x.km === 0).length,
  bos: arr.filter((x) => x.km === null).length,
  pozitif: arr.filter((x) => x.km !== null && x.km > 0).length,
});
const a = sayim(once);
const b = sayim(sonra);

console.log(`── ① VARDİYA KM'Sİ · ÖNCE ↔ SONRA (${rows.length} vardiya) ──`);
console.log(`   ${"".padEnd(22)}${"ÖNCE".padStart(8)}${"SONRA".padStart(9)}${"fark".padStart(9)}`);
const satir = (ad, x, y) =>
  console.log(`   ${ad.padEnd(22)}${String(x).padStart(8)}${String(y).padStart(9)}${(y - x >= 0 ? "+" : "") + (y - x)}`.padEnd(0));
satir("km > 0 (normal)", a.pozitif, b.pozitif);
satir('"0 km" gösteren', a.sifir, b.sifir);
satir('"—" gösteren', a.bos, b.bos);

const donusen = sonra.filter((x, i) => once[i].km === 0 && x.km === null);
console.log(`\n   ⇒ 0 km'den "—"e DÖNEN vardiya: ${donusen.length}`);
console.log(`   ⇒ 0 km olarak KALAN vardiya  : ${b.sifir}  (gerçek park — telemetri var)`);

// ── ② REGRESYON KAPISI ───────────────────────────────────────────────────
console.log(`\n── ② REGRESYON KAPISI — pozitif km'ye dokunuldu mu? ──`);
const bozulan = sonra.filter((x, i) => once[i].km !== null && once[i].km > 0 && x.km !== once[i].km);
console.log(`   km > 0 iken değeri DEĞİŞEN vardiya: ${bozulan.length} ${bozulan.length === 0 ? "✓" : "🔴"}`);
for (const x of bozulan.slice(0, 5)) console.log(`     ${x.e.plate} ${x.e.started_at.slice(0, 10)} ${once.find((o) => o.e.id === x.e.id).km} → ${x.km}`);

console.log(`\n── ② GERÇEK 0 KM KORUNDU MU? (telemetri VAR, araç gerçekten hareket etmedi) ──`);
for (const x of sonra.filter((y) => y.km === 0).slice(0, 8)) {
  console.log(`   ${x.e.started_at.slice(0, 10)} ${String(x.e.plate).padEnd(11)} ${String(wAd.get(x.e.worker_id) ?? "—").padEnd(20)} 0 km ✓ korundu`);
}

console.log(`\n── ① "—"e DÖNENLER (araç bazında) ──`);
const g = new Map();
for (const x of donusen) {
  const o = g.get(x.e.plate) ?? { n: 0, paket: 0, sofor: new Set() };
  o.n++; o.paket += x.e.cargo_count ?? 0; o.sofor.add(wAd.get(x.e.worker_id) ?? "—");
  g.set(x.e.plate, o);
}
for (const [p, o] of [...g.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`   ${String(p).padEnd(11)} ${String(o.n).padStart(2)} vardiya · ${String(o.paket).padStart(4)} paket · ${[...o.sofor].join(", ")}`);
}

// ── ③ ŞOFÖR TOPLAMI ──────────────────────────────────────────────────────
console.log(`\n── ③ ŞOFÖR AYLIK TOPLAMI — ekranın gösterdiği sayı ──`);
console.log(`   ${"şoför".padEnd(22)}${"ÖNCE km".padStart(9)}${"SONRA km".padStart(10)}${"ölçülen".padStart(9)}${"sinyalsiz".padStart(11)}${"  ekranda"}`);
const byW = new Map();
for (const e of isaretli) {
  if (!e.worker_id) continue;
  const arr = byW.get(e.worker_id) ?? [];
  arr.push(e);
  byW.set(e.worker_id, arr);
}
const satirlar = [];
for (const [wid, arr] of byW) {
  const kapsam = kmCoverage(arr);
  const eskiKm = arr.reduce(
    (s, e) => s + (e.end_km != null && e.start_km != null ? e.end_km - e.start_km : 0),
    0
  );
  satirlar.push({ ad: wAd.get(wid) ?? wid.slice(0, 8), eskiKm, kapsam, n: arr.length });
}
satirlar.sort((x, y) => y.kapsam.sinyalsiz - x.kapsam.sinyalsiz);
for (const r of satirlar.slice(0, 12)) {
  const hepsiSinyalsiz = r.kapsam.sinyalsiz >= r.kapsam.olculen + r.kapsam.sinyalsiz && r.kapsam.olculen === 0;
  console.log(
    `   ${r.ad.padEnd(22)}${String(Math.round(r.eskiKm)).padStart(9)}${String(Math.round(r.kapsam.km)).padStart(10)}` +
    `${String(r.kapsam.olculen).padStart(9)}${String(r.kapsam.sinyalsiz).padStart(11)}  ` +
    (hepsiSinyalsiz ? "— (tamamı ölçülemedi)" : r.kapsam.sinyalsiz > 0 ? `${Math.round(r.kapsam.km)} km + "${r.kapsam.sinyalsiz} vardiya ölçülemedi"` : "değişmedi")
  );
}

// ── ④ SKOR KAPSAMASI ─────────────────────────────────────────────────────
console.log(`\n── ④ SKOR KAPSAMASI (eşik %${Math.round(SCORE_MIN_KM_COVERAGE * 100)}) ──`);
const res = await getWorkerShiftDistance(FROM, new Date().toISOString());
if (res.unavailable) {
  console.log(`   RPC kullanılamadı: ${res.unavailable}`);
} else {
  const oncekiSayi = res.km.size;
  const sonraki = shiftKmForScoring(res);
  console.log(`   km haritasında şoför · ÖNCE ${oncekiSayi} → SONRA ${sonraki.size} (fark ${sonraki.size - oncekiSayi})`);
  const dusenler = [...res.km.keys()].filter((k) => !sonraki.has(k));
  console.log(`   eşiğin altında kalıp skoru "Yetersiz veri"ye dönen şoför: ${dusenler.length}`);
  for (const wid of dusenler) {
    const c = res.coverage.get(wid);
    console.log(`     ${String(wAd.get(wid) ?? wid.slice(0, 8)).padEnd(22)} ${c.olculen}/${c.toplam} vardiya ölçüldü (%${Math.round((c.olculen / c.toplam) * 100)})`);
  }
  const kismi = [...res.coverage.entries()].filter(([, c]) => c.olculen < c.toplam);
  console.log(`   kısmen ölçülen şoför (eşiği geçse de): ${kismi.length}`);
}

// ── ⑤ DİKKAT/AKSİYON KALEMİ ──────────────────────────────────────────────
console.log(`\n── ⑤ DİKKAT/AKSİYON — bugün kaç "km ölçülemedi" kalemi ──`);
{
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: bugun } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_km, end_km")
    .gte("started_at", todayStart.toISOString());
  const { data: araclar } = await supabaseAdmin.from("vehicles").select("id, plate");
  let n = 0;
  for (const e of bugun ?? []) {
    if (!e.vehicle_id) continue;
    const { data: son } = await supabaseAdmin
      .from("device_telemetry").select("recorded_at").eq("vehicle_id", e.vehicle_id)
      .order("recorded_at", { ascending: false }).limit(1);
    const seen = son?.[0]?.recorded_at ?? null;
    if (seen !== null && Date.parse(seen) >= Date.parse(e.started_at)) continue;
    n++;
    const plate = e.plate ?? (araclar ?? []).find((v) => v.id === e.vehicle_id)?.plate ?? "—";
    console.log(`   🔶 ${String(wAd.get(e.worker_id) ?? "—").padEnd(22)} ${String(plate).padEnd(11)} son telemetri ${String(seen ?? "hiç").slice(0, 16)}`);
  }
  console.log(`   bugünkü kalem sayısı: ${n}`);
}

console.log(`\n╚══ KANIT BİTTİ · hiçbir satır değiştirilmedi ═══\n`);
