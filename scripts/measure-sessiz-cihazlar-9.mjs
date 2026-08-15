#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — DOKUZUNCU TUR: SON DÜZELTMELER.
 * ⚠️ SALT OKUMA.
 *  1) Kiracı ayrımlı kullanım testi — HAK61 şoförü ↔ HAK61 aracı (Sendigo hariç)
 *  2) Kanaldaki KAYITSIZ ident kim?
 *  3) İKİ POPÜLASYONUN GÜNÜN SAATİ DAĞILIMI — besleme kesintileri ↔ sessiz ölümler
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

console.log(`\n╔══ DOKUZUNCU TUR · SON DÜZELTMELER ═════════════════════════════════\n`);

const dv = await G("/gw/devices/all");
const cihazlar = dv.j?.result ?? [];
const { data: araclar } = await supabaseAdmin.from("vehicles").select("id, plate, imei, flespi_device_id, is_test, status");
const byDev = new Map((araclar ?? []).filter(v => v.flespi_device_id).map(v => [String(v.flespi_device_id), v]));
const byImei = new Map((araclar ?? []).filter(v => v.imei).map(v => [String(v.imei), v]));
const D = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const arac = byDev.get(String(c.id)) ?? byImei.get(ident) ?? null;
  const t = await G(`/gw/devices/${c.id}/telemetry/timestamp`);
  D.push({ id: c.id, ident, arac, hak61: !!arac, plaka: arac?.plate ?? c.name, son: t.j?.result?.[0]?.telemetry?.timestamp?.value ?? null });
}
const HAK = D.filter(d => d.hak61);
console.log(`   flespi cihazı ${D.length} · HAK61 DB'sinde karşılığı olan ${HAK.length} · dışarıda ${D.length - HAK.length}`);
console.log(`   dışarıdakiler: ${D.filter(d => !d.hak61).map(d => d.plaka).join(", ")}`);

// ── 1) KİRACI AYRIMLI KULLANIM TESTİ ────────────────────────────────────
console.log(`\n── 1) HAK61 ŞOFÖRÜ ↔ HAK61 ARACI (Sendigo hariç) ──`);
console.log(`   ${"gün".padEnd(12)}${"şoför".padStart(7)}${"sürülen HAK61 aracı".padStart(22)}${"  açık"}`);
for (const gun of ["2026-08-05", "2026-08-08", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]) {
  const g0 = Math.floor(new Date(gun + "T00:00:00Z").getTime() / 1000), g1 = g0 + GUN;
  const { data: v } = await supabaseAdmin.from("time_entries")
    .select("worker_id, plate").gte("started_at", new Date(g0 * 1000).toISOString())
    .lt("started_at", new Date(g1 * 1000).toISOString());
  const sofor = new Set((v ?? []).map(x => x.worker_id));
  const surulen = [];
  for (const d of HAK) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: g0, to: g1, count: 3, filter: "engine.ignition.status==true", fields: "timestamp" }));
    if ((mg.j?.result ?? []).length > 0) surulen.push(d.plaka);
  }
  const acik = sofor.size - surulen.length;
  console.log(
    `   ${gun.padEnd(12)}${String(sofor.size).padStart(7)}${String(surulen.length).padStart(22)}` +
    `  ${acik > 0 ? `+${acik} şoför izlenmeyen araçta olmalı` : acik === 0 ? "tam denk" : `${-acik} fazla araç sürülmüş`}`
  );
  const vardiyaPlaka = [...new Set((v ?? []).map(x => x.plate).filter(Boolean))];
  const surulmeyen = vardiyaPlaka.filter(p => !surulen.includes(p));
  console.log(`       vardiyası olup SÜRÜLMEYEN: ${surulmeyen.sort().join(", ") || "yok"}`);
  const vardiyasiz = surulen.filter(p => !vardiyaPlaka.includes(p));
  console.log(`       sürülüp VARDİYASI OLMAYAN: ${vardiyasiz.sort().join(", ") || "yok"}`);
}

// ── 2) KAYITSIZ IDENT ───────────────────────────────────────────────────
console.log(`\n── 2) KANALDAKİ KAYITSIZ IDENT ──`);
{
  const idn = await G(`/gw/channels/1399419/idents/all`);
  const idents = idn.j?.result ?? [];
  const cihazIdent = new Set(D.map(d => d.ident));
  for (const f of idents) {
    const id = String(f.ident ?? f.id ?? "");
    if (cihazIdent.has(id) || id === "unidentified" || !id) continue;
    const dbArac = (araclar ?? []).find(v => String(v.imei) === id);
    console.log(`   ident …${id.slice(-6)} (uzunluk ${id.length}) · device_id ${f.device_id} · son etkin ${z(f.last_active)}`);
    console.log(`     DB'de bu IMEI'ye sahip araç: ${dbArac ? `${dbArac.plate} (test ${dbArac.is_test}, durum ${dbArac.status})` : "YOK"}`);
    console.log(`     ölü cihazların IMEI'siyle eşleşme: ${D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN).some(d => d.ident.slice(-6) === id.slice(-6)) ? "VAR ⚠️" : "yok"}`);
  }
}

// ── 3) İKİ POPÜLASYONUN GÜNÜN SAATİ ─────────────────────────────────────
console.log(`\n── 3) GÜNÜN SAATİ: besleme kesintileri ↔ sessiz ölümler (aynı dağılım mı?) ──`);
{
  const kesintiSaat = [];
  for (const d of D) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: NOW - 45 * GUN, to: NOW, count: 100000, filter: "external.powersource.voltage<1", fields: "timestamp" }));
    const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
    if (!ms.length) continue;
    let cur = ms[0].timestamp, once = ms[0].timestamp;
    kesintiSaat.push(cur);
    for (let i = 1; i < ms.length; i++) {
      if (ms[i].timestamp - once > 6 * 3600) kesintiSaat.push(ms[i].timestamp);
      once = ms[i].timestamp;
    }
  }
  const saat = (t) => new Date(t * 1000).getUTCHours() + new Date(t * 1000).getUTCMinutes() / 60;
  const ks = kesintiSaat.map(saat).sort((a, b) => a - b);
  console.log(`   BESLEME KESİNTİSİ epizodu ${ks.length} · saat aralığı ${ks[0].toFixed(2)} – ${ks[ks.length - 1].toFixed(2)} UTC`);
  const kova = new Array(24).fill(0);
  for (const h of ks) kova[Math.floor(h)]++;
  console.log(`   saatlik: ${kova.map((n, i) => n ? `${String(i).padStart(2, "0")}:${n}` : null).filter(Boolean).join(" ")}`);

  const OLUP = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN && !["DO-746GU", "SENDIGO-4"].includes(d.plaka));
  const os = OLUP.map(d => saat(d.son)).sort((a, b) => a - b);
  console.log(`\n   SESSİZ ÖLÜM ${os.length} · saat aralığı ${os[0].toFixed(2)} – ${os[os.length - 1].toFixed(2)} UTC`);
  console.log(`   saatler: ${os.map(h => h.toFixed(2)).join(", ")}`);
  const cakisma = os.filter(h => h >= ks[0] && h <= ks[ks.length - 1]).length;
  console.log(`\n   ⇒ sessiz ölümlerin kaçı, besleme-kesintisi saat aralığına (${ks[0].toFixed(2)}–${ks[ks.length - 1].toFixed(2)}) düşüyor: ${cakisma}/${os.length}`);
  console.log(`   ⇒ ${cakisma === 0 ? "İKİ POPÜLASYONUN SAAT DAĞILIMI HİÇ ÇAKIŞMIYOR — farklı mekanizma." : "çakışma var, ayrım zayıf."}`);
  // gece bandında kaç kesinti var? (16:23 sonrası)
  const gece = ks.filter(h => h >= 19.5).length;
  console.log(`   ⇒ 19:30 UTC'den SONRA yaşanan besleme kesintisi: ${gece}/${ks.length}`);
  console.log(`   ⇒ 19:30 UTC'den SONRA yaşanan sessiz ölüm      : ${os.filter(h => h >= 19.5).length}/${os.length}`);
}

console.log(`\n╚══ DOKUZUNCU TUR BİTTİ ═══\n`);
