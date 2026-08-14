#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — ALTINCI TUR: DÜZELTME + ODOMETRE KANITI.
 * ⚠️ SALT OKUMA.
 *
 * DÜZELTME: 4. turdaki "boşluk" ölçümü event_code==300 (bağlantı) logundan
 * türetilmişti. Cihaz TEK bir uzun TCP oturumu tutunca yeni 300 kaydı olmuyor →
 * o ölçüm sessizliği DEĞİL oturum ömrünü ölçüyordu. Burada boşluk MESAJ
 * ekseninden yeniden hesaplanır.
 *
 * 1) 21 günde MESAJ ekseninde 4 saatten uzun boşluklar (tüm filo)
 * 2) Besleme 0 V epizotları — tüm filo, 45 gün: kim, ne zaman, ne kadar, döndü mü
 * 3) ODOMETRE KANITI: kesinti boyunca araç sürüldü mü? (can.vehicle.mileage)
 * 4) DO-945HL kontak geçmişi 04→14.08 — 8 vardiya / 2763 paket gerçek mi?
 */
import { supabaseAdmin } from "@/lib/supabase";
const T = process.env.FLESPI_TOKEN;
if (!T) { console.error("✗ FLESPI_TOKEN yok"); process.exit(1); }
const H = { Authorization: `FlespiToken ${T}` };
const NOW = Math.floor(Date.now() / 1000), GUN = 86400;
async function G(y) {
  const r = await fetch("https://flespi.io" + y, { headers: H, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, s: r.status, hata: j?.errors ?? null, j };
}
const q = (o) => encodeURIComponent(JSON.stringify(o));
const z = (t) => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—");

console.log(`\n╔══ ALTINCI TUR · DÜZELTME + ODOMETRE ═══════════════════════════════\n`);

const dv = await G("/gw/devices/all");
const cihazlar = dv.j?.result ?? [];
const { data: araclar } = await supabaseAdmin.from("vehicles").select("id, plate, imei, flespi_device_id");
const byDev = new Map((araclar ?? []).filter(v => v.flespi_device_id).map(v => [String(v.flespi_device_id), v]));
const byImei = new Map((araclar ?? []).filter(v => v.imei).map(v => [String(v.imei), v]));
const D = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const t = await G(`/gw/devices/${c.id}/telemetry/timestamp`);
  const arac = byDev.get(String(c.id)) ?? byImei.get(ident) ?? null;
  D.push({ id: c.id, arac, plaka: arac?.plate ?? c.name, son: t.j?.result?.[0]?.telemetry?.timestamp?.value ?? null });
}
D.sort((a, b) => a.plaka.localeCompare(b.plaka));
const OLU = new Set(D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN).map(d => d.plaka));

// ── 1) MESAJ EKSENİNDE BOŞLUK ────────────────────────────────────────────
console.log(`── 1) 21 GÜNDE MESAJ EKSENİNDE 4 SAAT+ BOŞLUK (doğru ölçüm) ──`);
console.log(`   ${"plaka".padEnd(11)}${"mesaj".padStart(7)}${"4sa+ boşluk".padStart(12)}${"EN UZUN".padStart(10)}   en uzun boşluğun yeri`);
const boslukKaydi = new Map();
for (const d of D) {
  const from = NOW - 21 * GUN;
  const mg = await G(`/gw/devices/${d.id}/messages?data=` + q({ from, to: NOW, count: 100000, fields: "timestamp" }));
  const ts = (mg.j?.result ?? []).map(m => m.timestamp).sort((a, b) => a - b);
  if (!ts.length) { console.log(`   ${d.plaka.padEnd(11)}${"0".padStart(7)}  — pencerede hiç mesaj yok (${21} gündür sessiz)`); continue; }
  const g = [];
  // pencere başı ve sonu da boşluk sayılır
  const seri = [from, ...ts, NOW];
  for (let i = 1; i < seri.length; i++) if (seri[i] - seri[i - 1] > 4 * 3600) g.push([seri[i - 1], seri[i]]);
  const enUzun = g.length ? g.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : null;
  boslukKaydi.set(d.plaka, g);
  console.log(
    `   ${(OLU.has(d.plaka) ? "†" : " ") + d.plaka.padEnd(10)}${String(ts.length).padStart(7)}${String(g.length).padStart(12)}` +
    `${(enUzun ? ((enUzun[1] - enUzun[0]) / 3600).toFixed(1) + "sa" : "—").padStart(10)}   ${enUzun ? `${z(enUzun[0])} → ${z(enUzun[1])}` : ""}`
  );
}

// ── 2) BESLEME 0 V EPİZOTLARI ────────────────────────────────────────────
console.log(`\n── 2) BESLEME KESİNTİSİ (external.powersource.voltage < 1 V) · 45 gün · TÜM FİLO ──`);
const kesintiler = [];
for (const d of D) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: NOW - 45 * GUN, to: NOW, count: 100000, filter: "external.powersource.voltage<1",
        fields: "timestamp,external.powersource.voltage,battery.voltage,position.speed,can.vehicle.mileage" }));
  const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
  if (!ms.length) continue;
  // epizot = ardışık 0 V mesajları, aralarında 6 saatten büyük boşluk varsa ayrı epizot
  const ep = [];
  let cur = [ms[0]];
  for (let i = 1; i < ms.length; i++) {
    if (ms[i].timestamp - cur[cur.length - 1].timestamp > 6 * 3600) { ep.push(cur); cur = []; }
    cur.push(ms[i]);
  }
  ep.push(cur);
  for (const e of ep) kesintiler.push({ d, e });
}
console.log(`   besleme kesintisi YAŞAYAN cihaz sayısı: ${new Set(kesintiler.map(k => k.d.plaka)).size}/${D.length} · toplam epizot ${kesintiler.length}`);
console.log(`\n   ${"plaka".padEnd(11)}${"kesinti başı (UTC)".padEnd(21)}${"0V mesaj".padStart(9)}${"yedekle süre".padStart(13)}${"akü V".padStart(9)}${"hız var".padStart(8)}   sonra`);
kesintiler.sort((a, b) => a.e[0].timestamp - b.e[0].timestamp);
for (const { d, e } of kesintiler) {
  const bas = e[0].timestamp, bit = e[e.length - 1].timestamp;
  // kesintiden sonra ilk NORMAL besleme mesajı
  const sonra = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: bit + 1, to: NOW, count: 3, fields: "timestamp,external.powersource.voltage,can.vehicle.mileage" }));
  const s = (sonra.j?.result ?? [])[0] ?? null;
  const hizli = e.filter(m => (m["position.speed"] ?? 0) > 2).length;
  console.log(
    `   ${(OLU.has(d.plaka) ? "†" : " ") + d.plaka.padEnd(10)}${z(bas).padEnd(21)}${String(e.length).padStart(9)}` +
    `${((bit - bas) / 60).toFixed(0).padStart(10)} dk${String(e[e.length - 1]["battery.voltage"] ?? "—").padStart(9)}${String(hizli).padStart(8)}   ` +
    (s ? `DÖNDÜ ${z(s.timestamp)} (${((s.timestamp - bit) / 3600).toFixed(1)} sa sonra) besleme ${s["external.powersource.voltage"]} V` : "HÂLÂ SESSİZ")
  );
  // ODOMETRE KANITI
  if (s) {
    const kmOnce = [...e].reverse().find(m => typeof m["can.vehicle.mileage"] === "number")?.["can.vehicle.mileage"] ?? null;
    const sonraMs = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: bit + 1, to: bit + 3 * GUN, count: 2000, filter: "can.vehicle.mileage>0", fields: "timestamp,can.vehicle.mileage" }));
    const kmSonra = (sonraMs.j?.result ?? [])[0]?.["can.vehicle.mileage"] ?? null;
    // kesintiden ÖNCEKİ son bilinen odometre
    const onceMs = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: bas - 3 * GUN, to: bas, count: 5000, filter: "can.vehicle.mileage>0", fields: "timestamp,can.vehicle.mileage" }));
    const onceArr = onceMs.j?.result ?? [];
    const kmBas = onceArr.length ? onceArr[onceArr.length - 1]["can.vehicle.mileage"] : kmOnce;
    if (kmBas !== null && kmSonra !== null) {
      console.log(`        ⇒ ODOMETRE: kesinti öncesi ${kmBas} km → sonrası ${kmSonra} km · FARK ${(kmSonra - kmBas).toFixed(0)} km` +
        `  ${kmSonra - kmBas > 5 ? "→ ARAÇ KESİNTİ BOYUNCA SÜRÜLDÜ" : "→ araç sürülmedi"}`);
    }
  }
}

// ── 3) ÖLÜLERİN SON ODOMETRESİ ↔ VARDİYA KM ──────────────────────────────
console.log(`\n── 3) ÖLÜ ARAÇLAR: cihazın son odometresi ↔ DB vardiya km ──`);
for (const d of D.filter(x => OLU.has(x.plaka) && x.arac)) {
  const t = await G(`/gw/devices/${d.id}/telemetry/can.vehicle.mileage`);
  const km = t.j?.result?.[0]?.telemetry?.["can.vehicle.mileage"]?.value ?? null;
  const { data: v } = await supabaseAdmin.from("time_entries")
    .select("started_at, start_km, end_km").eq("plate", d.arac.plate)
    .order("started_at", { ascending: false }).limit(3);
  console.log(`   ${d.plaka.padEnd(11)} cihaz odometresi ${String(km ?? "—").padStart(8)} · son 3 vardiya km: ` +
    (v ?? []).map(r => `${String(r.started_at).slice(5, 10)} ${r.start_km}→${r.end_km ?? "—"}`).join(" | "));
}

// ── 4) DO-945HL KONTAK GEÇMİŞİ ───────────────────────────────────────────
console.log(`\n── 4) DO-945HL 04→14.08 — 8 vardiya / 2763 paket kaydı gerçek mi? ──`);
{
  const d = D.find(x => x.plaka === "DO-945HL");
  const from = Math.floor(new Date("2026-08-04T21:00:00Z").getTime() / 1000);
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from, to: NOW, count: 100000, fields: "timestamp,engine.ignition.status,position.speed,can.vehicle.mileage,external.powersource.voltage" }));
  const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
  console.log(`   pencerede mesaj ${ms.length}`);
  // günlük: kontak açık mesaj sayısı + odometre
  const gunluk = new Map();
  for (const m of ms) {
    const g = z(m.timestamp).slice(0, 10);
    const o = gunluk.get(g) ?? { n: 0, acik: 0, kmMin: Infinity, kmMax: -Infinity, hiz: 0 };
    o.n++;
    if (m["engine.ignition.status"] === true) o.acik++;
    if ((m["position.speed"] ?? 0) > 5) o.hiz++;
    const km = m["can.vehicle.mileage"];
    if (typeof km === "number" && km > 0) { o.kmMin = Math.min(o.kmMin, km); o.kmMax = Math.max(o.kmMax, km); }
    gunluk.set(g, o);
  }
  console.log(`   ${"gün".padEnd(12)}${"mesaj".padStart(7)}${"kontak AÇIK".padStart(12)}${"hız>5".padStart(7)}${"odometre".padStart(20)}`);
  for (const [g, o] of [...gunluk.entries()].sort()) {
    console.log(`   ${g.padEnd(12)}${String(o.n).padStart(7)}${String(o.acik).padStart(12)}${String(o.hiz).padStart(7)}` +
      `${(o.kmMax > 0 ? `${o.kmMin} → ${o.kmMax}` : "—").padStart(20)}`);
  }
}

console.log(`\n╚══ ALTINCI TUR BİTTİ ═══\n`);
