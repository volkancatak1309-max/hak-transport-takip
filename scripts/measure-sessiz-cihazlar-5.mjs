#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — BEŞİNCİ TUR: GECE ÇİZELGESİ + VARDİYA KALİBRASYONU.
 * ⚠️ SALT OKUMA.
 *
 * A) 04.08 ve 10.08 geceleri TÜM filonun atım çizelgesi — eşzamanlı kesinti mi?
 *    (kontrol gecesi 07.08 ile kıyas)
 * B) KALİBRASYON: DO-945HL 04.08→13.08 arasında SUSTU ama araç sürülmemişti
 *    (dönüş kontak açılışıyla). O aralıkta DB'de vardiya var mı? → vardiya
 *    kaydının "araç kullanıldı" kanıtı olarak GÜCÜ ölçülür.
 * C) Ölü araçların atanmış şoförü ve o şoförün son vardiyaları.
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
const U = (s) => Math.floor(new Date(s).getTime() / 1000);

console.log(`\n╔══ BEŞİNCİ TUR · GECE ÇİZELGESİ + VARDİYA KALİBRASYONU ═════════════\n`);

const dv = await G("/gw/devices/all");
const cihazlar = dv.j?.result ?? [];
const { data: araclar } = await supabaseAdmin
  .from("vehicles").select("id, plate, imei, flespi_device_id, assigned_worker_id, status");
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

// ── A) GECE ÇİZELGESİ ────────────────────────────────────────────────────
const geceler = [
  ["04.08 GECESİ (3 cihaz burada öldü)", "2026-08-04T17:00:00Z", "2026-08-05T09:00:00Z"],
  ["10.08 GECESİ (2 cihaz burada öldü)", "2026-08-10T17:00:00Z", "2026-08-11T09:00:00Z"],
  ["07.08 KONTROL GECESİ (kimse ölmedi)", "2026-08-07T17:00:00Z", "2026-08-08T09:00:00Z"],
];
for (const [ad, a, b] of geceler) {
  const from = U(a), to = U(b);
  console.log(`\n── A) ${ad}   ${a} → ${b} ──`);
  console.log(`   Her sütun bir saat (UTC 17→08). "•"=mesaj var  "·"=mesaj YOK  "▓"=çok mesaj (sürüş)`);
  const saatler = [];
  for (let t = from; t < to; t += 3600) saatler.push(t);
  console.log(`   ${"plaka".padEnd(11)}${saatler.map(t => String(new Date(t * 1000).getUTCHours()).padStart(2, "0").slice(-1)).join("")}   boşluk`);
  const kayipSaat = new Map();
  for (const d of D) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` + q({ from, to, count: 60000, fields: "timestamp" }));
    const ts = (mg.j?.result ?? []).map(m => m.timestamp);
    let satir = "", bos = 0;
    for (const t of saatler) {
      const n = ts.filter(x => x >= t && x < t + 3600).length;
      satir += n === 0 ? "·" : n > 5 ? "▓" : "•";
      if (n === 0) { bos++; kayipSaat.set(t, (kayipSaat.get(t) ?? 0) + 1); }
    }
    console.log(`   ${(OLU.has(d.plaka) ? "†" : " ") + d.plaka.padEnd(10)}${satir}   ${bos}`);
  }
  console.log(`\n   SAAT BAŞINA "hiç mesaj göndermeyen cihaz" sayısı (${D.length} cihaz üzerinden):`);
  console.log(`   ${saatler.map(t => `${String(new Date(t * 1000).getUTCHours()).padStart(2, "0")}:${String(kayipSaat.get(t) ?? 0).padStart(2)}`).join("  ")}`);
}

// ── B) VARDİYA KALİBRASYONU ──────────────────────────────────────────────
console.log(`\n\n── B) KALİBRASYON — cihazın SUSTUĞU ama aracın SÜRÜLMEDİĞİ kanıtlı aralıkta vardiya var mı? ──`);
const kalib = [
  ["DO-945HL", "2026-08-04T21:50:00Z", "2026-08-13T08:25:00Z", "8,4 gün sustu; dönüş kontak AÇILIŞIYLA → arada araç ÇALIŞTIRILMADI"],
  ["DO-775GS", "2026-08-10T14:41:00Z", "2026-08-13T08:00:00Z", "besleme 0 V; 13.08'de besleme geri geldi"],
  ["DO-945HL#2", "2026-07-17T15:55:00Z", "2026-07-22T10:12:00Z", "4,8 gün sustu"],
];
for (const [ad, a, b, not] of kalib) {
  const plaka = ad.split("#")[0];
  const { data: v } = await supabaseAdmin
    .from("time_entries").select("started_at, ended_at, cargo_count, start_km, end_km")
    .eq("plate", plaka).gte("started_at", a).lte("started_at", b).order("started_at");
  const rows = v ?? [];
  console.log(`\n  ${ad}  ${a.slice(0, 16)} → ${b.slice(0, 16)}`);
  console.log(`    (${not})`);
  console.log(`    bu aralıkta DB VARDİYASI: ${rows.length}` + (rows.length ? ` · toplam paket ${rows.reduce((s, r) => s + (r.cargo_count ?? 0), 0)}` : ""));
  for (const r of rows.slice(0, 12)) {
    console.log(`      ${String(r.started_at).slice(0, 16)} → ${String(r.ended_at ?? "açık").slice(0, 16)} · paket ${r.cargo_count ?? "—"} · km ${r.start_km}→${r.end_km ?? "—"}`);
  }
  console.log(`    ⇒ ${rows.length ? "VARDİYA VAR ama cihaz kanıtı ARAÇ SÜRÜLMEDİĞİNİ söylüyor → vardiya kaydı 'araç kullanıldı' kanıtı DEĞİL" : "vardiya yok — tutarlı"}`);
}

// ── C) ÖLÜ ARAÇLARIN ŞOFÖRÜ ──────────────────────────────────────────────
console.log(`\n── C) ÖLÜ ARAÇLARIN ATANMIŞ ŞOFÖRÜ VE VARDİYA PLAKASI ──`);
for (const d of D.filter(x => OLU.has(x.plaka) && x.arac)) {
  const { data: w } = d.arac.assigned_worker_id
    ? await supabaseAdmin.from("workers").select("id, plate, is_active").eq("id", d.arac.assigned_worker_id).limit(1)
    : { data: null };
  const worker = w?.[0] ?? null;
  const { data: son } = worker
    ? await supabaseAdmin.from("time_entries").select("started_at, plate, cargo_count")
        .eq("worker_id", worker.id).order("started_at", { ascending: false }).limit(4)
    : { data: null };
  console.log(
    `  ${d.plaka.padEnd(11)} atanmış şoför ${worker ? "VAR" : "YOK"}` +
    (worker ? ` · şoför aktif ${worker.is_active} · workers.plate=${worker.plate ?? "—"} (araç plakasıyla ${worker.plate === d.plaka ? "UYUŞUYOR" : "UYUŞMUYOR"})` : "")
  );
  for (const s of son ?? []) {
    console.log(`      son vardiya ${String(s.started_at).slice(0, 16)} · plaka ${s.plate ?? "—"} · paket ${s.cargo_count ?? "—"}`);
  }
}

// ── D) ÖLÜ ARAÇLARIN AYNI ŞOFÖRÜNÜN BAŞKA ARACI VAR MI? ──────────────────
console.log(`\n── D) ÖLÜ PLAKA ile aynı plakayı taşıyan BAŞKA araç / şoför var mı? ──`);
for (const d of D.filter(x => OLU.has(x.plaka) && x.arac)) {
  const { data: ws } = await supabaseAdmin.from("workers").select("id, plate, is_active").eq("plate", d.plaka);
  console.log(`  ${d.plaka.padEnd(11)} bu plakayı taşıyan şoför: ${(ws ?? []).length} (aktif ${(ws ?? []).filter(w => w.is_active).length})`);
}

console.log(`\n╚══ BEŞİNCİ TUR BİTTİ ═══\n`);
