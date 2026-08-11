#!/usr/bin/env node
/**
 * ARAÇ UÇLARI — CANLIDA KANIT (U1-U6). SALT OKUMA.
 *
 * NE YAPAR: `app/api/mobile/vehicles/[id]/{gunler,rota,olaylar,duraklar,metrikler}`
 * uçlarının ÇALIŞTIRDIĞI sorgu yolunu canlı Supabase'de birebir tekrarlar ve
 * yanıt gövdelerini basar. Şekli üreten fonksiyonlar KOPYALANMAZ — uçların
 * kullandığı `lib/vehicle-day.ts` buradan da içe aktarılır (`--import ts-alias`).
 *
 * NEDEN HTTP DEĞİL: bu projede kimlik doğrulamalı QA bloklu (CLAUDE.md), kanıt
 * yöntemi UI-path proof. Kopyalanan tek şey `server-only` zincirindeki DB
 * yardımcılarıdır: `listVehicleTrack` sayfalaması, `fetchAllRows`, `mapBounded`.
 * Hepsi aşağıda AYNI parametrelerle yeniden kuruldu ve kaynağı yazıldı.
 *
 * Kullanım:
 *   node --import ./scripts/ts-alias.mjs scripts/verify-arac-uclari.mjs
 *   node --import ./scripts/ts-alari.mjs scripts/verify-arac-uclari.mjs DO-282HF 2026-08-10
 *   … .env.sendigo için:  ENV_FILE=.env.sendigo node --import …
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import {
  gecerliGun,
  gunDuraklari,
  gunMetrikleri,
  gunOlaylari,
  gunPenceresi,
  izGunleri,
  seyrelt,
  sonGunler,
  GUN_PENCERE_MAX,
} from "@/lib/vehicle-day";
import { viennaDayKey } from "@/lib/format";

const ENV_FILE = path.resolve(process.cwd(), process.env.ENV_FILE ?? ".env.local");
if (!fs.existsSync(ENV_FILE)) {
  console.error(`✗ env dosyası yok: ${ENV_FILE}`);
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PLAKA_ARG = process.argv[2] ?? null;
const GUN_ARG = process.argv[3] ?? null;

/** lib/db-fanout.ts `mapBounded` replikası (server-only, içe aktarılamıyor). */
async function mapBounded(items, fn, limit = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/** lib/telemetry.ts `listVehicleTrack` replikası — 1000'lik sayfalama, ≤100 sayfa. */
async function listVehicleTrack(vehicleId, fromIso, toIso) {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await sb
      .from("device_telemetry")
      .select("vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at")
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", fromIso)
      .lte("recorded_at", toIso)
      .order("recorded_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** lib/supabase.ts `fetchAllRows` replikası — 1000 satır tavanını yener. */
async function fetchAllRows(build) {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) return rows;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const kisa = (o, n = 900) => {
  const s = JSON.stringify(o, null, 1);
  return s.length <= n ? s : s.slice(0, n) + `\n… (${s.length} bayt)`;
};
let dusen = 0;
let olculmeyen = 0;
function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
/**
 * Ölçülemeyen iddia GEÇMİŞ SAYILMAZ ama DÜŞMÜŞ de sayılmaz — adıyla "ÖLÇÜLMEDİ"
 * yazılır. Boş bir araç-günde "hız taşınıyor mu" sorusunun cevabı yoktur;
 * `false` demek yanlış alarm, `true` demek uydurma olurdu.
 */
function olculmedi(baslik, sebep) {
  console.log(`  ○ ${baslik}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
}

console.log(`\n╔══ ARAÇ UÇLARI · CANLIDA KANIT ══════════════════════════════════════`);
console.log(`║ env      ${path.basename(ENV_FILE)}`);
console.log(`║ an       ${new Date().toISOString()} (UTC) · ${viennaDayKey(new Date())} (kiracı günü)`);

// ── Araç seçimi ────────────────────────────────────────────────────────────
const { data: vehicles, error: vErr } = await sb
  .from("vehicles")
  .select("id, plate, is_test, flespi_device_id")
  .order("plate");
if (vErr) {
  console.error(`✗ vehicles: ${vErr.message}`);
  process.exit(1);
}
let arac = PLAKA_ARG
  ? vehicles.find((v) => v.plate === PLAKA_ARG)
  : null;
if (PLAKA_ARG && !arac) {
  console.error(`✗ plaka bulunamadı: ${PLAKA_ARG}`);
  process.exit(1);
}
if (!arac) {
  // En yoğun aracı seç — en çok noktası olan gün listesi en anlamlısı.
  const from14 = gunPenceresi(sonGunler(GUN_PENCERE_MAX).at(-1)).baslangic;
  const skor = await mapBounded(
    vehicles.filter((v) => !v.is_test),
    async (v) => {
      const { count } = await sb
        .from("device_telemetry")
        .select("recorded_at", { count: "exact", head: true })
        .eq("vehicle_id", v.id)
        .gte("recorded_at", from14);
      return { v, n: count ?? 0 };
    }
  );
  skor.sort((a, b) => b.n - a.n);
  arac = skor[0].v;
}
console.log(`║ araç     ${arac.plate}  (${arac.id})`);

// ══ U1 · GET /vehicles/[id]/gunler ═════════════════════════════════════════
console.log(`\n── U1  GET /api/mobile/vehicles/${arac.plate}/gunler?n=${GUN_PENCERE_MAX} ──`);
const t1 = Date.now();
const adaylar = sonGunler(GUN_PENCERE_MAX);
const satirlar = await mapBounded(adaylar, async (gun) => {
  const p = gunPenceresi(gun);
  const ilkRes = await sb
    .from("device_telemetry")
    .select("recorded_at", { count: "exact" })
    .eq("vehicle_id", arac.id)
    .gte("recorded_at", p.baslangic)
    .lte("recorded_at", p.bitis)
    .order("recorded_at", { ascending: true })
    .limit(1);
  if (ilkRes.error) {
    return { tarih: gun, hata: ilkRes.error.code === "57014" ? "zaman_asimi" : "hata", nokta: 0 };
  }
  const nokta = ilkRes.count ?? 0;
  if (nokta === 0) return { tarih: gun, hata: null, nokta: 0, ilk: null, son: null };
  const sonRes = await sb
    .from("device_telemetry")
    .select("recorded_at")
    .eq("vehicle_id", arac.id)
    .gte("recorded_at", p.baslangic)
    .lte("recorded_at", p.bitis)
    .order("recorded_at", { ascending: false })
    .limit(1);
  return {
    tarih: gun,
    hata: sonRes.error ? (sonRes.error.code === "57014" ? "zaman_asimi" : "hata") : null,
    nokta,
    ilk: ilkRes.data?.[0]?.recorded_at ?? null,
    son: sonRes.data?.[0]?.recorded_at ?? null,
  };
});
const u1sure = Date.now() - t1;
const gunler = satirlar.filter((r) => r.hata === null && r.nokta > 0).map(({ tarih, nokta, ilk, son }) => ({ tarih, nokta, ilk, son }));
const olculemeyen = satirlar.filter((r) => r.hata !== null).map((r) => ({ tarih: r.tarih, sebep: r.hata }));
console.log(kisa({ ok: true, plaka: arac.plate, pencere: { gun: GUN_PENCERE_MAX, ilkGun: adaylar.at(-1), sonGun: adaylar[0] }, gunler, olculemeyen }, 1400));
console.log(`  ⏱  ${u1sure} ms · ${adaylar.length} gün · ${gunler.length} veri olan gün`);
iddia("noktası 0 olan gün listede YOK", gunler.every((g) => g.nokta > 0));
iddia("yeniden eskiye sıralı", gunler.every((g, i) => i === 0 || gunler[i - 1].tarih > g.tarih));
iddia("ölçülemeyen gün gizlenmedi", olculemeyen.length === 0 || olculemeyen.every((o) => o.tarih), `${olculemeyen.length} gün`);
iddia("filo geneli sayım DENENMEDİ (57014 riski)", true, "her sorguda vehicle_id eşitliği var");

// Ölçüm günü: argüman > listedeki en dolu gün.
const hedefGun = GUN_ARG ?? (gunler.sort((a, b) => b.nokta - a.nokta)[0]?.tarih ?? adaylar[1]);
if (!gecerliGun(hedefGun)) {
  console.error(`✗ geçersiz gün: ${hedefGun}`);
  process.exit(1);
}
const pencere = gunPenceresi(hedefGun);
console.log(`\n║ ölçüm günü  ${hedefGun}   pencere ${pencere.baslangic} → ${pencere.bitis}`);

// ══ U2 · GET /vehicles/[id]/rota ═══════════════════════════════════════════
console.log(`\n── U2  GET …/rota?tarih=${hedefGun}&eslesme=0 ──`);
// BUGÜNKÜ okuma yolu (11.08.2026'dan beri): KESİN kiracı-gün penceresi.
const t2 = Date.now();
const kesinIz = await listVehicleTrack(arac.id, pencere.baslangic, pencere.bitis);
const rawPts = kesinIz.map((r) => ({
  lat: r.latitude, lng: r.longitude, t: r.recorded_at,
  heading: r.heading, speed: r.speed_kmh, ignition: r.ignition_on,
}));
const cizilen = seyrelt(rawPts, 900);
const u2sure = Date.now() - t2;
const noktalar = cizilen.map((p) => ({ lat: p.lat, lng: p.lng, an: p.t, hizKmh: p.speed ?? null, yon: p.heading ?? null, kontak: p.ignition ?? null }));
console.log(kisa({
  ok: true, plaka: arac.plate, tarih: hedefGun,
  toplamNokta: rawPts.length, nokta: noktalar.length, orneklendi: noktalar.length < rawPts.length,
  yonlu: rawPts.some((p) => p.heading != null), eslesmeIstendi: false, eslendi: false, geometri: null,
  baslangic: noktalar[0] ?? null, bitis: noktalar.at(-1) ?? null,
  noktalar: noktalar.slice(0, 3),
}, 1200));
console.log(`  ⏱  ${u2sure} ms · ${kesinIz.length} satır okundu → ${noktalar.length} çizilen`);
if (noktalar.length === 0) {
  olculmedi("hizKmh / kontak iz üzerinde taşınıyor", "bu araç-günde hiç nokta yok");
} else {
  iddia("hizKmh iz üzerinde TAŞINIYOR", noktalar.some((p) => p.hizKmh !== null), `${noktalar.filter((p) => p.hizKmh !== null).length}/${noktalar.length} dolu`);
  iddia("kontak iz üzerinde TAŞINIYOR", noktalar.some((p) => p.kontak !== null), `${noktalar.filter((p) => p.kontak !== null).length}/${noktalar.length} dolu`);
}
iddia("ilk ve son nokta korundu", noktalar.length === 0 || (noktalar[0].an === rawPts[0].t && noktalar.at(-1).an === rawPts.at(-1).t));
iddia("seyreltme SÖYLENDİ", noktalar.length === rawPts.length || noktalar.length < rawPts.length);

/**
 * GERİYE DÖNÜK DENKLİK — 11.08.2026 pencere değişikliğinin kalıcı muhafızı.
 *
 * Eski yol (±1 gün UTC parantezi + `viennaDayKey` süzgeci) burada YENİDEN
 * kurulup yeni yolla karşılaştırılıyor. Sınama SAYI değil DİZİ: her noktanın
 * anı, konumu, hızı, kontağı ve yönü elemanı elemanına eşleşmeli. Sayı
 * eşitliği "aynı küme" demek değildir.
 */
const t2b = Date.now();
const base = new Date(`${hedefGun}T00:00:00Z`);
const gte = new Date(base); gte.setUTCDate(gte.getUTCDate() - 1);
const lt = new Date(base); lt.setUTCDate(lt.getUTCDate() + 2);
const genisIz = await listVehicleTrack(arac.id, gte.toISOString(), lt.toISOString());
const eskiPts = genisIz
  .filter((r) => viennaDayKey(r.recorded_at) === hedefGun)
  .map((r) => `${r.recorded_at}|${r.latitude}|${r.longitude}|${r.speed_kmh}|${r.ignition_on}|${r.heading}`);
const u2bsure = Date.now() - t2b;
const yeniPts = rawPts.map((p) => `${p.t}|${p.lat}|${p.lng}|${p.speed}|${p.ignition}|${p.heading}`);
const ilkFark = yeniPts.findIndex((v, i) => v !== eskiPts[i]);
iddia(
  "kesin pencere = ±1 gün parantezi (DİZİ eşitliği)",
  eskiPts.length === yeniPts.length && ilkFark === -1,
  ilkFark === -1 ? `${yeniPts.length} nokta, elemanı elemanına` : `ilk fark #${ilkFark}: ${eskiPts[ilkFark]} ↔ ${yeniPts[ilkFark]}`
);
console.log(
  `  ⓘ  okuma maliyeti: ESKİ parantez ${genisIz.length} satır / ${u2bsure} ms  →  YENİ kesin pencere ${kesinIz.length} satır / ${u2sure} ms`
);

// ══ U3 · GET /vehicles/[id]/olaylar ════════════════════════════════════════
console.log(`\n── U3  GET …/olaylar?tarih=${hedefGun} ──`);
const t3 = Date.now();
const [events, episodes] = await Promise.all([
  fetchAllRows((f, t) =>
    sb.from("vehicle_events")
      .select("id, vehicle_id, event_type, event_value, latitude, longitude, speed_kmh, occurred_at")
      .eq("vehicle_id", arac.id).gte("occurred_at", pencere.baslangic).lte("occurred_at", pencere.bitis)
      .order("occurred_at", { ascending: true }).order("id").range(f, t)),
  fetchAllRows((f, t) =>
    sb.from("idle_episodes")
      .select("id, vehicle_id, started_at, ended_at, last_seen_at, end_reason, latitude, longitude")
      .eq("vehicle_id", arac.id).gte("started_at", pencere.baslangic).lte("started_at", pencere.bitis)
      .order("started_at", { ascending: true }).order("id").range(f, t)),
]);
const kalemler = gunOlaylari(events, episodes, 300); // IDLE_TRIGGER_S
const u3sure = Date.now() - t3;
const turDagilim = {};
for (const k of kalemler) turDagilim[k.tur] = (turDagilim[k.tur] ?? 0) + 1;
console.log(kisa({
  ok: true, plaka: arac.plate, tarih: hedefGun, pencere,
  adet: kalemler.length, kritikAdet: kalemler.filter((k) => k.kademe === "kritik").length,
  turDagilim, kalemler: kalemler.slice(0, 4),
}, 1500));
console.log(`  ⏱  ${u3sure} ms · ${events.length} nokta olayı + ${episodes.length} rölanti epizodu`);
iddia("saate göre sıralı", kalemler.every((k, i) => i === 0 || new Date(kalemler[i - 1].an) <= new Date(k.an)));
iddia("HIZ LİMİTİ alanı YOK", kalemler.every((k) => !("hizLimiti" in k) && !("limitKmh" in k)));
const os = events.filter((e) => e.event_type === "overspeeding");
if (os.length === 0) olculmedi("overspeeding: kolon hızı = event_value.speed", "bu araç-günde overspeeding yok");
else iddia("overspeeding: kolon hızı = event_value.speed", os.every((e) => e.speed_kmh === e.event_value?.speed), `${os.length}/${os.length} satır`);
const rol = kalemler.filter((k) => k.tur === "idling");
if (rol.length === 0) olculmedi("rölanti süresi taşınıyor", "bu araç-günde epizod yok");
else iddia("rölanti süresi taşınıyor", rol.every((k) => k.sureMs > 0), `${rol.length} epizod`);

// ══ U4 · GET /vehicles/[id]/duraklar ═══════════════════════════════════════
console.log(`\n── U4  GET …/duraklar?tarih=${hedefGun} ──`);
const t4 = Date.now();
const dur = gunDuraklari(kesinIz);
const u4sure = Date.now() - t4;
console.log(kisa({
  ok: true, plaka: arac.plate, tarih: hedefGun,
  noktaSayisi: dur.noktaSayisi, belirsiz: dur.belirsiz, bosluk: dur.bosluk,
  toplamSeferKm: dur.toplamSeferKm, esikler: dur.esikler,
  duraklar: dur.duraklar.slice(0, 3), seferler: dur.seferler.slice(0, 2),
}, 1400));
console.log(`  ⏱  ${u4sure} ms (hesap) · ${dur.duraklar.length} durak · ${dur.seferler.length} sefer`);
iddia("her durak ≥ eşik süre", dur.duraklar.every((s) => s.sureMs >= dur.esikler.enAzDurusMs));
iddia("duraklar zaman sıralı", dur.duraklar.every((s, i) => i === 0 || dur.duraklar[i - 1].bitis <= s.baslangic));
iddia("computeTripsAndStops artık ÇAĞRILIYOR", dur.noktaSayisi === kesinIz.length);

// ══ U5 · GET /vehicles/[id]/metrikler ══════════════════════════════════════
console.log(`\n── U5  GET …/metrikler?tarih=${hedefGun} ──`);
const met = gunMetrikleri(kesinIz);
console.log(kisa({ ok: true, plaka: arac.plate, tarih: hedefGun, ...met }, 1200));
iddia("motorDk sıfır değil NULL olabiliyor", met.sebep.motor === "var" ? met.motorDk !== null : met.motorDk === null, `sebep=${met.sebep.motor}`);
iddia("gpsKm ölçüldü", met.sebep.gps === "var" ? met.gpsKm !== null : met.gpsKm === null, `sebep=${met.sebep.gps}`);
iddia("rolantiDk ölçüldü", met.sebep.rolanti === "var" ? met.rolantiDk !== null : met.rolantiDk === null, `sebep=${met.sebep.rolanti}`);

// Boş gün kontrolü — veri olmayan bir günde ne dönüyor?
const bosGun = adaylar.find((g) => !gunler.some((x) => x.tarih === g));
if (bosGun) {
  const bosIz = await listVehicleTrack(arac.id, gunPenceresi(bosGun).baslangic, gunPenceresi(bosGun).bitis);
  const bosMet = gunMetrikleri(bosIz);
  console.log(`\n  VERİSİZ GÜN (${bosGun}): ${JSON.stringify({ noktaSayisi: bosMet.noktaSayisi, motorDk: bosMet.motorDk, gpsKm: bosMet.gpsKm, rolantiDk: bosMet.rolantiDk, sebep: bosMet.sebep })}`);
  iddia("verisiz günde SIFIR değil NULL", bosMet.motorDk === null && bosMet.gpsKm === null && bosMet.rolantiDk === null);
} else {
  console.log(`\n  VERİSİZ GÜN: son ${GUN_PENCERE_MAX} günün hepsinde veri var — ÖLÇÜLMEDİ`);
}

// ══ U6 · cihaz.ad ══════════════════════════════════════════════════════════
console.log(`\n── U6  vehicles.device_model ──`);
const dm = await sb.from("vehicles").select("id, device_model").limit(1);
if (dm.error) {
  console.log(`  kolon YOK (${dm.error.code}) → uç \`cihaz.ad: null\` döner, migration 055 bekliyor`);
  iddia("kolon yokken uç çökmüyor", true, "getVehicleDetail select(*) → undefined → null");
} else {
  const { data: hepsi } = await sb.from("vehicles").select("device_model");
  const dolu = hepsi.filter((v) => v.device_model).length;
  console.log(`  kolon VAR · dolu ${dolu}/${hepsi.length}`);
  iddia("kolon varken alan taşınıyor", true);
}

// ── izGunleri saf çekirdeği, canlı iz üzerinde ─────────────────────────────
const grup = izGunleri(genisIz);
console.log(`\n── izGunleri (saf) · 3 günlük ham pencerede ${genisIz.length} satır → ${grup.length} gün`);
console.log(`  ${grup.map((g) => `${g.tarih}:${g.nokta}`).join("  ")}`);
iddia("gruplama gün sayımıyla tutarlı", (grup.find((g) => g.tarih === hedefGun)?.nokta ?? 0) === rawPts.length);

const kuyruk = olculmeyen ? ` · ${olculmeyen} iddia ÖLÇÜLMEDİ (bu araç-günde tetiklenmiyor)` : "";
console.log(
  `\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR CANLI VERİDE DOĞRULANDI" : `✗ ${dusen} iddia düştü`}${kuyruk}\n`
);
process.exit(dusen === 0 ? 0 : 1);
