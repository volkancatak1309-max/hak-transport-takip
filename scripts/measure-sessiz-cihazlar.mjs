#!/usr/bin/env node
/**
 * SESSİZ CİHAZ ADLİ İNCELEMESİ — SALT OKUMA.
 *
 * ⚠️ HİÇBİR KOMUT GÖNDERMEZ, HİÇBİR ŞEY YAZMAZ. Yalnız GET:
 *     GET /gw/devices/all
 *     GET /gw/devices/{id}/telemetry/all
 *     GET /gw/devices/{id}/logs
 *     GET /gw/devices/{id}/messages
 *     GET /gw/devices/{id}/connections/all
 *     GET /gw/channels/{id}/logs
 * POST/PUT/DELETE YOK.
 *
 * Plaka listesi koda GÖMÜLMEZ — sessizlik eşiğinden (SESSIZ_GUN, vars. 2) türetilir,
 * böylece betik kullanıcının verdiği listeyi bağımsız olarak DOĞRULAR.
 *
 * Ham kanıt JSON olarak DUMP_DIR'a yazılır (varsayılan: scratchpad).
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-sessiz-cihazlar.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";

const T = process.env.FLESPI_TOKEN;
if (!T) {
  console.error("✗ FLESPI_TOKEN tanımlı değil — ölçüm yapılamaz.");
  process.exit(1);
}
const H = { Authorization: `FlespiToken ${T}` };
const SESSIZ_GUN = Number(process.env.SESSIZ_GUN ?? 2);
const DUMP_DIR =
  process.env.DUMP_DIR ??
  "C:/Users/90553/AppData/Local/Temp/claude/C--Users-90553-Desktop-business-hak-transport-takip/3112eb3f-c4c9-454b-a23e-13a9b1061db2/scratchpad";
mkdirSync(DUMP_DIR, { recursive: true });

const NOW = Date.now() / 1000;

/** YALNIZ GET. */
async function G(yol) {
  const r = await fetch("https://flespi.io" + yol, { headers: H, cache: "no-store" });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, s: r.status, hata: j?.errors ?? null, j };
}
const q = (o) => encodeURIComponent(JSON.stringify(o));
const zaman = (t) =>
  t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—";
const gunOnce = (t) => (t ? ((NOW - t) / 86400).toFixed(2) + "g" : "—");
const maske = (s) => (s ? "…" + String(s).slice(-4) : "—");

console.log(`\n╔══ SESSİZ CİHAZ ADLİ İNCELEMESİ · SALT OKUMA ════════════════════════`);
console.log(`║ an        ${new Date().toISOString()}`);
console.log(`║ eşik      son mesaj > ${SESSIZ_GUN} gün önce ise "sessiz"`);
console.log(`║ ⚠️ hiçbir komut gönderilmedi — yalnız GET`);

// ── 1. CİHAZ ENVANTERİ ────────────────────────────────────────────────────
const dv = await G("/gw/devices/all");
if (!dv.ok) {
  console.error("✗ cihaz listesi alınamadı:", dv.s, JSON.stringify(dv.hata));
  process.exit(1);
}
const cihazlar = dv.j.result ?? [];
console.log(`║ flespi hesabındaki cihaz sayısı: ${cihazlar.length}`);

const { data: araclar } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, imei, flespi_device_id, status, is_test, fleet, device_model, vin");
const byDevId = new Map(
  (araclar ?? []).filter((v) => v.flespi_device_id).map((v) => [String(v.flespi_device_id), v])
);
const byImei = new Map((araclar ?? []).filter((v) => v.imei).map((v) => [String(v.imei), v]));

// ── 2. TELEMETRİ ANLIK GÖRÜNTÜSÜ (her cihaz) ─────────────────────────────
const kayitlar = [];
for (const c of cihazlar) {
  const ident = String(c.configuration?.ident ?? "");
  const t = await G(`/gw/devices/${c.id}/telemetry/all`);
  const tel = t.j?.result?.[0]?.telemetry ?? {};
  const v = (k) => tel[k]?.value ?? null;
  const vt = (k) => tel[k]?.ts ?? null;
  kayitlar.push({
    id: c.id,
    ad: c.name,
    ident,
    arac: byDevId.get(String(c.id)) ?? byImei.get(ident) ?? null,
    cihazTipi: c.device_type_id,
    enabled: c.enabled !== false,
    blocked: c.blocked === true,
    messages_ttl: c.messages_ttl ?? null,
    messages_rotate: c.messages_rotate ?? null,
    olusturma: c.cid ?? null,
    telemetriAnahtarSayisi: Object.keys(tel).length,
    sonMsjTs: v("timestamp"),
    sunucuTs: v("server.timestamp"),
    kanal: v("channel.id"),
    besleme: v("external.powersource.voltage"),
    beslemeTs: vt("external.powersource.voltage"),
    akü: v("battery.voltage"),
    aküTs: vt("battery.voltage"),
    aküSeviye: v("battery.level"),
    kontak: v("engine.ignition.status"),
    hareket: v("movement.status"),
    lat: v("position.latitude"),
    lng: v("position.longitude"),
    hiz: v("position.speed"),
    uydu: v("position.satellites"),
    gsm: v("gsm.signal.level"),
    operator: v("gsm.network.operator.code") ?? v("gsm.operator.code") ?? v("gsm.mcc") ?? null,
    cellid: v("gsm.cellid") ?? null,
    iccid: v("gsm.sim.iccid") ?? v("sim.iccid") ?? null,
    km: v("can.vehicle.mileage"),
    sleep: v("sleep.mode.status") ?? v("device.sleep.status") ?? null,
    unplug: v("unplug.status") ?? v("battery.unplug.status") ?? null,
    telemetriHam: tel,
  });
}

// ── 3. SESSİZLİK SIRALAMASI (tam filo) ───────────────────────────────────
kayitlar.sort((a, b) => (a.sonMsjTs ?? 0) - (b.sonMsjTs ?? 0));
console.log(`\n── TÜM FİLO · SON MESAJ SIRALAMASI (en eski önce) ──`);
console.log(
  `  ${"plaka/ad".padEnd(13)}${"devId".padEnd(9)}${"imei".padEnd(7)}${"sessiz".padStart(8)}` +
    `  ${"son mesaj (UTC)".padEnd(21)}${"besleme".padStart(8)}${"akü".padStart(7)}${"kontak".padStart(8)}${"kanal".padStart(7)}`
);
for (const k of kayitlar) {
  const sessiz = k.sonMsjTs ? (NOW - k.sonMsjTs) / 86400 : 9999;
  const isar = sessiz > SESSIZ_GUN ? "🔴" : sessiz > 0.5 ? "🟡" : "  ";
  console.log(
    `${isar}${(k.arac?.plate ?? k.ad).slice(0, 12).padEnd(13)}${String(k.id).padEnd(9)}${maske(k.ident).padEnd(7)}` +
      `${gunOnce(k.sonMsjTs).padStart(8)}  ${zaman(k.sonMsjTs).padEnd(21)}` +
      `${(k.besleme ?? "—").toString().padStart(8)}${(k.akü ?? "—").toString().padStart(7)}` +
      `${(k.kontak === null ? "—" : k.kontak ? "AÇIK" : "kapalı").padStart(8)}${String(k.kanal ?? "—").padStart(7)}`
  );
}

const sessizler = kayitlar.filter((k) => !k.sonMsjTs || (NOW - k.sonMsjTs) / 86400 > SESSIZ_GUN);
console.log(`\n  → sessiz cihaz: ${sessizler.length} / ${kayitlar.length}`);

// ── 4. AKTİF BAĞLANTILAR ─────────────────────────────────────────────────
console.log(`\n── ŞU AN AÇIK TCP BAĞLANTISI OLAN CİHAZLAR ──`);
const conn = await G("/gw/devices/all/connections/all");
const baglantilar = conn.j?.result ?? [];
console.log(`  toplam açık bağlantı: ${baglantilar.length}${conn.ok ? "" : ` (HATA ${conn.s} ${JSON.stringify(conn.hata)})`}`);
const bagliIdent = new Set(baglantilar.map((b) => String(b.ident ?? "")));
for (const k of sessizler) {
  console.log(`    ${(k.arac?.plate ?? k.ad).padEnd(13)} açık bağlantı: ${bagliIdent.has(k.ident) ? "VAR ⚠️" : "yok"}`);
}

// ── 5. HER SESSİZ CİHAZ İÇİN DERİN İNCELEME ──────────────────────────────
const detay = [];
for (const k of sessizler) {
  const etiket = k.arac?.plate ?? k.ad;
  const son = k.sonMsjTs ?? NOW;

  // 5a. Susmadan önceki 72 saatin mesajları (+ susma sonrası 1 gün: hiç var mı?)
  const msgFrom = Math.floor(son - 72 * 3600);
  const msgTo = Math.floor(NOW);
  const mg = await G(
    `/gw/devices/${k.id}/messages?data=` +
      q({
        from: msgFrom,
        to: msgTo,
        reverse: false,
        count: 10000,
        fields:
          "timestamp,server.timestamp,external.powersource.voltage,battery.voltage,battery.level," +
          "engine.ignition.status,position.latitude,position.longitude,position.speed,position.satellites," +
          "gsm.signal.level,movement.status,can.vehicle.mileage,sleep.mode.status,unplug.status," +
          "battery.unplug.status,event.enum,event.priority.enum,gsm.cellid,gsm.network.operator.code",
      })
  );
  let mesajlar = mg.j?.result ?? [];
  let alanHatasi = null;
  if (!mg.ok) {
    alanHatasi = `${mg.s} ${JSON.stringify(mg.hata)}`;
    // fields desteklenmiyorsa alansız tekrar dene
    const mg2 = await G(
      `/gw/devices/${k.id}/messages?data=` + q({ from: msgFrom, to: msgTo, reverse: false, count: 10000 })
    );
    mesajlar = mg2.j?.result ?? [];
    if (mg2.ok) alanHatasi += " → alansız yeniden denendi: OK";
  }

  // 5b. Cihaz logları — susmadan 3 gün önce → şimdi
  const lg = await G(
    `/gw/devices/${k.id}/logs?data=` +
      q({ from: Math.floor(son - 72 * 3600), to: Math.floor(NOW), count: 3000, reverse: true })
  );
  const loglar = lg.j?.result ?? [];

  // 5c. Kanal logları — aynı pencere, yalnız bu ident
  let kanalLog = [];
  let kanalHata = null;
  if (k.kanal) {
    const cl = await G(
      `/gw/channels/${k.kanal}/logs?data=` +
        q({
          from: Math.floor(son - 72 * 3600),
          to: Math.floor(NOW),
          count: 3000,
          reverse: true,
          filter: `ident=="${k.ident}"`,
        })
    );
    if (cl.ok) kanalLog = cl.j?.result ?? [];
    else kanalHata = `${cl.s} ${JSON.stringify(cl.hata)}`;
  }

  detay.push({ k, mesajlar, loglar, kanalLog, kanalHata, alanHatasi, msgFrom, etiket });
}

// ── 6. RAPOR ─────────────────────────────────────────────────────────────
for (const d of detay) {
  const { k, mesajlar, loglar, kanalLog, etiket } = d;
  console.log(`\n${"═".repeat(78)}`);
  console.log(`▌ ${etiket}  ·  flespi #${k.id}  ·  imei ${maske(k.ident)}  ·  kanal ${k.kanal ?? "—"}`);
  console.log(`${"═".repeat(78)}`);
  console.log(
    `  DB: durum ${k.arac?.status ?? "—"} · filo ${k.arac?.fleet ?? "—"} · model ${k.arac?.device_model ?? "—"} · test ${k.arac?.is_test === true}`
  );
  console.log(
    `  cihaz: tip ${k.cihazTipi} · enabled ${k.enabled} · blocked ${k.blocked} · msg TTL ${k.messages_ttl ?? "—"}s · rotate ${k.messages_rotate ?? "—"}`
  );
  console.log(`\n  ① SON KAYIT`);
  console.log(`     cihaz RTC          ${zaman(k.sonMsjTs)}   (${gunOnce(k.sonMsjTs)} önce)`);
  console.log(`     flespi alım anı    ${zaman(k.sunucuTs)}`);
  const gecikme = k.sonMsjTs && k.sunucuTs ? (k.sunucuTs - k.sonMsjTs).toFixed(0) : "—";
  console.log(`     RTC↔sunucu farkı   ${gecikme} sn`);

  console.log(`\n  ② VOLTAJ`);
  console.log(`     besleme (harici)   ${k.besleme ?? "—"} V   (değer anı ${zaman(k.beslemeTs)})`);
  console.log(`     dahili akü         ${k.akü ?? "—"} V   (değer anı ${zaman(k.aküTs)})`);
  console.log(`     akü seviyesi       ${k.aküSeviye ?? "—"}`);

  console.log(`\n  ③ KONTAK / KONUM`);
  console.log(`     kontak             ${k.kontak === null ? "—" : k.kontak ? "AÇIK" : "kapalı"}`);
  console.log(`     hareket            ${k.hareket === null ? "—" : k.hareket}`);
  console.log(`     konum              ${k.lat ?? "—"}, ${k.lng ?? "—"}  (hız ${k.hiz ?? "—"} km/s · uydu ${k.uydu ?? "—"})`);
  console.log(`     gsm sinyal         ${k.gsm ?? "—"} · hücre ${k.cellid ?? "—"} · operatör ${k.operator ?? "—"}`);
  console.log(`     odometre           ${k.km ?? "—"} km`);

  // ④ Susmadan önceki kayıt sıklığı
  console.log(`\n  ④ SUSMADAN ÖNCEKİ KAYIT SIKLIĞI (son mesajdan geriye 72 sa)`);
  const ts = mesajlar.map((m) => m.timestamp).filter((x) => typeof x === "number").sort((a, b) => a - b);
  console.log(`     pencerede mesaj    ${ts.length}${d.alanHatasi ? `  ⚠️ ${d.alanHatasi}` : ""}`);
  if (ts.length) {
    console.log(`     ilk / son          ${zaman(ts[0])}  →  ${zaman(ts[ts.length - 1])}`);
    const sonrasi = ts.filter((x) => x > (k.sonMsjTs ?? 0) + 1).length;
    console.log(`     son telemetriden SONRA gelen mesaj: ${sonrasi}`);
    // saatlik histogram (son mesajdan geriye 24 saat)
    const t0 = k.sonMsjTs ?? ts[ts.length - 1];
    const kova = new Array(24).fill(0);
    for (const x of ts) {
      const h = Math.floor((t0 - x) / 3600);
      if (h >= 0 && h < 24) kova[h]++;
    }
    console.log(`     saat başına kayıt (0 = son saat, geriye doğru):`);
    for (let i = 0; i < 24; i += 6) {
      const dilim = kova
        .slice(i, i + 6)
        .map((n, j) => `-${String(i + j).padStart(2)}s:${String(n).padStart(3)}`)
        .join(" ");
      console.log(`       ${dilim}`);
    }
    // en büyük boşluk
    let maxGap = 0;
    let gapAt = null;
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] > maxGap) {
        maxGap = ts[i] - ts[i - 1];
        gapAt = ts[i - 1];
      }
    }
    console.log(`     penceredeki en büyük boşluk: ${(maxGap / 60).toFixed(1)} dk (${zaman(gapAt)} sonrası)`);

    // son 12 mesajın voltaj/kontak izi
    console.log(`\n     SON 12 MESAJ İZİ`);
    console.log(
      `       ${"zaman (UTC)".padEnd(21)}${"besle".padStart(7)}${"akü".padStart(7)}${"kont".padStart(6)}${"hız".padStart(5)}${"uydu".padStart(6)}${"gsm".padStart(5)}${"hareket".padStart(9)}`
    );
    for (const m of mesajlar.slice(-12)) {
      console.log(
        `       ${zaman(m.timestamp).padEnd(21)}` +
          `${String(m["external.powersource.voltage"] ?? "—").padStart(7)}` +
          `${String(m["battery.voltage"] ?? "—").padStart(7)}` +
          `${(m["engine.ignition.status"] === undefined ? "—" : m["engine.ignition.status"] ? "AÇIK" : "kap").padStart(6)}` +
          `${String(m["position.speed"] ?? "—").padStart(5)}` +
          `${String(m["position.satellites"] ?? "—").padStart(6)}` +
          `${String(m["gsm.signal.level"] ?? "—").padStart(5)}` +
          `${String(m["movement.status"] ?? "—").padStart(9)}`
      );
    }
    // voltaj eğilimi
    const volt = mesajlar
      .map((m) => ({ t: m.timestamp, v: m["external.powersource.voltage"], b: m["battery.voltage"] }))
      .filter((x) => typeof x.v === "number");
    if (volt.length >= 2) {
      const ilk = volt[0];
      const sonV = volt[volt.length - 1];
      const min = volt.reduce((a, b) => (b.v < a.v ? b : a));
      console.log(
        `\n     besleme voltajı: ilk ${ilk.v} V (${zaman(ilk.t)}) → son ${sonV.v} V (${zaman(sonV.t)}) · pencere min ${min.v} V (${zaman(min.t)})`
      );
    }
    const bat = mesajlar
      .map((m) => ({ t: m.timestamp, b: m["battery.voltage"] }))
      .filter((x) => typeof x.b === "number");
    if (bat.length >= 2) {
      console.log(
        `     dahili akü:      ilk ${bat[0].b} V → son ${bat[bat.length - 1].b} V · min ${Math.min(...bat.map((x) => x.b))} V`
      );
    }
  }

  // ⑤ Loglar
  console.log(`\n  ⑤ CİHAZ LOGLARI (300=bağlandı 301=koptu 304=veri hatası 305=uyarı)`);
  console.log(`     pencerede log kaydı: ${loglar.length}`);
  const kodSay = new Map();
  for (const l of loglar) kodSay.set(l.event_code, (kodSay.get(l.event_code) ?? 0) + 1);
  console.log(
    `     kod dağılımı: ${[...kodSay.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(" · ") || "—"}`
  );
  for (const l of loglar.slice(0, 15)) {
    console.log(
      `       ${zaman(l.timestamp).padEnd(21)} kod ${String(l.event_code).padEnd(4)} ${String(l.event_text ?? "").slice(0, 90)}`
    );
  }

  console.log(`\n  ⑥ KANAL LOGLARI (100=kabul 101=tanımlandı 102=kapandı+close_code)`);
  if (d.kanalHata) console.log(`     ⚠️ okunamadı: ${d.kanalHata}`);
  console.log(`     pencerede kayıt: ${kanalLog.length}`);
  const kapanislar = kanalLog.filter((l) => l.event_code === 102);
  const ccSay = new Map();
  for (const l of kapanislar) ccSay.set(l.close_code, (ccSay.get(l.close_code) ?? 0) + 1);
  console.log(
    `     close_code dağılımı: ${[...ccSay.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(" · ") || "—"}`
  );
  for (const l of kanalLog.slice(0, 15)) {
    console.log(
      `       ${zaman(l.timestamp).padEnd(21)} kod ${String(l.event_code).padEnd(4)}` +
        ` cc ${String(l.close_code ?? "—").padEnd(4)} süre ${String(l.duration ?? "—").padStart(7)}s` +
        ` msj ${String(l.msgs ?? "—").padStart(5)} al ${String(l.recv ?? "—").padStart(7)}B` +
        ` gön ${String(l.send ?? "—").padStart(6)}B  ${String(l.source ?? "").padEnd(16)} ${String(l.error_text ?? "").slice(0, 40)}`
    );
  }
  // EN SON kanal olayı — susmanın imzası
  if (kanalLog.length) {
    const enSon = kanalLog[0];
    console.log(
      `\n     ⇒ EN SON KANAL OLAYI: ${zaman(enSon.timestamp)} · kod ${enSon.event_code}` +
        (enSon.close_code !== undefined ? ` · close_code ${enSon.close_code}` : "") +
        (enSon.error_text ? ` · ${enSon.error_text}` : "")
    );
  }
}

// ── 7. HAM KANIT DÖKÜMÜ ──────────────────────────────────────────────────
const dump = {
  olcumAni: new Date().toISOString(),
  esikGun: SESSIZ_GUN,
  filo: kayitlar.map((k) => ({
    id: k.id,
    ad: k.ad,
    plaka: k.arac?.plate ?? null,
    identSon4: maske(k.ident),
    sonMsjTs: k.sonMsjTs,
    sonMsj: zaman(k.sonMsjTs),
    sessizGun: k.sonMsjTs ? Number(((NOW - k.sonMsjTs) / 86400).toFixed(3)) : null,
    kanal: k.kanal,
    besleme: k.besleme,
    aku: k.akü,
    kontak: k.kontak,
    lat: k.lat,
    lng: k.lng,
    km: k.km,
    gsm: k.gsm,
    cellid: k.cellid,
    telemetriAnahtarSayisi: k.telemetriAnahtarSayisi,
    messages_ttl: k.messages_ttl,
    enabled: k.enabled,
    blocked: k.blocked,
  })),
  sessizDetay: detay.map((d) => ({
    plaka: d.etiket,
    id: d.k.id,
    kanal: d.k.kanal,
    sonMsjTs: d.k.sonMsjTs,
    telemetriHam: d.k.telemetriHam,
    mesajSayisi: d.mesajlar.length,
    sonMesajlar: d.mesajlar.slice(-60),
    loglar: d.loglar.slice(0, 200),
    kanalLog: d.kanalLog.slice(0, 200),
    kanalHata: d.kanalHata,
  })),
};
const yol = path.join(DUMP_DIR, "sessiz-cihazlar-kanit.json");
writeFileSync(yol, JSON.stringify(dump, null, 2), "utf8");
console.log(`\n── HAM KANIT: ${yol} (${(JSON.stringify(dump).length / 1024).toFixed(0)} KB)`);
console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir komut gönderilmedi ═══\n`);
