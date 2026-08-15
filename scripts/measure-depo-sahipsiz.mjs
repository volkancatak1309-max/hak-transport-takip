#!/usr/bin/env node
/**
 * SAHİPSİZ OLAYLARIN KAYNAĞI — DEPO TETİĞİ BUNLARI KURTARABİLİR Mİ? YAZMAZ.
 *
 * 1.897 sahipsiz olay var (skor ekseni turu). Otomatik başlatma zaten canlıda
 * çalışıyor. O hâlde soru şu: bu olaylar HANGİ araç-günlerde oluştu ve o
 * günlerde depo tetiği ateşlendi mi?
 *
 *   • tetik ATEŞLENDİ + vardiya yok  → otomatik başlatma KURTARABİLİR
 *   • tetik ateşlenmedi              → araç depoya hiç uğramamış; depo tetiği
 *                                      bu olayları ASLA kurtaramaz
 *   • vardiya VAR ama olay dışarıda  → vardiya penceresi dar (erken kapanmış /
 *                                      geç açılmış) — BAŞKA bir sorun
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-depo-sahipsiz.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { activeDepotZones, firstDepotEntryInRange } from "@/lib/depot";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { getTestScope, dropTestRows, withoutTestRows } from "@/lib/test-data";
import { mapBounded } from "@/lib/db-fanout";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const GUN = Number(process.argv[2] ?? 30);
const bugunBas = startOfDayVienna();
const n = (x, w = 7) => String(x).padStart(w);
const ad = (s, w = 12) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ SAHİPSİZ OLAY · KAYNAK ANALİZİ (yazma YOK) ════════════════════`);
console.log(`║ an ${new Date().toISOString()} · ${GUN} gün`);

const zones = await activeDepotZones();
const scope = await getTestScope();
const { data: vehData } = await supabaseAdmin
  .from("vehicles").select("id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled");
const vehicles = dropTestRows((vehData ?? []), (v) => ({ vehicle: v.id }), scope)
  .filter((v) => v.flespi_device_id != null || v.imei != null);
const vehById = new Map(vehicles.map((v) => [v.id, v]));

const gunler = [];
for (let d = GUN - 1; d >= 0; d--) {
  const bas = addCalendarDaysVienna(bugunBas, -d);
  gunler.push({ key: viennaDayKey(bas), bas, bit: addCalendarDaysVienna(bas, 1) });
}
const ilkISO = gunler[0].bas.toISOString();
const sonISO = gunler[gunler.length - 1].bit.toISOString();

// ── Vardiya pencereleri (gerçek) ──────────────────────────────────────────
const { data: entryData } = await fetchAllRows(
  (from, to) =>
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, started_at, ended_at")
        .lt("started_at", sonISO)
        .or(`ended_at.is.null,ended_at.gte.${ilkISO}`)
        .order("started_at", { ascending: true }).order("id").range(from, to),
      "worker_id", scope.workerIds
    ),
  "sahipsiz/time_entries"
);
const entries = entryData ?? [];
const sonMs = Date.parse(sonISO);
const pencere = new Map();
for (const e of entries) {
  if (!e.vehicle_id || !e.worker_id) continue;
  const arr = pencere.get(e.vehicle_id) ?? [];
  arr.push([Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : sonMs]);
  pencere.set(e.vehicle_id, arr);
}
const vardiyaIcinde = (vid, t) => (pencere.get(vid) ?? []).some(([a, b]) => t >= a && t <= b);
/** araç|gün → o gün o araçta vardiya var mı */
const aracGunVardiya = new Set();
for (const e of entries) {
  if (e.vehicle_id) aracGunVardiya.add(`${e.vehicle_id}|${viennaDayKey(e.started_at)}`);
}

// ── Tetik haritası (üretim çekirdeği) ─────────────────────────────────────
console.log(`║ tarama ${vehicles.length} araç × ${gunler.length} gün...`);
const isler = [];
for (const v of vehicles) for (const g of gunler) isler.push({ v, g });
const tetikSonuc = await mapBounded(isler, async ({ v, g }) => ({
  key: `${v.id}|${g.key}`,
  tetik: await firstDepotEntryInRange(v.id, g.bas.toISOString(), g.bit.toISOString(), zones),
}));
const tetikMap = new Map(tetikSonuc.map((r) => [r.key, r.tetik]));

// ── Olaylar ───────────────────────────────────────────────────────────────
const [events, idle] = await Promise.all([
  listEventsInRange(ilkISO, sonISO),
  listIdleEpisodesInRange(ilkISO, sonISO),
]);
const olaylar = [];
for (const e of events) {
  if (SAFETY_SCORE_WEIGHTS[e.event_type] === undefined) continue;
  olaylar.push({ v: e.vehicle_id, at: e.occurred_at });
}
for (const ep of idle) olaylar.push({ v: ep.vehicle_id, at: ep.started_at });

// ── Sınıflandırma ─────────────────────────────────────────────────────────
const kova = {
  vardiyada: 0,
  sahipsiz_tetikVar_vardiyaYok: 0,
  sahipsiz_tetikVar_vardiyaVar: 0,
  sahipsiz_tetikYok_vardiyaVar: 0,
  sahipsiz_tetikYok_vardiyaYok: 0,
};
const detay = new Map();
for (const o of olaylar) {
  const t = Date.parse(o.at);
  if (vardiyaIcinde(o.v, t)) { kova.vardiyada++; continue; }
  const g = viennaDayKey(o.at);
  const tetik = tetikMap.get(`${o.v}|${g}`) ?? null;
  const gunVardiya = aracGunVardiya.has(`${o.v}|${g}`);
  let k;
  if (tetik && !gunVardiya) k = "sahipsiz_tetikVar_vardiyaYok";
  else if (tetik && gunVardiya) k = "sahipsiz_tetikVar_vardiyaVar";
  else if (!tetik && gunVardiya) k = "sahipsiz_tetikYok_vardiyaVar";
  else k = "sahipsiz_tetikYok_vardiyaYok";
  kova[k]++;
  const dk = `${k}|${vehById.get(o.v)?.plate ?? "?"}`;
  detay.set(dk, (detay.get(dk) ?? 0) + 1);
}

const T = olaylar.length;
const sahipsiz = T - kova.vardiyada;
const p = (x) => `%${((x / T) * 100).toFixed(1)}`;
console.log(`\n── OLAYLARIN KADERİ (${T} skorlanabilir olay) ──`);
console.log(`  bir vardiya penceresinde              ${n(kova.vardiyada)} ${p(kova.vardiyada)}`);
console.log(`  SAHİPSİZ                              ${n(sahipsiz)} ${p(sahipsiz)}`);
console.log(`\n── SAHİPSİZLERİN KIRILIMI (${sahipsiz}) ──`);
const q = (x) => `%${((x / Math.max(1, sahipsiz)) * 100).toFixed(1)}`;
console.log(`  ① tetik VAR · o gün araçta vardiya YOK  ${n(kova.sahipsiz_tetikVar_vardiyaYok)} ${q(kova.sahipsiz_tetikVar_vardiyaYok)}  ← otomatik başlatma KURTARABİLİR`);
console.log(`  ② tetik VAR · vardiya var, olay dışında ${n(kova.sahipsiz_tetikVar_vardiyaVar)} ${q(kova.sahipsiz_tetikVar_vardiyaVar)}  ← pencere dar (başka sorun)`);
console.log(`  ③ tetik YOK · vardiya var, olay dışında ${n(kova.sahipsiz_tetikYok_vardiyaVar)} ${q(kova.sahipsiz_tetikYok_vardiyaVar)}  ← pencere dar (başka sorun)`);
console.log(`  ④ tetik YOK · o gün araçta vardiya YOK  ${n(kova.sahipsiz_tetikYok_vardiyaYok)} ${q(kova.sahipsiz_tetikYok_vardiyaYok)}  ← araç depoya HİÇ uğramamış`);

console.log(`\n── ① KOVASI ARAÇ KIRILIMI (otomatik başlatmanın kurtarabileceği) ──`);
for (const [k, c] of [...detay].filter(([k]) => k.startsWith("sahipsiz_tetikVar_vardiyaYok")).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${ad(k.split("|")[1])} ${n(c, 5)}`);
}
console.log(`\n── ④ KOVASI ARAÇ KIRILIMI (depo tetiği ASLA kurtaramaz) ──`);
for (const [k, c] of [...detay].filter(([k]) => k.startsWith("sahipsiz_tetikYok_vardiyaYok")).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${ad(k.split("|")[1])} ${n(c, 5)}`);
}
console.log(`\n── ②+③ KOVASI (vardiya var ama olay penceresi dışında) ──`);
for (const [k, c] of [...detay].filter(([k]) => k.startsWith("sahipsiz_tetikVar_vardiyaVar") || k.startsWith("sahipsiz_tetikYok_vardiyaVar")).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${ad(k.split("|")[1])} ${n(c, 5)}  (${k.split("|")[0].includes("tetikVar") ? "tetik var" : "tetik yok"})`);
}

// ── ①'in tarih dağılımı (depo bölgeleri 24.07'de kuruldu) ────────────────
console.log(`\n── ① KOVASI TARİH DAĞILIMI (depo bölgeleri 24.07.2026'da kuruldu) ──`);
{
  const g1 = new Map();
  for (const o of olaylar) {
    const t = Date.parse(o.at);
    if (vardiyaIcinde(o.v, t)) continue;
    const g = viennaDayKey(o.at);
    if (tetikMap.get(`${o.v}|${g}`) && !aracGunVardiya.has(`${o.v}|${g}`)) {
      g1.set(g, (g1.get(g) ?? 0) + 1);
    }
  }
  let once = 0, sonra = 0;
  for (const [g, c] of g1) {
    if (g < "2026-07-24") once += c;
    else sonra += c;
  }
  for (const g of gunler) {
    const c = g1.get(g.key) ?? 0;
    if (c) console.log(`  ${ad(g.key)} ${n(c, 5)} ${"█".repeat(Math.min(40, Math.round(c / 5)))}`);
  }
  console.log(`\n  24.07 ÖNCESİ (depo bölgesi henüz YOKTU): ${once}`);
  console.log(`  24.07 SONRASI (bölgeler canlıyken)     : ${sonra}  ← gerçek kayıp`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
