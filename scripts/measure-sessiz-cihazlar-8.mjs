#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — SEKİZİNCİ TUR: ÇÜRÜTME TURUNUN AÇTIĞI DELİKLERİ KAPAT.
 * ⚠️ SALT OKUMA.
 *
 * Çürütücülerin haklı çıktığı noktalar ve buradaki cevapları:
 *  H1  "26/26 haber verdi" DÖNGÜSELDİ (kesinti zaten 0 V MESAJI ile tanımlanmıştı).
 *      → Döngüsel olmayan test: mesaj ekseninde ≥4 sa BOŞLUKLARI bul, her birinin
 *        ÖNCESİNDEKİ son mesajın voltajına bak. Boşluk tanımı voltajdan bağımsız.
 *  H2  "0 V haber veren 2 cihaz sleep.mode 0, sessiz ölen 6'sı sleep.mode 3" —
 *      kip farkı sonucu açıklıyor olabilir. → Kesinti ANINDAN ÖNCEKİ kipi ölç.
 *  H3  Kümelenme olasılığı YANLIŞ hesaplanmıştı (son-atım yayılımı ≠ olay yayılımı,
 *      aynı-gün testi doğum-günü etkisini yok sayıyor). → Monte Carlo ile yeniden.
 *  H4  Vardiya kaydı "araç kullanıldı" kanıtı DEĞİL. → Cihaz eksenli test: bir günde
 *      kaç şoför çalıştı ↔ kaç araç GERÇEKTEN sürüldü (kontak açık telemetri).
 *  H5  Kanalda 33 cihaza karşı 35 ident + 50 tanımlanamayan paket kapatılmamıştı.
 *  H6  jamming 6 ölünün 5'inde null — "kapalı" değil "hiç ölçülmemiş".
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
const saatDk = (t) => new Date(t * 1000).toISOString().slice(11, 16);

console.log(`\n╔══ SEKİZİNCİ TUR · ÇÜRÜTMEYE CEVAP ═════════════════════════════════\n`);

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
  D.push({ id: c.id, ident, arac, plaka: arac?.plate ?? c.name, son: t.j?.result?.[0]?.telemetry?.timestamp?.value ?? null });
}
D.sort((a, b) => a.plaka.localeCompare(b.plaka));
const OLU = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN);
const OLUSET = new Set(OLU.map(d => d.plaka));

// ══ H1 — DÖNGÜSEL OLMAYAN BOŞLUK TESTİ ══════════════════════════════════
console.log(`── H1) MESAJ EKSENİNDE ≥4 SA BOŞLUKLAR · 45 gün · boşluğun ÖNCESİNDEKİ voltaj ──`);
console.log(`   (boşluk tanımı voltajdan BAĞIMSIZ — döngüsellik yok)`);
console.log(`   ${"plaka".padEnd(11)}${"boşluk başı (UTC)".padEnd(21)}${"süre".padStart(9)}${"önceki msj besleme".padStart(20)}${"kip".padStart(6)}${"kontak".padStart(8)}   sonuç`);
const bosluklar = [];
for (const d of D) {
  const from = NOW - 45 * GUN;
  const mg = await G(`/gw/devices/${d.id}/messages?data=` + q({ from, to: NOW, count: 200000, fields: "timestamp" }));
  const ts = (mg.j?.result ?? []).map(m => m.timestamp).sort((a, b) => a - b);
  if (ts.length < 2) continue;
  const seri = [...ts, NOW];
  for (let i = 1; i < seri.length; i++) {
    const g = seri[i] - seri[i - 1];
    if (g <= 4 * 3600) continue;
    // boşluğun HEMEN ÖNCESİNDEKİ mesajın tam hâli
    const on = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: seri[i - 1] - 2, to: seri[i - 1] + 2, count: 3,
          fields: "timestamp,external.powersource.voltage,battery.voltage,sleep.mode.enum,engine.ignition.status" }));
    const m = (on.j?.result ?? []).find(x => x.timestamp === seri[i - 1]) ?? (on.j?.result ?? [])[0] ?? {};
    bosluklar.push({ d, bas: seri[i - 1], sure: g, m, acik: i === seri.length - 1 });
  }
}
bosluklar.sort((a, b) => a.bas - b.bas);
let sifirOncesi = 0, sagOncesi = 0;
for (const b of bosluklar) {
  const v = b.m["external.powersource.voltage"];
  const sifir = typeof v === "number" && v < 1;
  if (sifir) sifirOncesi++; else if (typeof v === "number") sagOncesi++;
  console.log(
    `   ${(OLUSET.has(b.d.plaka) ? "†" : " ") + b.d.plaka.padEnd(10)}${z(b.bas).padEnd(21)}${((b.sure / 3600).toFixed(1) + "sa").padStart(9)}` +
    `${String(v ?? "—").padStart(15)} V${String(b.m["sleep.mode.enum"] ?? "—").padStart(6)}` +
    `${(b.m["engine.ignition.status"] === undefined ? "—" : b.m["engine.ignition.status"] ? "AÇIK" : "kapalı").padStart(8)}` +
    `   ${sifir ? "0 V ÖNCEDEN HABER VERDİ" : "besleme SAĞLAMDI"}${b.acik ? " · HÂLÂ SESSİZ" : " · döndü"}`
  );
}
console.log(`\n   ⇒ toplam ≥4 sa boşluk: ${bosluklar.length}`);
console.log(`   ⇒ öncesinde besleme 0 V olan : ${sifirOncesi}`);
console.log(`   ⇒ öncesinde besleme sağlam   : ${sagOncesi}`);
console.log(`   Bu test kesintiyi 0 V mesajıyla TANIMLAMIYOR; boşluğu tanımlayıp voltaja bakıyor.`);

// ══ H2 — KESİNTİ ÖNCESİ UYKU KİPİ ═══════════════════════════════════════
console.log(`\n── H2) 0 V EPİZODLARINDA, KESİNTİDEN ÖNCEKİ SON NORMAL MESAJIN UYKU KİPİ ──`);
console.log(`   Soru: "0 V haber verenler zaten uyanıktı (kip 0), sessiz ölenler derin uykudaydı (kip 3)" doğru mu?`);
console.log(`   ${"plaka".padEnd(11)}${"kesinti başı".padEnd(21)}${"önceki msj".padEnd(21)}${"kip".padStart(5)}${"gnss uyku".padStart(11)}${"kontak".padStart(8)}${"  0V msj"}`);
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
      q({ from: bas - 4 * 3600, to: bas - 1, count: 2000,
          fields: "timestamp,external.powersource.voltage,sleep.mode.enum,gnss.sleep.mode.status,engine.ignition.status" }));
    const arr = (on.j?.result ?? []).filter(m => (m["external.powersource.voltage"] ?? 0) >= 1);
    const m = arr[arr.length - 1];
    if (!m) { console.log(`   ${d.plaka.padEnd(11)}${z(bas).padEnd(21)}(öncesinde sağlam besleme mesajı yok)`); continue; }
    console.log(
      `   ${(OLUSET.has(d.plaka) ? "†" : " ") + d.plaka.padEnd(10)}${z(bas).padEnd(21)}${z(m.timestamp).padEnd(21)}` +
      `${String(m["sleep.mode.enum"] ?? "—").padStart(5)}${String(m["gnss.sleep.mode.status"] ?? "—").padStart(11)}` +
      `${(m["engine.ignition.status"] === undefined ? "—" : m["engine.ignition.status"] ? "AÇIK" : "kapalı").padStart(8)}${String(e.length).padStart(9)}`
    );
  }
}

// ══ H3 — KÜMELENME, DOĞRU HESAP ═════════════════════════════════════════
console.log(`\n── H3) KÜMELENME — DÜZELTİLMİŞ İSTATİSTİK ──`);
{
  const sessiz = OLU.filter(d => {
    // besleme SAĞLAM iken susanlar (elektrik kesintisiyle susanlar ayrı popülasyon)
    return !["DO-746GU", "SENDIGO-4"].includes(d.plaka);
  }).map(d => d.son).sort((a, b) => a - b);
  const sn = sessiz.map(t => { const dd = new Date(t * 1000); return dd.getUTCHours() * 3600 + dd.getUTCMinutes() * 60 + dd.getUTCSeconds(); });
  console.log(`   BESLEMESİ SAĞLAMKEN susan ${sessiz.length} cihazın son atım SAATİ (UTC):`);
  for (let i = 0; i < sessiz.length; i++) {
    console.log(`     ${z(sessiz[i])}   günün saati ${saatDk(sessiz[i])} UTC  = ${String((new Date((sessiz[i] + 7200) * 1000)).toISOString().slice(11, 16))} yerel`);
  }
  const min = Math.min(...sn), max = Math.max(...sn);
  console.log(`   → günün saati bandı: ${new Date(min * 1000).toISOString().slice(11, 19)} – ${new Date(max * 1000).toISOString().slice(11, 19)} UTC · genişlik ${((max - min) / 3600).toFixed(2)} sa`);
  // Monte Carlo: n olay günün rastgele saatinde olsa, hepsinin bu kadar dar bir banda düşme olasılığı
  const n = sn.length, w = max - min, MC = 500000;
  let sayac = 0;
  // deterministik pseudo-rastgele (Math.random yerine LCG — tekrar üretilebilir)
  let s = 20260814;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let k = 0; k < MC; k++) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const x = rnd() * 86400; if (x < mn) mn = x; if (x > mx) mx = x; }
    if (mx - mn <= w) sayac++;
  }
  console.log(`   Monte Carlo (${(MC / 1000).toFixed(0)}k tur): ${n} olay günün rastgele saatinde olsaydı,`);
  console.log(`   hepsinin ${(w / 3600).toFixed(2)} saatlik bir banda düşme olasılığı = %${((sayac / MC) * 100).toFixed(4)}`);
  console.log(`   ⇒ ${sayac / MC < 0.01 ? "GÜNÜN SAATİ kümelenmesi rastlantıyla açıklanamaz." : "günün saati kümelenmesi anlamlı değil."}`);
  // aynı-gün testi (doğum günü etkisi dahil) — çürütücünün haklı olduğu kısım
  const span = Math.ceil((Math.max(...sessiz) - Math.min(...sessiz)) / GUN) + 1;
  let ayniGun3 = 0, ayniGun2 = 0;
  for (let k = 0; k < MC; k++) {
    const c = new Map();
    for (let i = 0; i < n; i++) { const g = Math.floor(rnd() * span); c.set(g, (c.get(g) ?? 0) + 1); }
    const mx = Math.max(...c.values());
    if (mx >= 3) ayniGun3++;
    if (mx >= 2) ayniGun2++;
  }
  console.log(`\n   AYNI GÜN testi (çürütücünün haklı çıktığı yer): ${n} olay ${span} güne yayılsa,`);
  console.log(`   bir günde ≥2 olay olasılığı %${((ayniGun2 / MC) * 100).toFixed(1)} · ≥3 olay olasılığı %${((ayniGun3 / MC) * 100).toFixed(1)}`);
  console.log(`   ⇒ "aynı gün" tek başına ZAYIF kanıt. Güçlü olan GÜNÜN SAATİ kümelenmesi.`);
}

// ══ H4 — ŞOFÖR SAYISI ↔ GERÇEKTEN SÜRÜLEN ARAÇ SAYISI ═══════════════════
console.log(`\n── H4) CİHAZ EKSENLİ KULLANIM TESTİ: kaç şoför çalıştı ↔ kaç araç sürüldü ──`);
console.log(`   (vardiya kaydına güvenmeden: kontak AÇIK telemetrisi olan farklı araç sayısı)`);
console.log(`   ${"gün".padEnd(12)}${"başlayan vardiya".padStart(18)}${"farklı şoför".padStart(14)}${"SÜRÜLEN araç".padStart(15)}${"  fark"}`);
for (const gun of ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]) {
  const g0 = Math.floor(new Date(gun + "T00:00:00Z").getTime() / 1000);
  const g1 = g0 + GUN;
  const { data: v } = await supabaseAdmin.from("time_entries")
    .select("worker_id, plate").gte("started_at", new Date(g0 * 1000).toISOString())
    .lt("started_at", new Date(g1 * 1000).toISOString());
  const sofor = new Set((v ?? []).map(x => x.worker_id));
  let surulen = 0;
  const surulenler = [];
  for (const d of D) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: g0, to: g1, count: 5, filter: "engine.ignition.status==true", fields: "timestamp" }));
    if ((mg.j?.result ?? []).length > 0) { surulen++; surulenler.push(d.plaka); }
  }
  console.log(
    `   ${gun.padEnd(12)}${String((v ?? []).length).padStart(18)}${String(sofor.size).padStart(14)}${String(surulen).padStart(15)}` +
    `  ${sofor.size - surulen > 0 ? `+${sofor.size - surulen} şoför, izlenen araç olmadan çalışmış` : "—"}`
  );
  const eksik = (v ?? []).map(x => x.plate).filter(p => p && !surulenler.includes(p));
  console.log(`       vardiyası olup o gün SÜRÜLMEYEN plakalar: ${[...new Set(eksik)].sort().join(", ") || "yok"}`);
}

// ══ H5 — FAZLA IDENT + TANIMLANAMAYAN PAKET ═════════════════════════════
console.log(`\n── H5) KANALDA 33 CİHAZ AMA 35 IDENT — fazlası kim? ──`);
{
  const idn = await G(`/gw/channels/1399419/idents/all`);
  const idents = idn.j?.result ?? [];
  const cihazIdent = new Set(D.map(d => d.ident));
  const fazla = idents.filter(x => !cihazIdent.has(String(x.ident ?? x.id)));
  console.log(`   kanal ident ${idents.length} · cihaz ${D.length} · CİHAZA BAĞLI OLMAYAN ident ${fazla.length}`);
  for (const f of fazla) {
    console.log(`     ident …${String(f.ident ?? f.id).slice(-4)} · device_id ${f.device_id ?? "YOK"} · son etkin ${z(f.last_active)} · kaynak ${f.source ?? "—"}`);
  }
  const up = await G(`/gw/channels/1399419/idents/unidentified/packets?data=` + q({ from: NOW - 30 * GUN, to: NOW, count: 8, reverse: true }));
  const rows = up.j?.result ?? [];
  console.log(`\n   TANIMLANAMAYAN paketler (en yeni 8) — tüm alanlar:`);
  for (const r of rows) console.log(`     ${JSON.stringify(r).slice(0, 220)}`);
}

// ══ H6 — JAMMING ALANININ VARLIĞI ═══════════════════════════════════════
console.log(`\n── H6) JAMMING — "kapalı" mı yoksa "hiç bildirilmiyor" mu? ──`);
{
  let bildiren = 0, hic = 0;
  for (const d of D) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` +
      q({ from: NOW - 45 * GUN, to: NOW, count: 5, filter: "gsm.jamming.alarm.status", fields: "timestamp,gsm.jamming.alarm.status" }));
    const n = (mg.j?.result ?? []).length;
    if (n > 0) bildiren++; else hic++;
  }
  console.log(`   son 45 günde gsm.jamming.alarm.status alanını EN AZ BİR KEZ gönderen cihaz: ${bildiren}/${D.length}`);
  console.log(`   hiç göndermeyen: ${hic}`);
  console.log(`   ⇒ ${bildiren < D.length / 2 ? "Alan filoda yaygın bildirilmiyor — jamming bu alandan ELENEMEZ." : "Alan yaygın bildiriliyor, eleme geçerli."}`);
}

console.log(`\n╚══ SEKİZİNCİ TUR BİTTİ ═══\n`);
