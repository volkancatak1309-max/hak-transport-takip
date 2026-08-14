#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — DÖRDÜNCÜ TUR: KONTROL VAKALARI (geri DÖNEN sessizlikler).
 * ⚠️ SALT OKUMA.
 *
 * A) Uzun susup GERİ DÖNEN canlı cihazların boşluk imzası (DO-945HL 202sa, DO-775GS 65sa)
 * B) Son "tanımlanamayan" paketler — ölü cihazlar hâlâ deniyor mu?
 * C) "Araç kullanılmıyor" hipotezinin doğrudan testi: kontak KAPALI kalıp
 *    yine de saatlik atım gönderen en uzun süre (tüm filo)
 * D) Her ölü cihaz: son GERÇEK sürüş (kontak=true) ne zamandı?
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

console.log(`\n╔══ DÖRDÜNCÜ TUR · KONTROL VAKALARI ═════════════════════════════════\n`);

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
  D.push({ id: c.id, ident, plaka: arac?.plate ?? c.name, son: t.j?.result?.[0]?.telemetry?.timestamp?.value ?? null });
}
const OLU = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN);
const CANLI = D.filter(d => (NOW - (d.son ?? 0)) <= 2 * GUN);

// ── A) GERİ DÖNEN BOŞLUKLARIN İMZASI ─────────────────────────────────────
console.log(`── A) 30 GÜNDE 6 SAAT+ SUSUP GERİ DÖNEN CANLI CİHAZLAR ──`);
const F = "timestamp,external.powersource.voltage,battery.voltage,engine.ignition.status,position.speed,gsm.signal.level,event.enum,movement.status";
for (const d of CANLI) {
  const lg = await G(`/gw/devices/${d.id}/logs?data=` + q({ from: NOW - 30 * GUN, to: NOW, count: 20000, filter: "event_code==300" }));
  const t = (lg.j?.result ?? []).map(r => r.timestamp).sort((a, b) => a - b);
  const bosluklar = [];
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 6 * 3600) bosluklar.push([t[i - 1], t[i]]);
  if (!bosluklar.length) continue;
  for (const [a, b] of bosluklar) {
    console.log(`\n  ▌ ${d.plaka} — boşluk ${((b - a) / 3600).toFixed(1)} sa   ${z(a)} → ${z(b)}`);
    // boşluktan ÖNCEKİ son 4 mesaj
    const once = await G(`/gw/devices/${d.id}/messages?data=` + q({ from: a - 4 * 3600, to: a + 600, count: 500, fields: F }));
    const mo = once.j?.result ?? [];
    console.log(`     ── boşluktan ÖNCEKİ son 4 mesaj (${mo.length} mesaj bulundu)`);
    for (const m of mo.slice(-4)) {
      console.log(`        ${z(m.timestamp)} besle ${String(m["external.powersource.voltage"] ?? "—").padStart(7)} akü ${String(m["battery.voltage"] ?? "—").padStart(6)}` +
        ` kontak ${m["engine.ignition.status"] === undefined ? "—" : m["engine.ignition.status"] ? "AÇIK" : "kap"} gsm ${m["gsm.signal.level"] ?? "—"} olay ${m["event.enum"] ?? "—"}`);
    }
    // boşluktan SONRAKİ ilk 4 mesaj
    const sonra = await G(`/gw/devices/${d.id}/messages?data=` + q({ from: b - 600, to: b + 4 * 3600, count: 500, fields: F }));
    const ms = sonra.j?.result ?? [];
    console.log(`     ── boşluktan SONRAKİ ilk 4 mesaj`);
    for (const m of ms.slice(0, 4)) {
      console.log(`        ${z(m.timestamp)} besle ${String(m["external.powersource.voltage"] ?? "—").padStart(7)} akü ${String(m["battery.voltage"] ?? "—").padStart(6)}` +
        ` kontak ${m["engine.ignition.status"] === undefined ? "—" : m["engine.ignition.status"] ? "AÇIK" : "kap"} gsm ${m["gsm.signal.level"] ?? "—"} olay ${m["event.enum"] ?? "—"}`);
    }
    // boşluk İÇİNDE gerçekten mesaj var mı? (cihaz sakladı, sonra topluca gönderdi mi?)
    const ic = await G(`/gw/devices/${d.id}/messages?data=` + q({ from: a + 600, to: b - 600, count: 5, fields: "timestamp" }));
    console.log(`     ── boşluk İÇİNDE cihaz RTC'li mesaj: ${(ic.j?.result ?? []).length}  ` +
      `(0 = cihaz kayıt bile tutmamış · >0 = kayıt tuttu, sonradan gönderdi)`);
  }
}

// ── B) SON TANIMLANAMAYAN PAKETLER ───────────────────────────────────────
console.log(`\n── B) EN SON TANIMLANAMAYAN PAKETLER (kanal 1399419) ──`);
for (const rev of [true]) {
  const up = await G(`/gw/channels/1399419/idents/unidentified/packets?data=` + q({ from: NOW - 30 * GUN, to: NOW, count: 20, reverse: rev }));
  const rows = up.j?.result ?? [];
  console.log(`  son 30 günde ${rows.length} kayıt (en yeniden) ${up.ok ? "" : `HATA ${up.s} ${JSON.stringify(up.hata)}`}`);
  for (const r of rows.slice(0, 12)) {
    console.log(`    ${z(r.timestamp)} kaynak ${String(r.source ?? "—").padEnd(22)} yön ${r.direction ?? "—"} bayt ${(r.data ?? "").length / 2} veri ${String(r.data ?? "").slice(0, 48)}`);
  }
}

// ── C) "ARAÇ KULLANILMIYOR" HİPOTEZİNİN DOĞRUDAN TESTİ ───────────────────
console.log(`\n── C) PARK HÂLİNDE (kontak kapalı) KESİNTİSİZ ATIM SÜRESİ ──`);
console.log(`   Soru: bir FMC003 park hâlinde kaç gün susmadan atım gönderiyor?`);
console.log(`   ${"plaka".padEnd(11)}${"en uzun kontak-kapalı seri".padStart(27)}${"o seride atım".padStart(15)}${"  durum"}`);
for (const d of [...CANLI, ...OLU]) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: (d.son ?? NOW) - 21 * GUN, to: (d.son ?? NOW) + 60, count: 60000, fields: "timestamp,engine.ignition.status" }));
  const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
  if (!ms.length) { console.log(`   ${d.plaka.padEnd(11)} mesaj yok`); continue; }
  let bas = null, enUzun = 0, enUzunN = 0, n = 0;
  for (const m of ms) {
    const kontak = m["engine.ignition.status"];
    if (kontak === false) { if (bas === null) { bas = m.timestamp; n = 0; } n++; }
    else { if (bas !== null) { const sure = ms[ms.indexOf(m) - 1].timestamp - bas; if (sure > enUzun) { enUzun = sure; enUzunN = n; } } bas = null; }
  }
  if (bas !== null) { const sure = ms[ms.length - 1].timestamp - bas; if (sure > enUzun) { enUzun = sure; enUzunN = n; } }
  console.log(`   ${d.plaka.padEnd(11)}${((enUzun / 86400).toFixed(2) + " gün").padStart(27)}${String(enUzunN).padStart(15)}  ${OLU.includes(d) ? "ÖLÜ" : "canlı"}`);
}

// ── D) ÖLÜLERİN SON GERÇEK SÜRÜŞÜ ────────────────────────────────────────
console.log(`\n── D) HER ÖLÜ CİHAZ: SON GERÇEK SÜRÜŞ (kontak=AÇIK) ──`);
for (const d of OLU) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: d.son - 21 * GUN, to: d.son + 60, count: 60000, fields: "timestamp,engine.ignition.status,position.speed" }));
  const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
  const acik = ms.filter(m => m["engine.ignition.status"] === true);
  const sonAcik = acik.length ? acik[acik.length - 1].timestamp : null;
  console.log(
    `  ${d.plaka.padEnd(11)} 21 günlük pencerede mesaj ${String(ms.length).padStart(6)} · kontak AÇIK mesaj ${String(acik.length).padStart(5)}` +
    ` · SON SÜRÜŞ ${z(sonAcik)} · susmadan ${sonAcik ? ((d.son - sonAcik) / 3600).toFixed(1) : "—"} sa önce`
  );
}

console.log(`\n╚══ DÖRDÜNCÜ TUR BİTTİ ═══\n`);
