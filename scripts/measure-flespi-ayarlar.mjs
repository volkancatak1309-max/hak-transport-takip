#!/usr/bin/env node
/**
 * FLESPI CİHAZ AYARLARI — SALT OKUMA ÖLÇÜMÜ.
 *
 * ⚠️ BU BETİK HİÇBİR KOMUT GÖNDERMEZ. Yalnız GET çağrıları yapar:
 *     GET /gw/devices/all
 *     GET /gw/devices/{id}/settings/{ad listesi}
 *     GET /gw/devices/all/commands-queue/all
 *     GET /gw/devices/{id}/commands-result
 *     GET /gw/devices/{id}/telemetry/all
 *     GET /gw/channels/{id}/connections
 * POST / PUT / DELETE YOK. commands-queue'ya yazma YOK.
 *
 * FLESPI_TOKEN yalnız Authorization başlığında kullanılır, HİÇBİR YERE BASILMAZ.
 * IMEI çıktıda maskelenir (son 4 hane).
 *
 * ── AYAR ADI EŞLEMESİ ─────────────────────────────────────────────────────
 * flespi ham Teltonika parametre numarasını (11004 gibi) DEĞİL, cihaz tipinin
 * adlandırılmış ayarlarını sunar. Eşleme (Teltonika FMC003 / device_type 1303):
 *   11000/11004/11005/11006 → green_driving_obd {source,max_accel,max_brake,max_angle}
 *   11100/11104             → overspeeding_obd  {prio,max_speed}
 *   11200/11205             → idling_obd        {prio,record,move_time,stop_time}
 *   11300/11303             → jamming_timeout   {mode:{event_enable,priority,timeout}}
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-flespi-ayarlar.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";

const T = process.env.FLESPI_TOKEN;
if (!T) {
  console.error("✗ FLESPI_TOKEN tanımlı değil — ölçüm yapılamaz.");
  process.exit(1);
}
const H = { Authorization: `FlespiToken ${T}` };

/** YALNIZ GET. Başka metot bu betikte YOK. */
async function G(yol) {
  const r = await fetch("https://flespi.io" + yol, { headers: H });
  const j = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, s: r.status, hata: j?.errors ?? null, j };
  return { ok: true, s: r.status, j };
}

/**
 * Virgüllü seçici (`settings/a,b,c`) canlıda BOŞ döndü (33/33 cihazda 200 + 0
 * satır, hata yok) — sessiz bir eşleşmeme. `settings/all` çekip istemcide
 * süzmek ÖLÇÜLEBİLİR olan yol; küçük filo için maliyeti önemsiz.
 */
const ILGILI = ["green_driving_obd", "overspeeding_obd", "idling_obd", "jamming_timeout"];

/** status alt 4 bit = değerin kaynağı, üst 4 bit = platformun niyeti. */
function durumMetni(st) {
  if (st === undefined || st === null) return "—";
  const kaynak = { 0: "yok", 1: "OKUNDU", 2: "OKUNAMAZ", 3: "UYGULANDI" }[st & 0x0f] ?? `?${st & 0x0f}`;
  const niyet = (st & 0xf0) === 0x10 ? "+okumaya çalışıyor" : (st & 0xf0) === 0x20 ? "+uygulamaya çalışıyor" : "";
  return kaynak + niyet;
}
const zaman = (t) => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) : "—");
const gunOnce = (t) => (t ? ((Date.now() / 1000 - t) / 86400).toFixed(1) + "g" : "—");
const maske = (s) => (s ? "…" + String(s).slice(-4) : "—");

console.log(`\n╔══ FLESPI CİHAZ AYARLARI · SALT OKUMA ═════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);
console.log(`║ ⚠️ hiçbir komut gönderilmedi — yalnız GET`);

// ── 1. CİHAZLAR + PLAKA EŞLEŞMESİ ────────────────────────────────────────
const dv = await G("/gw/devices/all");
if (!dv.ok) {
  console.error("✗ cihaz listesi alınamadı:", dv.s, JSON.stringify(dv.hata));
  process.exit(1);
}
const cihazlar = dv.j.result ?? [];

// test-filtered: araç eşlemesi için TÜM araçlar gerekiyor; test aracı da
// flespi'de kayıtlıysa tabloda görünmeli ki "eşleşmeyen" sayısı doğru çıksın.
const { data: araclar } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, imei, flespi_device_id, status, is_test");
const byDevId = new Map((araclar ?? []).filter((v) => v.flespi_device_id).map((v) => [String(v.flespi_device_id), v]));
const byImei = new Map((araclar ?? []).filter((v) => v.imei).map((v) => [String(v.imei), v]));

// ── 2. AYARLAR + BAĞLANTI ────────────────────────────────────────────────
/** Cihazın kanal bağlantı listesi — o an açık TCP oturumları. */
const bagliIdent = new Set();
{
  const kanalIds = new Set();
  for (const c of cihazlar) {
    const t = await G(`/gw/devices/${c.id}/telemetry/channel.id`);
    const v = t.j?.result?.[0]?.telemetry?.["channel.id"]?.value;
    if (v) kanalIds.add(v);
  }
  for (const kid of kanalIds) {
    const cn = await G(`/gw/channels/${kid}/connections/all`);
    if (cn.ok) for (const c of cn.j.result ?? []) if (c.ident) bagliIdent.add(String(c.ident));
    else console.log(`  (kanal ${kid} bağlantıları OKUNAMADI: ${cn.s} ${JSON.stringify(cn.hata)})`);
  }
  if (kanalIds.size === 0) console.log("  (kanal kimliği hiçbir cihazın telemetrisinde YOK — bağlılık ÖLÇÜLMEDİ)");
}

const satirlar = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const arac = byDevId.get(String(c.id)) ?? byImei.get(ident) ?? null;
  const st = await G(`/gw/devices/${c.id}/settings/all`);
  const ayar = {};
  for (const a of st.j?.result ?? []) if (ILGILI.includes(a.name)) ayar[a.name] = a;
  const tel = await G(`/gw/devices/${c.id}/telemetry/timestamp`);
  const sonMesaj = tel.j?.result?.[0]?.telemetry?.timestamp?.value ?? null;
  satirlar.push({
    id: c.id,
    ad: c.name,
    ident,
    arac,
    bagli: bagliIdent.has(ident),
    sonMesaj,
    pollMode: c.configuration?.settings_polling ?? "—",
    gd: ayar.green_driving_obd ?? null,
    os: ayar.overspeeding_obd ?? null,
    idl: ayar.idling_obd ?? null,
    jam: ayar.jamming_timeout ?? null,
    ayarHatasi: st.ok ? null : `${st.s} ${JSON.stringify(st.hata)}`,
  });
}

console.log(`║ flespi cihazı ${cihazlar.length} · DB aracı ${(araclar ?? []).length} · eşleşen ${satirlar.filter((s) => s.arac).length}`);
console.log(`║ o an bağlı ${satirlar.filter((s) => s.bagli).length}`);

// ── TABLO ────────────────────────────────────────────────────────────────
console.log(`\n── AYAR TABLOSU (hedef: hızlanma 3.3 · fren 3.3 · viraj 4.5 · hız 120 · rölanti 300 · jamming açık) ──`);
console.log(
  `  ${"plaka".padEnd(10)}${"imei".padEnd(7)}${"bağ".padEnd(4)}${"son msj".padEnd(8)}` +
    `${"hızlan".padStart(7)}${"fren".padStart(6)}${"viraj".padStart(6)}${"hız".padStart(5)}${"rölanti".padStart(8)}${"jam".padStart(7)}` +
    `  ${"AYAR OKUMA ANI".padEnd(17)} durum`
);
satirlar.sort((a, b) => (a.arac?.plate ?? "zzz").localeCompare(b.arac?.plate ?? "zzz"));
const say = { gdHedef: 0, gdFarkli: 0, gdYok: 0, osHedef: 0, osFarkli: 0, osYok: 0 };
for (const s of satirlar) {
  const g = s.gd?.current ?? null;
  const o = s.os?.current ?? null;
  const i = s.idl?.current ?? null;
  const j = s.jam?.current?.mode ?? null;
  const hedefGd = g && g.max_accel === 3.3 && g.max_brake === 3.3 && g.max_angle === 4.5;
  const hedefOs = o && o.max_speed === 120;
  if (!g) say.gdYok++; else if (hedefGd) say.gdHedef++; else say.gdFarkli++;
  if (!o) say.osYok++; else if (hedefOs) say.osHedef++; else say.osFarkli++;
  console.log(
    `  ${(s.arac?.plate ?? s.ad.slice(0, 9)).padEnd(10)}${maske(s.ident).padEnd(7)}` +
      `${(s.bagli ? "✓" : "·").padEnd(4)}${gunOnce(s.sonMesaj).padEnd(8)}` +
      `${String(g?.max_accel ?? "—").padStart(7)}${String(g?.max_brake ?? "—").padStart(6)}${String(g?.max_angle ?? "—").padStart(6)}` +
      `${String(o?.max_speed ?? "—").padStart(5)}${String(i?.stop_time ?? "—").padStart(8)}${(j ? (j.event_enable ? "açık" : "KAPALI") : "—").padStart(7)}` +
      `  ${zaman(s.gd?.updated).padEnd(17)} ${durumMetni(s.gd?.status)}${s.ayarHatasi ? " ⚠ " + s.ayarHatasi : ""}`
  );
}
console.log(`\n  green_driving: hedefte ${say.gdHedef} · FARKLI ${say.gdFarkli} · değer YOK ${say.gdYok}`);
console.log(`  overspeeding : hedefte ${say.osHedef} · FARKLI ${say.osFarkli} · değer YOK ${say.osYok}`);

// benzersiz değer kümeleri
const kume = (f) => {
  const m = new Map();
  for (const s of satirlar) {
    const k = f(s);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(" · ");
};
console.log(`\n  FARKLI DEĞER KÜMELERİ`);
console.log(`    green_driving (accel/brake/angle): ${kume((s) => s.gd?.current ? `${s.gd.current.max_accel}/${s.gd.current.max_brake}/${s.gd.current.max_angle}` : "YOK")}`);
console.log(`    overspeeding (max_speed)         : ${kume((s) => s.os?.current?.max_speed ?? "YOK")}`);
console.log(`    idling (stop_time)               : ${kume((s) => s.idl?.current?.stop_time ?? "YOK")}`);
console.log(`    jamming (event_enable/timeout)   : ${kume((s) => s.jam?.current?.mode ? `${s.jam.current.mode.event_enable}/${s.jam.current.mode.timeout}` : "YOK")}`);
console.log(`    green_driving durum              : ${kume((s) => durumMetni(s.gd?.status))}`);
console.log(`    ayar polling modu                : ${kume((s) => s.pollMode)}`);

// ── 4. KOMUT KUYRUĞU ve GEÇMİŞİ ──────────────────────────────────────────
console.log(`\n── KOMUT KUYRUĞU (bekleyen) ──`);
const q = await G("/gw/devices/all/commands-queue/all");
const kuyruk = q.j?.result ?? [];
console.log(`  bekleyen komut: ${kuyruk.length}`);
for (const k of kuyruk) {
  const s = satirlar.find((x) => x.id === k.device_id);
  console.log(
    `    ${(s?.arac?.plate ?? s?.ad ?? k.device_id).toString().padEnd(11)} eklendi ${zaman(k.timestamp)} · bitiş ${zaman(k.expires)} · deneme ${k.max_attempts} · yürütüldü ${k.executed}`
  );
  console.log(`      ${String(k.properties?.text ?? "").slice(0, 120)}`);
}

console.log(`\n── KOMUT GEÇMİŞİ (commands-result) ──`);
let toplamSonuc = 0;
/** komut metni → { tarih, exec, plakalar[] } */
const setparamlar = new Map();
for (const s of satirlar) {
  const cr = await G(`/gw/devices/${s.id}/commands-result?count=1000`);
  const rows = cr.j?.result ?? [];
  toplamSonuc += rows.length;
  for (const r of rows) {
    const txt = String(r.properties?.text ?? "");
    if (!txt.startsWith("setparam")) continue;
    const key = `${new Date(r.timestamp * 1000).toISOString().slice(0, 10)}|${r.executed}|${txt}`;
    const cur = setparamlar.get(key) ??
      { tarih: new Date(r.timestamp * 1000).toISOString().slice(0, 10), exec: r.executed, txt, plakalar: [], meta: r.command_meta ?? null };
    cur.plakalar.push(s.arac?.plate ?? s.ad);
    setparamlar.set(key, cur);
  }
}
console.log(`  toplam sonuç kaydı: ${toplamSonuc}`);
const gruplar = [...setparamlar.values()].sort((a, b) => a.tarih.localeCompare(b.tarih));
for (const v of gruplar) {
  const p = v.txt.match(/11004:([\d.]+).*?11005:([\d.]+).*?11006:([\d.]+).*?11104:(\d+).*?11205:(\d+)/);
  console.log(
    `\n    ${v.tarih} · ${v.exec ? "UYGULANDI" : "UYGULANMADI (süresi doldu)"} · ${v.plakalar.length} cihaz` +
      (v.meta ? ` · meta ${JSON.stringify(v.meta)}` : "")
  );
  if (p) console.log(`      hızlanma ${p[1]} · fren ${p[2]} · viraj ${p[3]} · hız ${p[4]} · rölanti ${p[5]}`);
  console.log(`      ${v.plakalar.sort().join(", ")}`);
}
/** Hangi cihaz HİÇ setparam almamış? */
const dokunulan = new Set(gruplar.flatMap((g) => g.plakalar));
const hic = satirlar.filter((s) => !dokunulan.has(s.arac?.plate ?? s.ad));
console.log(`\n  HİÇ setparam kaydı OLMAYAN cihaz: ${hic.length}`);
if (hic.length) console.log(`    ${hic.map((s) => s.arac?.plate ?? s.ad).sort().join(", ")}`);

// ── 5. ÖNBELLEK TAZELİĞİ — TABLONUN GEÇERLİLİK SINIRI ────────────────────
console.log(`\n── ⚠️ AYAR ÖNBELLEĞİNİN TAZELİĞİ ──`);
{
  const gs = satirlar.map((s) => s.gd?.updated).filter(Boolean).sort();
  console.log(`  green_driving 'updated' aralığı: ${zaman(gs[0])} → ${zaman(gs[gs.length - 1])}`);
  const enSonKomut = gruplar.filter((g) => g.exec).map((g) => g.tarih).sort().pop();
  console.log(`  en son UYGULANAN setparam    : ${enSonKomut}`);
  const bayat = gs[gs.length - 1] < new Date(enSonKomut + "T00:00:00Z").getTime() / 1000;
  console.log(`  önbellek komutlardan ESKİ Mİ : ${bayat ? "EVET — tablo cihazın BUGÜNKÜ hâlini göstermiyor" : "hayır"}`);
  console.log(`  settings_polling             : ${kume((s) => s.pollMode)}`);
  console.log(`  ⇒ "once" = flespi ayarları BİR KEZ okur, bir daha okumaz. Ham 'setparam'`);
  console.log(`     komutu ayar API'sinden GEÇMEDİĞİ için önbellek onlardan haberdar değil.`);
}

// ── 6. KUYRUK ÖMRÜ — "30 gün mü 24 saat mi" ──────────────────────────────
console.log(`\n── KUYRUK ÖMRÜ (süresi dolan komutlar) ──`);
{
  let n = 0;
  for (const s of satirlar) {
    const cr = await G(`/gw/devices/${s.id}/commands-result?count=1000`);
    for (const r of cr.j?.result ?? []) {
      if (r.executed !== false) continue;
      if (!String(r.properties?.text ?? "").startsWith("setparam")) continue;
      const omur = r.expires && r.timestamp ? ((r.expires - r.timestamp) / 86400).toFixed(1) : "?";
      console.log(`    ${(s.arac?.plate ?? s.ad).padEnd(11)} eklendi ${zaman(r.timestamp)} · bitiş ${zaman(r.expires)} · tanımlı ömür ${omur} gün`);
      n++;
      if (n >= 20) break;
    }
    if (n >= 20) break;
  }
  if (n === 0) console.log("    (süresi dolmuş setparam kaydı bulunamadı)");
}

// ── 7. EŞLEŞMEYEN DB ARACI ───────────────────────────────────────────────
{
  const eslesen = new Set(satirlar.map((s) => s.arac?.id).filter(Boolean));
  const bosta = (araclar ?? []).filter((v) => !eslesen.has(v.id));
  console.log(`\n── flespi'de KARŞILIĞI OLMAYAN DB aracı: ${bosta.length} ──`);
  for (const v of bosta) {
    console.log(`    ${v.plate} · durum ${v.status} · test ${v.is_test === true} · imei ${maske(v.imei)} · flespi_device_id ${v.flespi_device_id ?? "YOK"}`);
  }
}
console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir komut gönderilmedi ═══\n`);
