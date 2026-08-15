#!/usr/bin/env node
/**
 * DEPO TETİĞİ — GERİYE DÖNÜK SİMÜLASYON. HİÇBİR ŞEY YAZMAZ.
 *
 * Motor CANLIDA çalışıyor (30 günde 308 otomatik vardiya). Asıl soru bu değil:
 * TETİK ATEŞLENDİĞİ HÂLDE vardiya açılmayan araç-günler hangileri ve NEDEN?
 *
 * YÖNTEM: her araç × Viyana günü için ÜRETİM çekirdeği `firstDepotEntryInRange`
 * AYNEN çağrılır (kopya algoritma YOK). Sonra o gün için üretimin sırasıyla
 * uyguladığı kapılar tek tek denenir ve araç-gün bir kovaya düşer.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-depo-geridonuk.mjs [gun]
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
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 12) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ DEPO TETİĞİ · GERİYE DÖNÜK SİMÜLASYON (yazma YOK) ══════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ pencere ${GUN} gün`);

const zones = await activeDepotZones();
console.log(`║ depo    ${zones.length} bölge · ${zones.map((z) => `${z.name.trim()} (r=${z.radius_m}m)`).join(" · ")}`);
if (zones.length === 0) {
  console.log(`🔴 depo bölgesi yok — simülasyon anlamsız.`);
  process.exit(1);
}

const scope = await getTestScope();
const { data: vehData } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled");
const vehicles = dropTestRows((vehData ?? []), (v) => ({ vehicle: v.id }), scope)
  .filter((v) => v.flespi_device_id != null || v.imei != null);

const { data: wData } = await supabaseAdmin
  .from("workers").select("id, name, is_active");
const workersById = new Map((wData ?? []).map((w) => [w.id, w]));

// ── Gün listesi (Viyana) ──────────────────────────────────────────────────
const gunler = [];
for (let d = GUN - 1; d >= 0; d--) {
  const bas = addCalendarDaysVienna(bugunBas, -d);
  gunler.push({ key: viennaDayKey(bas), bas, bit: addCalendarDaysVienna(bas, 1) });
}
const ilkISO = gunler[0].bas.toISOString();
const sonISO = gunler[gunler.length - 1].bit.toISOString();

// ── Gerçek vardiyalar ─────────────────────────────────────────────────────
const { data: entryData } = await fetchAllRows(
  (from, to) =>
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_source, auto_started")
        .gte("started_at", ilkISO)
        .lt("started_at", sonISO)
        .order("started_at", { ascending: true })
        .order("id")
        .range(from, to),
      "worker_id",
      scope.workerIds
    ),
  "geridonuk/time_entries"
);
const entries = entryData ?? [];
/** şoför|gün → vardiya (günde tek vardiya kilidi bu kümeye bakar) */
const soforGun = new Map();
/** araç|gün → vardiya */
const aracGun = new Map();
for (const e of entries) {
  const g = viennaDayKey(e.started_at);
  if (e.worker_id) soforGun.set(`${e.worker_id}|${g}`, e);
  if (e.vehicle_id) aracGun.set(`${e.vehicle_id}|${g}`, e);
}

// ── Onaylı izinler ────────────────────────────────────────────────────────
const izinliGun = new Set();
{
  const { data, error } = await supabaseAdmin
    .from("worker_leaves")
    .select("worker_id, start_date, end_date, status")
    .eq("status", "approved");
  if (error) {
    console.log(`║ izin    worker_leaves okunamadı (${error.code ?? ""}) → izin kapısı ÖLÇÜLMEDİ`);
  } else {
    for (const l of data ?? []) {
      for (const g of gunler) {
        if (g.key >= l.start_date && g.key <= l.end_date) izinliGun.add(`${l.worker_id}|${g.key}`);
      }
    }
    console.log(`║ izin    ${(data ?? []).length} onaylı izin · ${izinliGun.size} şoför-gün kapsanıyor`);
  }
}

// ══ SİMÜLASYON ═══════════════════════════════════════════════════════════
console.log(`\n── ARAÇ × GÜN TARAMASI (üretim çekirdeği firstDepotEntryInRange) ──`);
console.log(`   ${vehicles.length} araç × ${gunler.length} gün = ${vehicles.length * gunler.length} araç-gün...`);

const isler = [];
for (const v of vehicles) for (const g of gunler) isler.push({ v, g });

const t0 = Date.now();
const sonuc = await mapBounded(isler, async ({ v, g }) => {
  const tetik = await firstDepotEntryInRange(
    v.id,
    g.bas.toISOString(),
    g.bit.toISOString(),
    zones
  );
  return { v, g, tetik };
});
console.log(`   tarama ${Math.round((Date.now() - t0) / 1000)} sn`);

// ── Kovalama ──────────────────────────────────────────────────────────────
const kova = {
  A_motor_calismis: [],
  B_insan_once: [],
  C_kacan: [],
  D_tetiksiz_vardiya: [],
  E_bos: [],
};
/** C kovasının sebep kırılımı */
const cSebep = new Map();
const cKayit = [];

for (const { v, g, tetik } of sonuc) {
  const vardiyaArac = aracGun.get(`${v.id}|${g.key}`) ?? null;
  if (!tetik) {
    if (vardiyaArac) kova.D_tetiksiz_vardiya.push({ v, g, vardiyaArac });
    else kova.E_bos.push({ v, g });
    continue;
  }
  // Tetik ateşlendi. Üretim kapıları sırayla:
  const sebepler = [];
  if (!v.assigned_worker_id) sebepler.push("araca şoför atanmamış");
  if (v.status !== "active") sebepler.push(`status=${v.status}`);
  if (v.auto_start_enabled === false) sebepler.push("auto_start_enabled=false");
  const w = v.assigned_worker_id ? workersById.get(v.assigned_worker_id) : null;
  if (v.assigned_worker_id && !w) sebepler.push("şoför kaydı yok");
  if (w && w.is_active !== true) sebepler.push("şoför pasif (is_active=false)");
  if (v.assigned_worker_id && izinliGun.has(`${v.assigned_worker_id}|${g.key}`)) {
    sebepler.push("şoför İZİNLİ");
  }
  const soforVardiya = v.assigned_worker_id
    ? soforGun.get(`${v.assigned_worker_id}|${g.key}`) ?? null
    : null;

  if (soforVardiya) {
    // Vardiya var — motor mu açtı, insan mı?
    if (soforVardiya.auto_started === true || soforVardiya.start_source === "auto") {
      kova.A_motor_calismis.push({ v, g, tetik, e: soforVardiya });
    } else {
      kova.B_insan_once.push({ v, g, tetik, e: soforVardiya });
    }
    continue;
  }
  // Vardiya YOK → kaçan. Sebep var mı?
  const sebep = sebepler.length ? sebepler.join(" + ") : "SEBEP YOK (motor açmalıydı)";
  cSebep.set(sebep, (cSebep.get(sebep) ?? 0) + 1);
  cKayit.push({ v, g, tetik, sebep });
  kova.C_kacan.push({ v, g, tetik, sebep });
}

const T = sonuc.length;
console.log(`\n── SONUÇ (${T} araç-gün) ──`);
const yaz = (etiket, arr) =>
  console.log(`  ${ad(etiket, 34)} ${n(arr.length, 6)}  %${((arr.length / T) * 100).toFixed(1)}`);
yaz("A · tetik VAR, motor AÇMIŞ", kova.A_motor_calismis);
yaz("B · tetik VAR, insan önce açmış", kova.B_insan_once);
yaz("C · tetik VAR, vardiya YOK (kaçan)", kova.C_kacan);
yaz("D · tetik YOK ama vardiya var", kova.D_tetiksiz_vardiya);
yaz("E · tetik YOK, vardiya YOK", kova.E_bos);

console.log(`\n── C KOVASI: TETİK ATEŞLENDİ AMA VARDİYA AÇILMADI ──`);
for (const [s, c] of [...cSebep].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n(c, 5)} × ${s}`);
}
console.log(`\n  araç kırılımı (ilk 15):`);
const cArac = new Map();
for (const r of cKayit) cArac.set(r.v.plate, (cArac.get(r.v.plate) ?? 0) + 1);
for (const [p, c] of [...cArac].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`     ${ad(p)} ${n(c, 4)} gün`);
}
console.log(`\n  "SEBEP YOK" örnekleri (motor açmalıydı — ilk 15):`);
const acikKacan = cKayit.filter((r) => r.sebep.startsWith("SEBEP YOK"));
for (const r of acikKacan.slice(0, 15)) {
  console.log(`     ${r.g.key}  ${ad(r.v.plate)} tetik ${r.tetik}  şoför ${ad(workersById.get(r.v.assigned_worker_id)?.name ?? "?", 18)}`);
}
console.log(`  → toplam ${acikKacan.length} araç-gün`);

console.log(`\n── D KOVASI: TETİK YOK AMA VARDİYA VAR (depoya uğramadan) ──`);
{
  const dArac = new Map();
  const dKaynak = new Map();
  for (const r of kova.D_tetiksiz_vardiya) {
    dArac.set(r.v.plate, (dArac.get(r.v.plate) ?? 0) + 1);
    const k = r.vardiyaArac.auto_started === true ? "auto" : (r.vardiyaArac.start_source ?? "self");
    dKaynak.set(k, (dKaynak.get(k) ?? 0) + 1);
  }
  console.log(`  kaynak: ${[...dKaynak].map(([k, c]) => `${k}×${c}`).join(" · ")}`);
  console.log(`  araç (ilk 10): ${[...dArac].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, c]) => `${p}(${c})`).join(" · ")}`);
}

// ══ SAHİPSİZ OLAY ETKİSİ ═════════════════════════════════════════════════
console.log(`\n── SAHİPSİZ OLAY: C KOVASI KAPANSA NE OLURDU ──`);
{
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

  // Mevcut vardiya pencereleri (gerçek)
  const pencere = new Map();
  const ekle = (vid, aMs, bMs) => {
    const arr = pencere.get(vid) ?? [];
    arr.push([aMs, bMs]);
    pencere.set(vid, arr);
  };
  const sonMs = Date.parse(sonISO);
  for (const e of entries) {
    if (!e.vehicle_id || !e.worker_id) continue;
    ekle(e.vehicle_id, Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : sonMs);
  }
  const icinde = (harita, vid, t) => (harita.get(vid) ?? []).some(([a, b]) => t >= a && t <= b);

  let sahipsiz = 0;
  const sahipsizler = [];
  for (const o of olaylar) {
    const t = Date.parse(o.at);
    if (!icinde(pencere, o.v, t)) {
      sahipsiz++;
      sahipsizler.push(o);
    }
  }
  console.log(`  toplam skorlanabilir olay : ${n(olaylar.length, 7)}`);
  console.log(`  ŞU AN sahipsiz            : ${n(sahipsiz, 7)}  %${((sahipsiz / olaylar.length) * 100).toFixed(1)}`);

  /**
   * C kovasındaki her araç-gün için VARSAYIMSAL pencere: tetik anından o
   * Viyana gününün SONUNA kadar.
   * ⚠️ VARSAYIM ve üst sınırdır: gerçekte vardiyayı personel kapatır ve
   * kapanış gün sonundan ÖNCE olur. "En fazla ne kadar düşerdi" sorusunun
   * cevabıdır, "ne kadar düşer"in değil.
   */
  const varsayimsal = new Map();
  for (const r of kova.C_kacan) {
    const arr = varsayimsal.get(r.v.id) ?? [];
    arr.push([Date.parse(r.tetik), r.g.bit.getTime()]);
    varsayimsal.set(r.v.id, arr);
  }
  let kurtulan = 0;
  for (const o of sahipsizler) {
    if (icinde(varsayimsal, o.v, Date.parse(o.at))) kurtulan++;
  }
  console.log(`  C kovası kapansa kurtulan : ${n(kurtulan, 7)}  → sahipsiz ${sahipsiz} → ${sahipsiz - kurtulan}  (%${(((sahipsiz - kurtulan) / olaylar.length) * 100).toFixed(1)})`);
  console.log(`  ⚠️ ÜST SINIR: vardiya gün sonuna kadar açık varsayıldı (gerçekte personel daha erken kapatır).`);

  // Yalnız "SEBEP YOK" olanlar kapansa
  const varsayimsal2 = new Map();
  for (const r of acikKacan) {
    const arr = varsayimsal2.get(r.v.id) ?? [];
    arr.push([Date.parse(r.tetik), r.g.bit.getTime()]);
    varsayimsal2.set(r.v.id, arr);
  }
  let kurtulan2 = 0;
  for (const o of sahipsizler) if (icinde(varsayimsal2, o.v, Date.parse(o.at))) kurtulan2++;
  console.log(`  yalnız "SEBEP YOK" kapansa: ${n(kurtulan2, 7)}  → sahipsiz ${sahipsiz - kurtulan2}`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
