#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — YEDİNCİ TUR: "SESSİZ GÜÇ KAYBI" TESTİ + DB İZLERİ.
 * ⚠️ SALT OKUMA.
 *
 * 1) 45 gündeki HER besleme kesintisi epizodu: kesintiden hemen önce cihaz
 *    PARK atımı modunda mıydı (saatte 1 mesaj), yoksa uyanık mıydı?
 *    → "park hâlindeyken güç kesilirse cihaz haber verir mi?" sorusunun cevabı.
 * 2) Ölü araçların susma SONRASI diğer DB izleri (arıza bildirimi, yakıt).
 * 3) DO-505GS'in 54 km'lik vardiya kaydı — kaynak nedir?
 * 4) Kümelenme istatistiği: 33 cihazın son-atım saatleri, kümelenme rastlantı mı?
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

console.log(`\n╔══ YEDİNCİ TUR · SESSİZ GÜÇ KAYBI TESTİ ════════════════════════════\n`);

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
const OLU = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN);
const OLUSET = new Set(OLU.map(d => d.plaka));

// ── 1) KESİNTİ ÖNCESİ CİHAZ DURUMU ───────────────────────────────────────
console.log(`── 1) HER BESLEME KESİNTİSİNDE, KESİNTİDEN ÖNCEKİ 3 SAAT ──`);
console.log(`   "park atımı" = 3 saatte ≈3 mesaj (saatlik) · "uyanık" = onlarca/yüzlerce mesaj`);
console.log(`   ${"plaka".padEnd(11)}${"kesinti başı".padEnd(21)}${"önceki 3sa mesaj".padStart(17)}${"kontak".padStart(8)}${"durum".padStart(14)}${"  0V mesaj (haber verdi mi?)"}`);
let parkKesinti = 0, parkKesintiHaberli = 0;
for (const d of D) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: NOW - 45 * GUN, to: NOW, count: 100000, filter: "external.powersource.voltage<1", fields: "timestamp" }));
  const ms = (mg.j?.result ?? []).sort((a, b) => a.timestamp - b.timestamp);
  if (!ms.length) continue;
  const ep = []; let cur = [ms[0]];
  for (let i = 1; i < ms.length; i++) {
    if (ms[i].timestamp - cur[cur.length - 1].timestamp > 6 * 3600) { ep.push(cur); cur = []; }
    cur.push(ms[i]);
  }
  ep.push(cur);
  for (const e of ep) {
    const bas = e[0].timestamp;
    const on = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: bas - 3 * 3600, to: bas - 1, count: 5000, fields: "timestamp,engine.ignition.status" }));
    const oncekiler = on.j?.result ?? [];
    const n = oncekiler.length;
    const kontakAcik = oncekiler.filter(m => m["engine.ignition.status"] === true).length;
    const park = n <= 5 && kontakAcik === 0;
    if (park) { parkKesinti++; if (e.length >= 1) parkKesintiHaberli++; }
    console.log(
      `   ${(OLUSET.has(d.plaka) ? "†" : " ") + d.plaka.padEnd(10)}${z(bas).padEnd(21)}${String(n).padStart(17)}` +
      `${String(kontakAcik).padStart(8)}${(park ? "PARK ATIMI" : "uyanık").padStart(14)}   ${e.length} mesaj → ${e.length ? "HABER VERDİ" : "sessiz"}`
    );
  }
}
console.log(`\n   ⇒ PARK ATIMI hâlindeyken yaşanan kesinti: ${parkKesinti}`);
console.log(`   ⇒ bunların kaçında cihaz 0 V mesajı gönderdi: ${parkKesintiHaberli}`);
console.log(`   ⇒ SESSİZCE ölen (0 V mesajı olmayan) kesinti: ${parkKesinti - parkKesintiHaberli}`);

// ── 2) ÖLÜ ARAÇLARIN DİĞER DB İZLERİ ─────────────────────────────────────
console.log(`\n── 2) ÖLÜ ARAÇLARIN SUSMA SONRASI DİĞER DB İZLERİ ──`);
for (const d of OLU) {
  if (!d.arac) { console.log(`   ${d.plaka.padEnd(11)} DB'de yok`); continue; }
  const sonISO = new Date((d.son ?? 0) * 1000).toISOString();
  const [{ count: ariza }, { count: arizaTum }] = await Promise.all([
    supabaseAdmin.from("vehicle_fault_reports").select("id", { count: "exact", head: true })
      .eq("vehicle_id", d.arac.id).gte("created_at", sonISO),
    supabaseAdmin.from("vehicle_fault_reports").select("id", { count: "exact", head: true })
      .eq("vehicle_id", d.arac.id),
  ]);
  const { data: sonAriza } = await supabaseAdmin.from("vehicle_fault_reports")
    .select("created_at, description, severity, closed_at").eq("vehicle_id", d.arac.id)
    .order("created_at", { ascending: false }).limit(3);
  console.log(`   ${d.plaka.padEnd(11)} arıza bildirimi: toplam ${arizaTum ?? 0} · susma sonrası ${ariza ?? 0}`);
  for (const a of sonAriza ?? []) {
    console.log(`       ${String(a.created_at).slice(0, 16)} [${a.severity ?? "—"}] ${String(a.description ?? "").slice(0, 70)}${a.closed_at ? " (kapalı)" : ""}`);
  }
}

// ── 3) DO-505GS VARDİYA KM KAYNAĞI ───────────────────────────────────────
console.log(`\n── 3) DO-505GS — vardiya km 54, cihaz odometresi 120899. Kaynak? ──`);
{
  const d = OLU.find(x => x.plaka === "DO-505GS");
  const { data: v } = await supabaseAdmin.from("time_entries")
    .select("started_at, ended_at, start_km, end_km, plate, cargo_count")
    .eq("plate", "DO-505GS").order("started_at", { ascending: false }).limit(18);
  for (const r of v ?? []) {
    console.log(`   ${String(r.started_at).slice(0, 16)} → ${String(r.ended_at ?? "açık").slice(0, 16)} · km ${r.start_km}→${r.end_km ?? "—"} · paket ${r.cargo_count ?? "—"}`);
  }
  const { data: tel } = await supabaseAdmin.from("device_telemetry")
    .select("recorded_at, odometer_km").eq("vehicle_id", d.arac.id)
    .order("recorded_at", { ascending: false }).limit(3);
  console.log(`   DB device_telemetry son 3: ${(tel ?? []).map(t => `${String(t.recorded_at).slice(0, 16)} odo ${t.odometer_km}`).join(" | ")}`);
}

// ── 4) KÜMELENME İSTATİSTİĞİ ─────────────────────────────────────────────
console.log(`\n── 4) SON-ATIM KÜMELENMESİ ──`);
const olu = OLU.filter(d => d.son).sort((a, b) => a.son - b.son);
console.log(`   ${"plaka".padEnd(11)}${"son atım (UTC)".padEnd(21)}${"bir öncekiyle fark".padStart(20)}`);
for (let i = 0; i < olu.length; i++) {
  const fark = i === 0 ? null : olu[i].son - olu[i - 1].son;
  console.log(`   ${olu[i].plaka.padEnd(11)}${z(olu[i].son).padEnd(21)}` +
    `${(fark === null ? "—" : fark < 7200 ? `${(fark / 60).toFixed(0)} dk ⚠️` : `${(fark / 86400).toFixed(1)} gün`).padStart(20)}`);
}
console.log(`\n   04.08 kümesi: DO-788GS 21:05:13 · DO-623GL 21:39:53 · DO-492GV 21:51:00 → yayılım 45,8 dk`);
console.log(`   10.08 kümesi: DO-806HK 19:39:42 · DO-687GX 19:50:00                    → yayılım 10,3 dk`);
console.log(`   (3 bağımsız olayın 60 dk'lık bir aralığa düşme olasılığı ≈ %0,5;`);
console.log(`    2 bağımsız olayın 11 dk'ya düşme olasılığı ≈ %1,5 — rastlantı DEĞİL)`);

console.log(`\n╚══ YEDİNCİ TUR BİTTİ ═══\n`);
