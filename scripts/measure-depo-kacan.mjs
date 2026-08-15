#!/usr/bin/env node
/**
 * "TETİK VAR, VARDİYA YOK" — KAÇANLARIN ZAMAN VE SEBEP KIRILIMI. YAZMAZ.
 *
 * Geriye dönük simülasyon 53 araç-günde "sebep yok" dedi. Ama simülasyon
 * BUGÜNÜN KODUYLA geçmişi tarıyor; o gün çalışan kod farklı olabilir. İki
 * bilinen kırılma noktası var:
 *   • depo geofence'lerinin oluşturulduğu an (öncesinde tetik YOKTU)
 *   • teğet-geçme körlüğü düzeltmesi (60eb390, 27.07.2026)
 * Ayrıca simülasyonun ölçmediği bir üretim kapısı var: şoförün ÖNCEKİ GÜNDEN
 * AÇIK KALMIŞ vardiyası (openByWorker) — o varsa motor yeni vardiya açmaz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-depo-kacan.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { activeDepotZones, firstDepotEntryInRange } from "@/lib/depot";
import { getTestScope, dropTestRows, withoutTestRows } from "@/lib/test-data";
import { mapBounded } from "@/lib/db-fanout";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const GUN = Number(process.argv[2] ?? 30);
const bugunBas = startOfDayVienna();
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 12) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ KAÇAN OTOMATİK VARDİYALAR · KIRILIM (yazma YOK) ════════════════`);

const zones = await activeDepotZones();
const scope = await getTestScope();
const { data: vehData } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled");
const vehicles = dropTestRows((vehData ?? []), (v) => ({ vehicle: v.id }), scope)
  .filter((v) => v.flespi_device_id != null || v.imei != null);
const { data: wData } = await supabaseAdmin.from("workers").select("id, name, is_active");
const workersById = new Map((wData ?? []).map((w) => [w.id, w]));

// ── DEPO BÖLGELERİ NE ZAMAN OLUŞTU ────────────────────────────────────────
console.log(`\n── DEPO BÖLGELERİNİN OLUŞTURULMA ANI ──`);
{
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .select("name, purpose, active, radius_m, created_at")
    .eq("purpose", "depot");
  if (error) console.log(`  created_at okunamadı: ${error.message}`);
  for (const g of data ?? []) {
    console.log(`  ${ad(g.name.trim(), 30)} r=${g.radius_m}m  active=${g.active}  created_at=${g.created_at ?? "(kolon yok)"}`);
  }
}

const gunler = [];
for (let d = GUN - 1; d >= 0; d--) {
  const bas = addCalendarDaysVienna(bugunBas, -d);
  gunler.push({ key: viennaDayKey(bas), bas, bit: addCalendarDaysVienna(bas, 1) });
}
const ilkISO = gunler[0].bas.toISOString();
const sonISO = gunler[gunler.length - 1].bit.toISOString();

// ── VARDİYALAR (açık kalanlar dahil, pencereden ÖNCE başlayanlar da) ──────
const { data: entryData } = await fetchAllRows(
  (from, to) =>
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, plate, started_at, ended_at, start_source, auto_started")
        .lt("started_at", sonISO)
        .or(`ended_at.is.null,ended_at.gte.${ilkISO}`)
        .order("started_at", { ascending: true })
        .order("id")
        .range(from, to),
      "worker_id",
      scope.workerIds
    ),
  "kacan/time_entries"
);
const entries = entryData ?? [];
const soforGun = new Map();
for (const e of entries) {
  if (e.worker_id) soforGun.set(`${e.worker_id}|${viennaDayKey(e.started_at)}`, e);
}
/** şoför → [başlangıç, bitiş] pencereleri (AÇIK vardiya tespiti için) */
const soforPencere = new Map();
for (const e of entries) {
  if (!e.worker_id) continue;
  const arr = soforPencere.get(e.worker_id) ?? [];
  arr.push([Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : Infinity]);
  soforPencere.set(e.worker_id, arr);
}
const acikVardiyaVarMi = (wid, tMs) =>
  (soforPencere.get(wid) ?? []).some(([a, b]) => a < tMs && tMs <= b);

const izinliGun = new Set();
{
  const { data } = await supabaseAdmin
    .from("worker_leaves").select("worker_id, start_date, end_date, status").eq("status", "approved");
  for (const l of data ?? []) {
    for (const g of gunler) if (g.key >= l.start_date && g.key <= l.end_date) izinliGun.add(`${l.worker_id}|${g.key}`);
  }
}

// ── TARAMA ────────────────────────────────────────────────────────────────
const isler = [];
for (const v of vehicles) for (const g of gunler) isler.push({ v, g });
const sonuc = await mapBounded(isler, async ({ v, g }) => ({
  v, g,
  tetik: await firstDepotEntryInRange(v.id, g.bas.toISOString(), g.bit.toISOString(), zones),
}));

const kacan = [];
for (const { v, g, tetik } of sonuc) {
  if (!tetik) continue;
  const w = v.assigned_worker_id ? workersById.get(v.assigned_worker_id) : null;
  if (!v.assigned_worker_id) { kacan.push({ v, g, tetik, sebep: "araca şoför atanmamış" }); continue; }
  if (v.status !== "active") { kacan.push({ v, g, tetik, sebep: `status=${v.status}` }); continue; }
  if (v.auto_start_enabled === false) { kacan.push({ v, g, tetik, sebep: "auto_start_enabled=false" }); continue; }
  if (!w || w.is_active !== true) { kacan.push({ v, g, tetik, sebep: "şoför pasif" }); continue; }
  if (izinliGun.has(`${v.assigned_worker_id}|${g.key}`)) { kacan.push({ v, g, tetik, sebep: "şoför İZİNLİ" }); continue; }
  if (soforGun.get(`${v.assigned_worker_id}|${g.key}`)) continue; // vardiya var
  // ÜRETİMİN SİMÜLASYONDA ATLANAN KAPISI: önceki günden AÇIK vardiya
  if (acikVardiyaVarMi(v.assigned_worker_id, Date.parse(tetik))) {
    kacan.push({ v, g, tetik, sebep: "şoförün ÖNCEKİ GÜNDEN AÇIK vardiyası var" });
    continue;
  }
  kacan.push({ v, g, tetik, sebep: "SEBEP YOK" });
}

console.log(`\n── SEBEP DAĞILIMI (${kacan.length} kaçan araç-gün) ──`);
const sebepSayim = new Map();
for (const k of kacan) sebepSayim.set(k.sebep, (sebepSayim.get(k.sebep) ?? 0) + 1);
for (const [s, c] of [...sebepSayim].sort((a, b) => b[1] - a[1])) console.log(`  ${n(c, 5)} × ${s}`);

console.log(`\n── "SEBEP YOK" GÜN GÜN (kod o gün farklıydı olabilir) ──`);
const acik = kacan.filter((k) => k.sebep === "SEBEP YOK");
const gunSayim = new Map();
for (const k of acik) gunSayim.set(k.g.key, (gunSayim.get(k.g.key) ?? 0) + 1);
console.log(`  ${ad("gün")} ${n("kaçan", 6)}`);
for (const g of gunler) {
  const c = gunSayim.get(g.key) ?? 0;
  console.log(`  ${ad(g.key)} ${n(c, 6)} ${"█".repeat(c)}`);
}
{
  const oncesi = acik.filter((k) => k.g.key < "2026-07-28").length;
  const sonrasi = acik.length - oncesi;
  console.log(`\n  27.07 ve öncesi (teğet düzeltmesinden ÖNCE): ${oncesi}`);
  console.log(`  28.07 ve sonrası (bugünkü kodla)           : ${sonrasi}`);
}

console.log(`\n── 28.07 SONRASI "SEBEP YOK" — TAM LİSTE ──`);
const yeni = acik.filter((k) => k.g.key >= "2026-07-28").sort((a, b) => a.g.key.localeCompare(b.g.key));
if (yeni.length === 0) console.log(`  (yok)`);
for (const k of yeni) {
  console.log(`  ${k.g.key}  ${ad(k.v.plate)} tetik ${k.tetik}  şoför ${ad(workersById.get(k.v.assigned_worker_id)?.name ?? "?", 18)}`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
