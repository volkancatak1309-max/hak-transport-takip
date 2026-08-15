#!/usr/bin/env node
/**
 * KALAN "0 KM" VARDİYALARI GERÇEKTEN 0 MI? — GPS ÇAPRAZ KONTROLÜ.
 * ⚠️ SALT OKUMA.
 *
 * Düzeltmeden sonra 20 vardiya hâlâ "0 km" gösteriyor ve gerekçesi "vardiya
 * penceresinde telemetri VAR". Ama telemetri varlığı tek başına yetmez: odometre
 * hiç gelmemişse ve araç GPS'e göre yol yapmışsa 0 yine uydurmadır.
 * Burada her biri için GPS mesafesi (lib/metrics-distance) hesaplanır.
 *
 * Ayrıca skor kapsama eşiğinin farklı değerlerde kaç şoförü düşürdüğü ölçülür.
 */
import { supabaseAdmin } from "@/lib/supabase";
import { kmDiff } from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import { listVehicleTrack } from "@/lib/telemetry";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { getWorkerShiftDistance } from "@/lib/analytics";

const GUN = Number(process.env.GUN ?? 60);
const FROM = new Date(Date.now() - GUN * 86400000).toISOString();

console.log(`\n╔══ KALAN 0 KM · GPS ÇAPRAZ KONTROLÜ ════════════════════════════════\n`);

const { data: raw } = await supabaseAdmin
  .from("time_entries")
  .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_km, end_km, cargo_count")
  .gte("started_at", FROM)
  .order("started_at");
const { data: workers } = await supabaseAdmin.from("workers").select("id, name");
const wAd = new Map((workers ?? []).map((w) => [w.id, w.name]));

const isaretli = await markKmMeasured(raw ?? []);
const sifirlar = isaretli.filter((e) => kmDiff(e) === 0);

console.log(`── DÜZELTMEDEN SONRA HÂLÂ "0 km" GÖSTEREN ${sifirlar.length} VARDİYA ──`);
console.log(
  `   ${"gün".padEnd(11)}${"plaka".padEnd(11)}${"şoför".padEnd(20)}${"paket".padStart(6)}` +
  `${"telem".padStart(7)}${"odo satırı".padStart(11)}${"GPS km".padStart(8)}   karar`
);
let supheli = 0;
for (const e of sifirlar) {
  const to = e.ended_at ?? new Date().toISOString();
  const [{ count: telem }, { count: odoSatir }] = await Promise.all([
    supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true })
      .eq("vehicle_id", e.vehicle_id).gte("recorded_at", e.started_at).lte("recorded_at", to),
    supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true })
      .eq("vehicle_id", e.vehicle_id).not("odometer_km", "is", null)
      .gte("recorded_at", e.started_at).lte("recorded_at", to),
  ]);
  let gps = null;
  try {
    const track = await listVehicleTrack(e.vehicle_id, e.started_at, to);
    if (track.length > 1) gps = computeDistanceKm(track).km;
  } catch { /* iz okunamadı */ }
  const yanlis = gps !== null && gps > 2;
  if (yanlis) supheli++;
  console.log(
    `   ${String(e.started_at).slice(0, 10).padEnd(11)}${String(e.plate ?? "—").padEnd(11)}` +
    `${String(wAd.get(e.worker_id) ?? "—").slice(0, 19).padEnd(20)}${String(e.cargo_count ?? "—").padStart(6)}` +
    `${String(telem ?? 0).padStart(7)}${String(odoSatir ?? 0).padStart(11)}${(gps === null ? "—" : gps.toFixed(1)).padStart(8)}` +
    `   ${yanlis ? "🔴 GPS yol gösteriyor — 0 YANLIŞ" : "✓ gerçekten hareketsiz"}`
  );
}
console.log(`\n   ⇒ GPS'e göre aslında yol yapmış olan "0 km" vardiya: ${supheli}/${sifirlar.length}`);

// ── SKOR EŞİĞİ DUYARLILIĞI ───────────────────────────────────────────────
console.log(`\n── SKOR KAPSAMA EŞİĞİ DUYARLILIĞI ──`);
const res = await getWorkerShiftDistance(FROM, new Date().toISOString());
if (res.unavailable) {
  console.log(`   RPC yok: ${res.unavailable}`);
} else {
  const oranlar = [...res.coverage.entries()]
    .filter(([wid]) => res.km.has(wid))
    .map(([wid, c]) => ({ ad: wAd.get(wid) ?? wid.slice(0, 8), oran: c.olculen / c.toplam, c }));
  oranlar.sort((a, b) => a.oran - b.oran);
  console.log(`   skorlanabilir şoför (eşiksiz): ${res.km.size}`);
  console.log(`   ${"eşik".padStart(6)}${"kalan şoför".padStart(13)}${"düşen".padStart(8)}`);
  for (const esik of [0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const kalan = oranlar.filter((o) => o.oran >= esik).length;
    console.log(`   ${("%" + Math.round(esik * 100)).padStart(6)}${String(kalan).padStart(13)}${String(res.km.size - kalan).padStart(8)}`);
  }
  console.log(`\n   en düşük kapsamalı 12 şoför:`);
  for (const o of oranlar.slice(0, 12)) {
    console.log(`     ${o.ad.padEnd(22)} ${o.c.olculen}/${o.c.toplam} = %${Math.round(o.oran * 100)}`);
  }
}

console.log(`\n╚══ BİTTİ ═══\n`);
