#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — ÜÇÜNCÜ TUR: HAM SON KAYIT + HİPOTEZ ÇÜRÜTME.
 * ⚠️ SALT OKUMA. Yalnız GET (flespi) + select (Supabase).
 *
 *  1) Her ölü cihazın SON MESAJININ TAM HÂLİ (bütün alanlar)
 *  2) gsm.jamming.alarm.status — sinyal karıştırma var mıydı?
 *  3) IMEI parti analizi — aynı gün susanlar aynı partiden mi?
 *  4) Kanal ident izi + "unidentified" trafik — cihaz hâlâ deniyor mu?
 *  5) Susma sonrası vardiyaların GERÇEKLİĞİ (süre, paket, mola)
 *  6) TABAN ORAN — canlı cihazlarda 6sa+ boşluk ne sıklıkta?
 *  7) 0 V sonrası konum kutusu — cihaz gerçekten hareket etti mi?
 */
import { supabaseAdmin } from "@/lib/supabase";

const T = process.env.FLESPI_TOKEN;
if (!T) { console.error("✗ FLESPI_TOKEN yok"); process.exit(1); }
const H = { Authorization: `FlespiToken ${T}` };
const NOW = Math.floor(Date.now() / 1000);
const GUN = 86400;
async function G(y) {
  const r = await fetch("https://flespi.io" + y, { headers: H, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, s: r.status, hata: j?.errors ?? null, j };
}
const q = (o) => encodeURIComponent(JSON.stringify(o));
const z = (t) => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—");

console.log(`\n╔══ ÜÇÜNCÜ TUR · HAM KAYIT + ÇÜRÜTME ════════════════════════════════\n`);

const dv = await G("/gw/devices/all");
const cihazlar = dv.j?.result ?? [];
const { data: araclar } = await supabaseAdmin
  .from("vehicles").select("id, plate, imei, flespi_device_id, status, assigned_worker_id");
const byDev = new Map((araclar ?? []).filter(v => v.flespi_device_id).map(v => [String(v.flespi_device_id), v]));
const byImei = new Map((araclar ?? []).filter(v => v.imei).map(v => [String(v.imei), v]));

const D = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const t = await G(`/gw/devices/${c.id}/telemetry/timestamp,gsm.jamming.alarm.status,external.powersource.voltage`);
  const tel = t.j?.result?.[0]?.telemetry ?? {};
  const arac = byDev.get(String(c.id)) ?? byImei.get(ident) ?? null;
  D.push({
    id: c.id, ad: c.name, ident, arac, plaka: arac?.plate ?? c.name,
    son: tel.timestamp?.value ?? null,
    jam: tel["gsm.jamming.alarm.status"]?.value ?? null,
    jamTs: tel["gsm.jamming.alarm.status"]?.ts ?? null,
    besleme: tel["external.powersource.voltage"]?.value ?? null,
  });
}
D.sort((a, b) => (a.son ?? 0) - (b.son ?? 0));
const OLU = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN);
const CANLI = D.filter(d => (NOW - (d.son ?? 0)) <= 2 * GUN);

// ── 1) HAM SON MESAJ ─────────────────────────────────────────────────────
console.log(`── 1) HER ÖLÜ CİHAZIN SON MESAJININ TAM HÂLİ ──`);
for (const d of OLU) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` + q({ from: d.son - 5, to: d.son + 5, count: 5 }));
  const m = (mg.j?.result ?? []).find(x => x.timestamp === d.son) ?? (mg.j?.result ?? [])[0];
  console.log(`\n  ▌ ${d.plaka}  (#${d.id})  son mesaj ${z(d.son)}`);
  if (!m) { console.log(`     mesaj çekilemedi (${mg.s})`); continue; }
  const anahtarlar = Object.keys(m).sort();
  for (const a of anahtarlar) {
    if (a === "ident" || a === "peer" || a === "device.name") continue; // gizlilik/gürültü
    const v = m[a];
    console.log(`     ${a.padEnd(34)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
}

// ── 2) JAMMING ───────────────────────────────────────────────────────────
console.log(`\n── 2) SİNYAL KARIŞTIRMA (gsm.jamming.alarm.status) ──`);
for (const d of D) {
  if (d.jam) console.log(`  ⚠️ ${d.plaka.padEnd(11)} jamming=${d.jam} (${z(d.jamTs)})`);
}
console.log(`  jamming alarmı AÇIK olan cihaz: ${D.filter(d => d.jam).length}/${D.length}`);
console.log(`  ölülerde jamming değeri: ${OLU.map(d => `${d.plaka}=${d.jam}`).join(" · ")}`);

// ── 3) IMEI PARTİ ANALİZİ ────────────────────────────────────────────────
console.log(`\n── 3) IMEI PARTİ ANALİZİ (TAC = ilk 8 hane · seri = son 6, maskeli) ──`);
const grupla = (arr) => {
  const m = new Map();
  for (const d of arr) {
    const tac = d.ident.slice(0, 8);
    if (!m.has(tac)) m.set(tac, []);
    m.get(tac).push(d);
  }
  return m;
};
for (const [tac, arr] of grupla(D)) {
  console.log(`  TAC ${tac}: ${arr.length} cihaz · ölü ${arr.filter(d => OLU.includes(d)).length}`);
}
console.log(`\n  aynı gün susanların IMEI seri numaraları (sıralı, son 6 hane):`);
const gunG = new Map();
for (const d of OLU) {
  const g = z(d.son).slice(0, 10);
  if (!gunG.has(g)) gunG.set(g, []);
  gunG.get(g).push(d);
}
const seri = (d) => Number(d.ident.slice(-7, -1)); // kontrol hanesi hariç
for (const [g, arr] of [...gunG.entries()].sort()) {
  const s = arr.map(d => ({ p: d.plaka, n: seri(d) })).sort((a, b) => a.n - b.n);
  console.log(`    ${g}: ${s.map(x => `${x.p}(…${String(x.n).slice(-4)})`).join(" ")}` +
    (s.length > 1 ? `  → aradaki fark: ${s.slice(1).map((x, i) => x.n - s[i].n).join(", ")}` : ""));
}
// canlıların seri aralığı, kıyas için
const canliSeri = CANLI.map(seri).sort((a, b) => a - b);
console.log(`    KIYAS · canlı seri aralığı genişliği: ${canliSeri[canliSeri.length - 1] - canliSeri[0]}`);
console.log(`    KIYAS · ölü  seri aralığı genişliği: ${Math.max(...OLU.map(seri)) - Math.min(...OLU.map(seri))}`);

// ── 4) KANAL IDENT İZİ + UNIDENTIFIED ────────────────────────────────────
console.log(`\n── 4) KANAL IDENT İZİ — cihaz hâlâ bağlanmayı DENİYOR mu? ──`);
const idn = await G(`/gw/channels/1399419/idents/all`);
const idents = idn.j?.result ?? [];
console.log(`  kanalın tanıdığı ident sayısı: ${idents.length}${idn.ok ? "" : ` (HATA ${idn.s} ${JSON.stringify(idn.hata)})`}`);
if (idents.length) console.log(`  örnek alanlar: ${Object.keys(idents[0]).join(", ")}`);
for (const d of OLU) {
  const rec = idents.find(x => String(x.id ?? x.ident) === d.ident);
  console.log(`    ${d.plaka.padEnd(11)} ${rec ? JSON.stringify(rec) : "kanal ident listesinde YOK"}`);
}
{
  const up = await G(`/gw/channels/1399419/idents/unidentified/packets?data=` + q({ from: NOW - 14 * GUN, to: NOW, count: 50 }));
  const rows = up.j?.result ?? [];
  console.log(`\n  son 14 günde TANIMLANAMAYAN paket: ${rows.length}${up.ok ? "" : ` (HATA ${up.s} ${JSON.stringify(up.hata)})`}`);
  for (const r of rows.slice(0, 5)) console.log(`    ${z(r.timestamp)} ${String(r.source ?? "")} ${String(r.data ?? "").slice(0, 60)}`);
}
// susma sonrası HERHANGİ bir kanal olayı (100 = bağlantı kabul, ident'ten önce de olur)
console.log(`\n  susma ANINDAN SONRA o ident'e ait kanal olayı:`);
for (const d of OLU) {
  const cl = await G(`/gw/channels/1399419/logs?data=` +
    q({ from: d.son + 120, to: NOW, count: 100, filter: `ident=="${d.ident}"` }));
  console.log(`    ${d.plaka.padEnd(11)} ${(cl.j?.result ?? []).length} olay ${cl.ok ? "" : `(HATA ${cl.s})`}`);
}

// ── 5) SUSMA SONRASI VARDİYALARIN GERÇEKLİĞİ ─────────────────────────────
console.log(`\n── 5) SUSMA SONRASI VARDİYALAR — gerçek kullanım mı? ──`);
for (const d of OLU) {
  if (!d.arac) continue;
  const sonISO = new Date((d.son ?? 0) * 1000).toISOString();
  const { data: v } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, ended_at, start_km, end_km, cargo_count, break_minutes")
    .eq("plate", d.arac.plate).gte("started_at", sonISO).order("started_at");
  const rows = v ?? [];
  const sureler = rows.filter(r => r.ended_at)
    .map(r => (new Date(r.ended_at) - new Date(r.started_at)) / 3600000);
  const paket = rows.reduce((a, r) => a + (r.cargo_count ?? 0), 0);
  console.log(
    `  ${d.plaka.padEnd(11)} vardiya ${String(rows.length).padStart(2)} · kapanmış ${sureler.length}` +
    ` · ort süre ${sureler.length ? (sureler.reduce((a, b) => a + b, 0) / sureler.length).toFixed(1) : "—"} sa` +
    ` · toplam paket ${paket}` +
    ` · km değişimi ${rows.length ? (Math.max(...rows.map(r => r.end_km ?? r.start_km ?? 0)) - Math.min(...rows.map(r => r.start_km ?? 0))) : "—"}`
  );
}

// ── 6) TABAN ORAN — canlı cihazlarda uzun boşluk ─────────────────────────
console.log(`\n── 6) TABAN ORAN — CANLI cihazlarda 30 günde 6sa+ bağlantı boşluğu ──`);
let toplamBosluk = 0, enUzunlar = [];
for (const d of CANLI) {
  const lg = await G(`/gw/devices/${d.id}/logs?data=` +
    q({ from: NOW - 30 * GUN, to: NOW, count: 20000, filter: "event_code==300" }));
  const t = (lg.j?.result ?? []).map(r => r.timestamp).sort((a, b) => a - b);
  let n = 0, enUzun = 0;
  for (let i = 1; i < t.length; i++) {
    const g = t[i] - t[i - 1];
    if (g > 6 * 3600) n++;
    if (g > enUzun) enUzun = g;
  }
  toplamBosluk += n;
  enUzunlar.push({ p: d.plaka, n, enUzun: enUzun / 3600, bag: t.length });
}
enUzunlar.sort((a, b) => b.enUzun - a.enUzun);
console.log(`  CANLI ${CANLI.length} cihazda toplam 6sa+ boşluk: ${toplamBosluk}`);
console.log(`  en uzun boşluk yaşayan 8 canlı cihaz:`);
for (const x of enUzunlar.slice(0, 8)) {
  console.log(`    ${x.p.padEnd(11)} bağlantı ${String(x.bag).padStart(4)} · 6sa+ boşluk ${x.n} · EN UZUN ${x.enUzun.toFixed(1)} sa`);
}
console.log(`  ⇒ ÖLÜLERİN sessizlik süresi: ${OLU.map(d => `${d.plaka} ${((NOW - d.son) / 3600).toFixed(0)}sa`).join(" · ")}`);

// ── 7) 0 V SONRASI KONUM KUTUSU ──────────────────────────────────────────
console.log(`\n── 7) BESLEMESİ KESİLENLERDE 0 V SONRASI GERÇEK HAREKET ──`);
for (const d of OLU.filter(x => x.besleme === 0)) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: d.son - 6 * 3600, to: d.son + 60, count: 5000, fields: "timestamp,external.powersource.voltage,position.latitude,position.longitude,position.speed,position.satellites" }));
  const ms = (mg.j?.result ?? []).filter(m => m["external.powersource.voltage"] === 0 && m["position.latitude"]);
  if (!ms.length) { console.log(`  ${d.plaka}: 0 V'li konumlu mesaj yok`); continue; }
  const la = ms.map(m => m["position.latitude"]), lo = ms.map(m => m["position.longitude"]);
  const dLat = (Math.max(...la) - Math.min(...la)) * 111320;
  const dLng = (Math.max(...lo) - Math.min(...lo)) * 111320 * Math.cos((la[0] * Math.PI) / 180);
  const hizMax = Math.max(...ms.map(m => m["position.speed"] ?? 0));
  console.log(
    `  ${d.plaka.padEnd(11)} 0V'li konumlu mesaj ${ms.length} · konum kutusu ${dLat.toFixed(0)}m × ${dLng.toFixed(0)}m` +
    ` · en yüksek hız ${hizMax} km/s · ort uydu ${(ms.reduce((a, m) => a + (m["position.satellites"] ?? 0), 0) / ms.length).toFixed(0)}`
  );
  console.log(`    ⇒ ${Math.max(dLat, dLng) < 150 ? "TEK NOKTADA — GPS titremesi, araç gitmedi" : "GERÇEKTEN YER DEĞİŞTİRDİ"}`);
}

console.log(`\n╚══ ÜÇÜNCÜ TUR BİTTİ ═══\n`);
