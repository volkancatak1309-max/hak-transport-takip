#!/usr/bin/env node
/**
 * SESSİZ CİHAZ — İKİNCİ TUR: ORTAK SEBEP TESTİ + GEÇMİŞ + DB ÇAPRAZ KONTROLÜ.
 *
 * ⚠️ SALT OKUMA. Yalnız GET (flespi) + select (Supabase). Hiçbir yazma yok.
 *
 * Sorular:
 *   A) Aynı gün susanlar TEK BİR ANDA mı sustu? (beklenen-sonraki-atım penceresi)
 *   B) O anda kanaldaki DİĞER cihazlar da etkilendi mi? (toplu sebep testi)
 *   C) Cihazın geçmişinde daha önce böyle uzun sessizlik oldu mu ve döndü mü?
 *   D) Araç susmadan SONRA kullanıldı mı? (vardiya + odometre + DB telemetri)
 *   E) Uyku kipi / operatör / codec farkı var mı? (ölü ↔ canlı karşılaştırma)
 *   F) SENDIGO-4 ömür boyu ne kadar veri gönderdi?
 */
import { supabaseAdmin } from "@/lib/supabase";

const T = process.env.FLESPI_TOKEN;
if (!T) { console.error("✗ FLESPI_TOKEN yok"); process.exit(1); }
const H = { Authorization: `FlespiToken ${T}` };
const NOW = Math.floor(Date.now() / 1000);
const GUN = 86400;

async function G(yol) {
  const r = await fetch("https://flespi.io" + yol, { headers: H, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, s: r.status, hata: j?.errors ?? null, j };
}
const q = (o) => encodeURIComponent(JSON.stringify(o));
const z = (t) => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—");
/** Avusturya yerel saati (CEST = UTC+2, Ağustos). */
const zl = (t) => (t ? new Date((t + 7200) * 1000).toISOString().replace("T", " ").slice(0, 16) : "—");

console.log(`\n╔══ İKİNCİ TUR · ORTAK SEBEP + GEÇMİŞ + DB ═══════════════════════════`);
console.log(`║ an ${new Date().toISOString()} · ⚠️ salt okuma\n`);

// ── ENVANTER ──────────────────────────────────────────────────────────────
const dv = await G("/gw/devices/all");
const cihazlar = dv.j?.result ?? [];
const { data: araclar } = await supabaseAdmin
  .from("vehicles").select("id, plate, imei, flespi_device_id, status, is_test, fleet, assigned_worker_id");
const byDev = new Map((araclar ?? []).filter(v => v.flespi_device_id).map(v => [String(v.flespi_device_id), v]));
const byImei = new Map((araclar ?? []).filter(v => v.imei).map(v => [String(v.imei), v]));

const D = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const t = await G(`/gw/devices/${c.id}/telemetry/all`);
  const tel = t.j?.result?.[0]?.telemetry ?? {};
  const v = (k) => tel[k]?.value ?? null;
  D.push({
    id: c.id, ad: c.name, ident,
    arac: byDev.get(String(c.id)) ?? byImei.get(ident) ?? null,
    plaka: (byDev.get(String(c.id)) ?? byImei.get(ident))?.plate ?? c.name,
    son: v("timestamp"), kanal: v("channel.id"),
    besleme: v("external.powersource.voltage"), aku: v("battery.voltage"),
    akuAkim: v("battery.current"),
    sleep: v("sleep.mode.enum"), gnssSleep: v("gnss.sleep.mode.status"),
    mcc: v("gsm.mcc"), mnc: v("gsm.mnc"), op: v("gsm.operator.code"),
    codec: v("codec.id"), proto: v("protocol.id"), tip: v("device.type.id"),
    km: v("can.vehicle.mileage"), lat: v("position.latitude"), lng: v("position.longitude"),
  });
}
D.sort((a, b) => (a.son ?? 0) - (b.son ?? 0));
const OLU = D.filter(d => (NOW - (d.son ?? 0)) > 2 * GUN);
const CANLI = D.filter(d => (NOW - (d.son ?? 0)) <= 2 * GUN);

// ── E) ÖLÜ ↔ CANLI KONFİGÜRASYON KARŞILAŞTIRMASI ─────────────────────────
console.log(`── E) ÖLÜ (${OLU.length}) ↔ CANLI (${CANLI.length}) KARŞILAŞTIRMASI ──`);
const kume = (arr, f) => {
  const m = new Map();
  for (const x of arr) { const k = String(f(x)); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" · ");
};
for (const [ad, f] of [
  ["sleep.mode.enum", d => d.sleep], ["gnss.sleep", d => d.gnssSleep],
  ["gsm mcc/mnc", d => `${d.mcc}/${d.mnc}`], ["gsm.operator.code", d => d.op],
  ["codec.id", d => d.codec], ["protocol.id", d => d.proto], ["device.type.id", d => d.tip],
  ["battery.current", d => d.akuAkim], ["filo", d => d.arac?.fleet ?? "—"],
]) {
  console.log(`  ${ad.padEnd(18)} ÖLÜ  : ${kume(OLU, f)}`);
  console.log(`  ${"".padEnd(18)} CANLI: ${kume(CANLI, f)}`);
}

// ── A) ORTAK AN PENCERESİ ────────────────────────────────────────────────
console.log(`\n── A) SUSMA ANI PENCERESİ (son atım → kaçırılan ilk atım) ──`);
console.log(`  ${"plaka".padEnd(11)}${"son atım (UTC)".padEnd(21)}${"yerel".padEnd(18)}${"atım aralığı".padStart(13)}${"  kaçırılan ilk atım (UTC)"}`);
const pencere = [];
for (const d of OLU) {
  // atım aralığını son 6 atımdan ölç
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: d.son - 8 * 3600, to: d.son + 60, reverse: false, count: 500, fields: "timestamp" }));
  const ts = (mg.j?.result ?? []).map(m => m.timestamp).sort((a, b) => a - b);
  const farklar = [];
  for (let i = 1; i < ts.length; i++) farklar.push(ts[i] - ts[i - 1]);
  farklar.sort((a, b) => a - b);
  const medyan = farklar.length ? farklar[Math.floor(farklar.length / 2)] : null;
  const enBuyuk = farklar.length ? farklar[farklar.length - 1] : null;
  const kacirilan = enBuyuk ? d.son + enBuyuk : null;
  pencere.push({ d, medyan, enBuyuk, kacirilan });
  console.log(
    `  ${d.plaka.padEnd(11)}${z(d.son).padEnd(21)}${zl(d.son).padEnd(18)}` +
    `${(enBuyuk ? (enBuyuk / 60).toFixed(0) + " dk" : "—").padStart(13)}  ${z(kacirilan)}`
  );
}
// grup bazlı kesişim
const gruplar = new Map();
for (const p of pencere) {
  const gun = z(p.d.son).slice(0, 10);
  if (!gruplar.has(gun)) gruplar.set(gun, []);
  gruplar.get(gun).push(p);
}
console.log(`\n  ⇒ AYNI GÜN SUSANLARIN KESİŞİM PENCERESİ`);
for (const [gun, grup] of [...gruplar.entries()].sort()) {
  if (grup.length < 2) { console.log(`    ${gun}: tek cihaz (${grup[0].d.plaka}) — kesişim yok`); continue; }
  const alt = Math.max(...grup.map(p => p.d.son));            // en geç BAŞARILI atım
  const ust = Math.min(...grup.map(p => p.kacirilan ?? Infinity)); // en erken KAÇIRILAN atım
  console.log(`    ${gun} · ${grup.length} cihaz (${grup.map(p => p.d.plaka).join(", ")})`);
  console.log(`      olay ANI şu aralıkta: ${z(alt)} → ${z(ust)}  (${((ust - alt) / 60).toFixed(0)} dk genişlik)`);
  console.log(`      yerel saat         : ${zl(alt)} → ${zl(ust)}`);
  console.log(`      kesişiyor mu       : ${ust > alt ? "EVET — tek bir ana uyuyor" : "HAYIR — tek an ile açıklanamaz"}`);
}

// ── B) TOPLU SEBEP TESTİ: O ANDA DİĞER CİHAZLAR ──────────────────────────
console.log(`\n── B) TOPLU SEBEP TESTİ — olay anında kanalın geri kalanı ──`);
for (const [gun, grup] of [...gruplar.entries()].sort()) {
  if (grup.length < 2) continue;
  const alt = Math.max(...grup.map(p => p.d.son));
  const ust = Math.min(...grup.map(p => p.kacirilan ?? Infinity));
  const from = Math.floor(alt - 3600), to = Math.ceil(ust + 3600);
  console.log(`\n  ▸ ${gun} penceresi ${z(from)} → ${z(to)}`);
  // kanal logları — TÜM identler
  const cl = await G(`/gw/channels/1399419/logs?data=` + q({ from, to, count: 5000, reverse: false }));
  const rows = cl.j?.result ?? [];
  const kod = new Map(), cc = new Map(), identler = new Set();
  for (const r of rows) {
    kod.set(r.event_code, (kod.get(r.event_code) ?? 0) + 1);
    if (r.event_code === 102) cc.set(r.close_code, (cc.get(r.close_code) ?? 0) + 1);
    if (r.ident) identler.add(String(r.ident));
  }
  console.log(`    kanal log kaydı ${rows.length} · farklı ident ${identler.size}`);
  console.log(`    event_code: ${[...kod.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}×${n}`).join(" · ")}`);
  console.log(`    close_code: ${[...cc.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}×${n}`).join(" · ") || "—"}`);
  const anormal = rows.filter(r => r.event_code === 102 && ![2, 12, 17, 3].includes(r.close_code));
  console.log(`    ANORMAL kapanış (cc 7/8/9/5/… = sunucu/kanal kaynaklı): ${anormal.length}`);
  for (const r of anormal.slice(0, 10)) {
    const dd = D.find(x => x.ident === String(r.ident));
    console.log(`      ${z(r.timestamp)} cc ${r.close_code} ${dd?.plaka ?? r.ident} ${r.error_text ?? ""}`);
  }
  // O pencerede mesaj gönderen cihaz sayısı (tüm filo)
  let gonderen = 0, hicYok = [];
  for (const d of D) {
    const mg = await G(`/gw/devices/${d.id}/messages?data=` + q({ from, to, count: 5, fields: "timestamp" }));
    const n = (mg.j?.result ?? []).length;
    if (n > 0) gonderen++; else hicYok.push(d.plaka);
  }
  console.log(`    pencerede EN AZ 1 mesaj gönderen cihaz: ${gonderen}/${D.length}`);
  console.log(`    pencerede HİÇ mesaj göndermeyen: ${hicYok.length} → ${hicYok.join(", ")}`);
}

// ── C) GEÇMİŞ SESSİZLİK BOŞLUKLARI (bağlantı logundan, 150 gün) ──────────
console.log(`\n── C) GEÇMİŞ — 150 günde 6 saatten uzun bağlantısız dönemler ──`);
for (const d of OLU) {
  const lg = await G(`/gw/devices/${d.id}/logs?data=` +
    q({ from: NOW - 150 * GUN, to: NOW, count: 20000, reverse: false, filter: "event_code==300" }));
  const t = (lg.j?.result ?? []).map(r => r.timestamp).sort((a, b) => a - b);
  if (!t.length) { console.log(`  ${d.plaka.padEnd(11)} bağlantı logu YOK (${lg.ok ? "boş" : lg.s})`); continue; }
  const bosluklar = [];
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 6 * 3600) bosluklar.push([t[i - 1], t[i]]);
  const ilk = t[0], sonBag = t[t.length - 1];
  console.log(
    `  ${d.plaka.padEnd(11)} bağlantı ${String(t.length).padStart(5)} · ilk ${z(ilk).slice(0, 10)} · SON BAĞLANTI ${z(sonBag)}` +
    ` · 6sa+ boşluk ${bosluklar.length}`
  );
  for (const [a, b] of bosluklar.slice(-6)) {
    console.log(`      ${z(a)} → ${z(b)}  (${((b - a) / 3600).toFixed(1)} sa)  [döndü]`);
  }
  console.log(`      ${z(sonBag)} → ŞİMDİ        (${((NOW - sonBag) / 3600).toFixed(1)} sa)  [DÖNMEDİ]`);
}

// ── D) DB ÇAPRAZ KONTROL — susmadan sonra araç kullanıldı mı? ────────────
console.log(`\n── D) DB ÇAPRAZ KONTROL ──`);
for (const d of OLU) {
  if (!d.arac) { console.log(`  ${d.plaka.padEnd(11)} DB'de araç kaydı YOK (bu tenant'ta değil)`); continue; }
  const sonISO = new Date((d.son ?? 0) * 1000).toISOString();
  const [{ data: tel }, { data: vard }, { count: telSonra }] = await Promise.all([
    supabaseAdmin.from("device_telemetry").select("recorded_at, odometer_km")
      .eq("vehicle_id", d.arac.id).order("recorded_at", { ascending: false }).limit(1),
    supabaseAdmin.from("time_entries").select("id, started_at, ended_at, start_km, end_km, worker_id")
      .eq("plate", d.arac.plate).gte("started_at", sonISO).order("started_at", { ascending: true }),
    supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true })
      .eq("vehicle_id", d.arac.id).gt("recorded_at", sonISO),
  ]);
  const v = vard ?? [];
  const kmler = v.map(x => x.end_km ?? x.start_km).filter(Boolean);
  console.log(
    `  ${d.plaka.padEnd(11)} durum ${String(d.arac.status).padEnd(8)} atanmış şoför ${d.arac.assigned_worker_id ? "VAR" : "yok"}` +
    ` · DB son telemetri ${String(tel?.[0]?.recorded_at ?? "—").slice(0, 19)}` +
    ` · susma SONRASI DB satırı ${telSonra ?? 0}`
  );
  console.log(
    `  ${"".padEnd(11)} susma sonrası VARDİYA ${v.length}` +
    (v.length ? ` · ilk ${String(v[0].started_at).slice(0, 16)} · son ${String(v[v.length - 1].started_at).slice(0, 16)}` : "") +
    (kmler.length ? ` · vardiya km ${Math.min(...kmler)}→${Math.max(...kmler)} (cihaz odometresi ${d.km ?? "—"})` : "")
  );
}

// ── F) SENDIGO-4 ÖMÜR BOYU ───────────────────────────────────────────────
console.log(`\n── F) SENDIGO-4 ÖMÜR BOYU ──`);
{
  const s4 = D.find(x => x.plaka === "SENDIGO-4" || x.ad === "SENDIGO-4");
  if (!s4) console.log("  cihaz bulunamadı");
  else {
    const lg = await G(`/gw/devices/${s4.id}/logs?data=` + q({ from: 0, to: NOW, count: 20000, reverse: false }));
    const loglar = lg.j?.result ?? [];
    const kod = new Map();
    for (const r of loglar) kod.set(r.event_code, (kod.get(r.event_code) ?? 0) + 1);
    console.log(`  cihaz kaydı ilk log : ${z(loglar[0]?.timestamp)}`);
    console.log(`  son log             : ${z(loglar[loglar.length - 1]?.timestamp)}`);
    console.log(`  log kod dağılımı    : ${[...kod.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}×${n}`).join(" · ")}`);
    const baglanti = loglar.filter(r => r.event_code === 300).map(r => r.timestamp);
    console.log(`  toplam bağlantı     : ${baglanti.length} · ilk ${z(baglanti[0])} · son ${z(baglanti[baglanti.length - 1])}`);
    // kanal logundan toplam trafik
    const cl = await G(`/gw/channels/1399419/logs?data=` +
      q({ from: 0, to: NOW, count: 20000, reverse: false, filter: `ident=="${s4.ident}"` }));
    const rows = cl.j?.result ?? [];
    const kapanis = rows.filter(r => r.event_code === 102);
    const recv = kapanis.reduce((a, r) => a + (r.recv ?? 0), 0);
    const send = kapanis.reduce((a, r) => a + (r.send ?? 0), 0);
    const msgs = kapanis.reduce((a, r) => a + (r.msgs ?? 0), 0);
    console.log(`  kanal oturumu       : ${kapanis.length} · toplam ALINAN ${(recv/1024).toFixed(1)} KiB · GÖNDERİLEN ${(send/1024).toFixed(1)} KiB · mesaj ${msgs}`);
    const ccS = new Map();
    for (const r of kapanis) ccS.set(r.close_code, (ccS.get(r.close_code) ?? 0) + 1);
    console.log(`  close_code dağılımı : ${[...ccS.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}×${n}`).join(" · ")}`);
    // günlük mesaj dağılımı
    const mg = await G(`/gw/devices/${s4.id}/messages?data=` + q({ from: 0, to: NOW, count: 60000, fields: "timestamp,external.powersource.voltage" }));
    const ms = mg.j?.result ?? [];
    const gunluk = new Map();
    for (const m of ms) { const g = z(m.timestamp).slice(0, 10); gunluk.set(g, (gunluk.get(g) ?? 0) + 1); }
    console.log(`  toplam mesaj        : ${ms.length}`);
    console.log(`  günlük dağılım      :`);
    for (const [g, n] of [...gunluk.entries()].sort()) console.log(`      ${g}  ${String(n).padStart(5)} mesaj`);
    const sifir = ms.filter(m => m["external.powersource.voltage"] === 0).length;
    console.log(`  besleme 0 V olan mesaj: ${sifir}/${ms.length}`);
    const ilkSifir = ms.find(m => m["external.powersource.voltage"] === 0);
    console.log(`  İLK 0 V anı         : ${z(ilkSifir?.timestamp)}`);
  }
}

// ── G) DO-746GU ve besleme kesintisi anı ─────────────────────────────────
console.log(`\n── G) BESLEMESİ 0 V'A DÜŞEN CİHAZLARDA KESİNTİ ANI ──`);
for (const d of OLU.filter(x => x.besleme === 0)) {
  const mg = await G(`/gw/devices/${d.id}/messages?data=` +
    q({ from: d.son - 6 * 3600, to: d.son + 60, reverse: false, count: 5000, fields: "timestamp,external.powersource.voltage,battery.voltage,position.speed,movement.status,position.latitude,position.longitude" }));
  const ms = mg.j?.result ?? [];
  const idx = ms.findIndex(m => m["external.powersource.voltage"] === 0);
  console.log(`\n  ${d.plaka} — pencerede ${ms.length} mesaj`);
  if (idx > 0) {
    const onceki = ms[idx - 1], sifir = ms[idx];
    console.log(`    son SAĞLAM besleme : ${z(onceki.timestamp)}  ${onceki["external.powersource.voltage"]} V`);
    console.log(`    İLK 0 V            : ${z(sifir.timestamp)}  (${((sifir.timestamp - onceki.timestamp)).toFixed(0)} sn sonra)`);
    console.log(`    yerel saat         : ${zl(sifir.timestamp)}`);
    const kesintiSure = (d.son - sifir.timestamp) / 60;
    console.log(`    0 V'tan susmaya    : ${kesintiSure.toFixed(0)} dk (yedek akü ile ayakta kaldığı süre)`);
    const b0 = sifir["battery.voltage"], b1 = ms[ms.length - 1]["battery.voltage"];
    console.log(`    yedek akü          : ${b0} V → ${b1} V`);
    const hareketli = ms.slice(idx).filter(m => (m["position.speed"] ?? 0) > 2).length;
    console.log(`    0 V sonrası hareketli mesaj (hız>2): ${hareketli}/${ms.length - idx}`);
    const p0 = ms[idx], p1 = ms[ms.length - 1];
    console.log(`    0 V anındaki konum : ${p0["position.latitude"]}, ${p0["position.longitude"]}`);
    console.log(`    son konum          : ${p1["position.latitude"]}, ${p1["position.longitude"]}`);
  } else {
    console.log(`    pencerede 0 V'a GEÇİŞ anı yok — kesinti 6 saatten önce olmuş`);
  }
}

console.log(`\n╚══ İKİNCİ TUR BİTTİ · salt okuma ═══\n`);
