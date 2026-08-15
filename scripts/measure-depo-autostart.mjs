#!/usr/bin/env node
/**
 * DEPO-TETİKLİ OTOMATİK VARDİYA — DURUM ÖLÇÜMÜ. HİÇBİR ŞEY YAZMAZ.
 *
 * Soru: motor (lib/auto-shift.ts + lib/depot.ts) ZATEN var — neden vardiya
 * açmıyor? Altı ayrı kapı var ve her biri tek başına motoru susturur. Bu betik
 * hepsini CANLI veriyle tek tek ölçer; hiçbir cevap tahmin değildir.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-depo-autostart.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { activeDepotZones } from "@/lib/depot";
import {
  SHIFT_START_TRIGGER,
  SHIFT_AUTO_END,
  DRIVER_PANEL_ENABLED,
} from "@/lib/tenant";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const GUN = Number(process.argv[2] ?? 30);
const start = addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1));
const startISO = start.toISOString();

const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 14) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ DEPO OTOMATİK VARDİYA · DURUM ÖLÇÜMÜ (yazma YOK) ═══════════════`);
console.log(`║ an      ${new Date().toISOString()}`);
console.log(`║ pencere ${GUN} gün · ${viennaDayKey(start)} → ${viennaDayKey(new Date())}`);

// ══ KAPI 1: MÜŞTERİ AYARI ════════════════════════════════════════════════
console.log(`\n── KAPI 1: MÜŞTERİ AYARI (lib/tenant.ts) ──`);
console.log(`  SHIFT_START_TRIGGER   = ${SHIFT_START_TRIGGER}   ${SHIFT_START_TRIGGER === "off" ? "🔴 OTOMATİK BAŞLATMA KAPALI" : "✓ açık"}`);
console.log(`  SHIFT_AUTO_END        = ${SHIFT_AUTO_END}   ${SHIFT_AUTO_END === "off" ? "✓ kapanış MANUEL (dokunulmayacak)" : "⚠ kapanış otomatik"}`);
console.log(`  DRIVER_PANEL_ENABLED  = ${DRIVER_PANEL_ENABLED}`);
console.log(`  ⚠️ Bu değerler BU MAKİNEDEKİ .env.local'den okundu. Üretimdeki`);
console.log(`     (Vercel) değer FARKLI olabilir — aşağıdaki KAPI 6 canlı DB'den`);
console.log(`     motorun gerçekten çalışıp çalışmadığını ölçer.`);

// ══ KAPI 2: DEPO BÖLGELERİ ═══════════════════════════════════════════════
console.log(`\n── KAPI 2: DEPO BÖLGELERİ (geofences purpose='depot' active) ──`);
const { data: tumGeo, error: geoErr } = await supabaseAdmin
  .from("geofences")
  .select("id, name, center_lat, center_lng, radius_m, active, purpose");
if (geoErr) {
  console.log(`  🔴 geofences okunamadı: ${geoErr.message}`);
}
const geo = tumGeo ?? [];
console.log(`  toplam geofence: ${geo.length}`);
const purposeSayim = new Map();
for (const g of geo) {
  const k = `${g.purpose ?? "(null)"}${g.active ? "" : " [PASİF]"}`;
  purposeSayim.set(k, (purposeSayim.get(k) ?? 0) + 1);
}
for (const [k, v] of purposeSayim) console.log(`     ${ad(k, 22)} ${v}`);

const zones = await activeDepotZones();
console.log(`\n  activeDepotZones() → ${zones.length} bölge ${zones.length === 0 ? "🔴 MOTOR SUSAR (depo yok)" : "✓"}`);
for (const z of zones) {
  console.log(`     ${ad(z.name, 22)} ${z.center_lat.toFixed(5)}, ${z.center_lng.toFixed(5)}  r=${z.radius_m} m`);
}
// İki bölge birbirine ne kadar yakın (çakışma kontrolü)
if (zones.length === 2) {
  const [a, b] = zones;
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dp = toRad(b.center_lat - a.center_lat), dl = toRad(b.center_lng - a.center_lng);
  const s = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a.center_lat)) * Math.cos(toRad(b.center_lat)) * Math.sin(dl / 2) ** 2;
  const d = Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
  console.log(`     iki bölge arası: ${d} m  (yarıçap toplamı ${a.radius_m + b.radius_m} m → ${d < a.radius_m + b.radius_m ? "ÇAKIŞIYOR" : "ayrık"})`);
}

// ══ KAPI 3: ŞEMA — start_source ve worker_id ═════════════════════════════
console.log(`\n── KAPI 3: ŞEMA (037 uygulandı mı · worker_id zorunlu mu) ──`);
{
  const { error: ssErr } = await supabaseAdmin
    .from("time_entries").select("start_source").limit(1);
  console.log(`  start_source kolonu : ${ssErr ? `🔴 YOK (${ssErr.code ?? ""} ${ssErr.message})` : "✓ VAR (037 uygulanmış)"}`);
  const { error: sbErr } = await supabaseAdmin
    .from("time_entries").select("started_by").limit(1);
  console.log(`  started_by kolonu   : ${sbErr ? `🔴 YOK` : "✓ VAR"}`);
  const { error: asErr } = await supabaseAdmin
    .from("vehicles").select("auto_start_enabled").limit(1);
  console.log(`  vehicles.auto_start_enabled : ${asErr ? `🔴 YOK (036 uygulanmamış)` : "✓ VAR (036 uygulanmış)"}`);

  // worker_id NOT NULL mı — YAZMADAN ölç: null worker_id'li satır sayısı +
  // şemadaki tanım (001_initial.sql: `worker_id uuid not null`).
  const { count: nullW } = await supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .is("worker_id", null);
  console.log(`  worker_id NULL olan vardiya sayısı: ${nullW ?? 0}   (001_initial.sql: "worker_id uuid NOT NULL")`);
}

// ══ KAPI 4: ARAÇ / ŞOFÖR EŞLEŞMESİ ═══════════════════════════════════════
console.log(`\n── KAPI 4: ARAÇ TARAMASI (motorun ucuz guard'ları) ──`);
const scope = await getTestScope();
const { data: vehData } = await supabaseAdmin
  .from("vehicles")
  .select("id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled");
const vehicles = dropTestRows((vehData ?? []), (v) => ({ vehicle: v.id }), scope);
const cihazli = vehicles.filter((v) => v.flespi_device_id != null || v.imei != null);
const atanmis = cihazli.filter((v) => v.assigned_worker_id);
const aktif = atanmis.filter((v) => v.status === "active");
const autoAcik = aktif.filter((v) => v.auto_start_enabled !== false);
console.log(`  toplam araç (test hariç)          ${n(vehicles.length)}`);
console.log(`  cihazlı (flespi_device_id/imei)   ${n(cihazli.length)}   ← motorun taradığı küme`);
console.log(`  + atanmış şoförü VAR              ${n(atanmis.length)}`);
console.log(`  + status='active'                 ${n(aktif.length)}`);
console.log(`  + auto_start_enabled ≠ false      ${n(autoAcik.length)}   ← auto-start ADAYI`);
const soforsuz = cihazli.filter((v) => !v.assigned_worker_id);
if (soforsuz.length) {
  console.log(`\n  🔴 ŞOFÖRSÜZ ARAÇ (${soforsuz.length}) — bunlara vardiya AÇILAMAZ (worker_id NOT NULL):`);
  for (const v of soforsuz) console.log(`     ${ad(v.plate, 12)} status=${v.status}`);
}
const autoKapali = aktif.filter((v) => v.auto_start_enabled === false);
if (autoKapali.length) {
  console.log(`\n  auto_start_enabled=false olan araçlar (${autoKapali.length}):`);
  for (const v of autoKapali) console.log(`     ${ad(v.plate, 12)}`);
}

// ══ KAPI 5: TELEMETRİ SIKLIĞI ════════════════════════════════════════════
console.log(`\n── KAPI 5: TELEMETRİ SIKLIĞI ("3 dk boyunca sinyal" ne demek) ──`);
console.log(`  Ölçüm: son 7 gün, araç başına ardışık fix aralıkları (KONTAK AÇIKKEN).`);
{
  const yediGun = addCalendarDaysVienna(startOfDayVienna(), -6).toISOString();
  const satirlar = [];
  for (const v of cihazli) {
    const { data } = await fetchAllRows(
      (from, to) =>
        supabaseAdmin
          .from("device_telemetry")
          .select("recorded_at, ignition_on")
          .eq("vehicle_id", v.id)
          .eq("ignition_on", true)
          .gte("recorded_at", yediGun)
          .order("recorded_at", { ascending: true })
          .order("id")
          .range(from, to),
      `depo/telemetri/${v.plate}`
    );
    const rows = data ?? [];
    if (rows.length < 2) {
      satirlar.push({ plate: v.plate, fix: rows.length, medyan: null, p90: null, uc3dk: null });
      continue;
    }
    const gaps = [];
    for (let i = 1; i < rows.length; i++) {
      const g = (Date.parse(rows[i].recorded_at) - Date.parse(rows[i - 1].recorded_at)) / 1000;
      if (g > 0 && g < 3600) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const medyan = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const p90 = gaps.length ? gaps[Math.floor(gaps.length * 0.9)] : null;
    // 3 dakikalık pencerede kaç fix beklenir (medyan aralıktan)
    const uc3dk = medyan ? Math.round(180 / medyan) : null;
    satirlar.push({ plate: v.plate, fix: rows.length, medyan, p90, uc3dk });
  }
  satirlar.sort((a, b) => (b.medyan ?? 1e9) - (a.medyan ?? 1e9));
  console.log(`\n  ${ad("plaka", 12)} ${n("fix/7gün", 9)} ${n("medyan sn", 10)} ${n("p90 sn", 8)} ${n("3dk'da fix", 11)}`);
  for (const s of satirlar) {
    console.log(`  ${ad(s.plate, 12)} ${n(s.fix, 9)} ${n(s.medyan ?? "—", 10)} ${n(s.p90 ?? "—", 8)} ${n(s.uc3dk ?? "—", 11)}`);
  }
  const olculen = satirlar.filter((s) => s.medyan != null);
  if (olculen.length) {
    const meds = olculen.map((s) => s.medyan).sort((a, b) => a - b);
    console.log(`\n  FİLO MEDYANI: ${meds[Math.floor(meds.length / 2)]} sn → 3 dk'da ~${Math.round(180 / meds[Math.floor(meds.length / 2)])} fix`);
    console.log(`  En seyrek 3 araç: ${olculen.slice(0, 3).map((s) => `${s.plate}(${s.medyan}sn)`).join(" · ")}`);
    console.log(`  Fix'i HİÇ/az olan araç: ${satirlar.filter((s) => s.fix < 2).map((s) => s.plate).join(", ") || "yok"}`);
  }
}

// ══ KAPI 6: MOTOR CANLIDA ÇALIŞIYOR MU ═══════════════════════════════════
console.log(`\n── KAPI 6: MOTOR CANLIDA ÇALIŞIYOR MU (kanıt: açılmış vardiyalar) ──`);
{
  const { data } = await fetchAllRows(
    (from, to) =>
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, plate, started_at, auto_started, start_source, started_by")
        .gte("started_at", startISO)
        .order("started_at", { ascending: true })
        .order("id")
        .range(from, to),
    "depo/vardiyalar"
  );
  const rows = data ?? [];
  const sayim = new Map();
  for (const r of rows) {
    const k = `auto_started=${r.auto_started === true} · start_source=${r.start_source ?? "(yok)"}`;
    sayim.set(k, (sayim.get(k) ?? 0) + 1);
  }
  console.log(`  ${GUN} günde açılmış vardiya: ${rows.length}`);
  for (const [k, v] of [...sayim].sort((a, b) => b[1] - a[1])) console.log(`     ${ad(k, 46)} ${n(v, 5)}`);
  const oto = rows.filter((r) => r.auto_started === true || r.start_source === "auto");
  console.log(`\n  → OTOMATİK açılan: ${oto.length}  ${oto.length === 0 ? "🔴 MOTOR HİÇ ÇALIŞMAMIŞ" : "✓"}`);
  if (oto.length) {
    const sonlar = oto.slice(-5);
    for (const r of sonlar) console.log(`     ${r.started_at}  ${ad(r.plate ?? "?", 12)}`);
  }
  // en son otomatik vardiya (tüm zamanlar)
  const { data: sonOto } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, plate, start_source, auto_started")
    .eq("auto_started", true)
    .order("started_at", { ascending: false })
    .limit(3);
  console.log(`\n  TÜM ZAMANLARDA son otomatik vardiyalar:`);
  if (!sonOto || sonOto.length === 0) console.log(`     (hiç yok)`);
  for (const r of sonOto ?? []) console.log(`     ${r.started_at}  ${ad(r.plate ?? "?", 12)} src=${r.start_source ?? "—"}`);
}

// ══ KAPI 7: SYNC/INGEST ÇALIŞIYOR MU ═════════════════════════════════════
console.log(`\n── KAPI 7: TELEMETRİ HATTI CANLI MI (motoru kim tetikliyor) ──`);
{
  const { data: sonFix } = await supabaseAdmin
    .from("device_telemetry")
    .select("recorded_at, created_at")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sonFix) console.log(`  🔴 device_telemetry BOŞ`);
  else {
    const yasDk = Math.round((Date.now() - Date.parse(sonFix.recorded_at)) / 60000);
    console.log(`  en yeni fix: ${sonFix.recorded_at}  (${yasDk} dk önce)`);
    console.log(`  → ${yasDk < 30 ? "✓ hat CANLI — /api/flespi/sync ya da /ingest çağrılıyor" : "🔴 hat SESSİZ"}`);
    if (sonFix.created_at) {
      console.log(`  created_at: ${sonFix.created_at}  (yazılma anı — sync gecikmesi ${Math.round((Date.parse(sonFix.created_at) - Date.parse(sonFix.recorded_at)) / 1000)} sn)`);
    }
  }
  // Son 24 saatte saat başına yazılan fix sayısı — zamanlayıcının nabzı
  const { data: son24 } = await fetchAllRows(
    (from, to) =>
      supabaseAdmin
        .from("device_telemetry")
        .select("recorded_at")
        .gte("recorded_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("recorded_at", { ascending: true })
        .order("id")
        .range(from, to),
    "depo/son24"
  );
  const saatlik = new Map();
  for (const r of son24 ?? []) {
    const h = r.recorded_at.slice(0, 13);
    saatlik.set(h, (saatlik.get(h) ?? 0) + 1);
  }
  console.log(`  son 24 saat: ${(son24 ?? []).length} fix · ${saatlik.size}/24 saatte veri var · boş saat ${24 - saatlik.size}`);
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
