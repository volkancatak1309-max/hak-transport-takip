#!/usr/bin/env node
/**
 * TEST KAYDI GİZLİ Mİ? — canlı doğrulayıcı (migration 028 / lib/test-data.ts).
 *
 * 13 yönetici yüzeyinin ÜRETİM sorgularını canlı Supabase'e karşı İKİ KEZ
 * çalıştırır: filtresiz ve filtreli. Test kaydı filtresizde görünüp filtrelide
 * kayboluyorsa o yüzey KANITLANMIŞ sayılır.
 *
 * SALT OKUMA — hiçbir satır yazmaz, güncellemez, silmez.
 *
 * Kullanım:  node scripts/verify-test-hidden.mjs
 *
 * "boş kanıt" uyarısı: gizlenecek kayıt henüz yoksa (migration çalışmadı ya da
 * test şoförü hiç vardiya açmadı) satır "veri yok" döner — bu bir GEÇME değil,
 * "henüz sınanamadı" demektir. Betik ikisini birbirine karıştırmaz.
 */
import { createClient } from "file:///C:/Users/90553/Desktop/business/hak-transport-takip/node_modules/@supabase/supabase-js/dist/index.mjs";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync("C:/Users/90553/Desktop/business/hak-transport-takip/.env.local", "utf8")
    .split(/\r?\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Migration sonrası kimlikler DB'den okunur; öncesinde bilinen kayda düşülür.
let TEST_WORKER = "fa3841cc-f540-46f5-b170-91daa5e4c005";

// lib/test-data.ts withoutTestRows ile BİREBİR aynı mekanik
const without = (q, col, ids) => (ids.length === 0 ? q : q.not(col, "in", `(${ids.join(",")})`));

let pass = 0, fail = 0;
const rows = [];
let untested = 0;
function check(surface, detail, beforeHas, afterHas) {
  if (beforeHas && !afterHas) { pass++; var verdict = "KANITLANDI ✓"; }
  else if (beforeHas && afterHas) { fail++; verdict = "SIZIYOR ❌"; }
  else { untested++; verdict = "sınanamadı (veri yok)"; }
  rows.push({ surface, detail, before: beforeHas ? "VAR" : "—", after: afterHas ? "VAR" : "—", verdict });
}

// 0) Migration durumu
const probe = await sb.from("workers").select("id").eq("is_test", true).limit(1);
const migrated = !probe.error;
console.log(`Migration 028: ${migrated ? "UYGULANMIŞ" : "HENÜZ UYGULANMAMIŞ (is_test kolonu yok)"}`);
const { data: tv } = migrated
  ? await sb.from("vehicles").select("id, plate").eq("is_test", true)
  : { data: [] };
const TEST_VEHICLES = (tv ?? []).map(v => v.id);
const TEST_PLATES = (tv ?? []).map(v => v.plate);
console.log(`Test araç kaydı: ${TEST_PLATES.length ? TEST_PLATES.join(", ") : "YOK (SQL bekliyor)"}\n`);

const W = [TEST_WORKER];
const V = TEST_VEHICLES;
// KİMLİK ALANI AÇIK VERİLİR. Önceki hâli `r.id ?? r.worker_id` sırasıyla
// bakıyordu; "id, worker_id" seçen time_entries sorgularında satırın KENDİ
// id'sini şoför id'siyle karşılaştırıp hiç eşleşmiyor, sonucu sessizce
// "sınanamadı" gösteriyordu. Sessiz false-negative = değersiz doğrulama.
const hasW = (d, id) => (d ?? []).some(r => r.worker_id === id);
const hasV = (d, id) => (d ?? []).some(r => (r.vehicle_id ?? r.id) === id);
const has = (d, id) => (d ?? []).some(r => r.id === id);
const hasPlate = (d, p) => (d ?? []).some(r => (r.plate ?? r.vehicle_plate) === p);

// 1) Günün Panosu roster — lib/admin-dashboard.ts:266
{
  const b = await sb.from("workers").select("id, name, is_active, is_admin");
  const a = await without(sb.from("workers").select("id, name, is_active, is_admin"), "id", W);
  check("1. Günün Panosu (roster)", "workers", has(b.data, TEST_WORKER), has(a.data, TEST_WORKER));
}
// 2) Üst 5'li şerit / açık vardiyalar — admin-dashboard.ts:259
{
  const q = () => sb.from("time_entries").select("id, worker_id, vehicle_id").is("ended_at", null);
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("2. 5'li şerit (açık vardiyalar)", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
}
// 3) Harita — app/admin/harita/page.tsx:27
{
  const q = () => sb.from("time_entries").select("id, worker_id, vehicle_id").is("ended_at", null);
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("3. Harita (Şoförler sekmesi)", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
}
// 3b) Harita araç katmanı — lib/telemetry.ts:597
{
  const q = () => sb.from("vehicles").select("id, plate, fleet").or("flespi_device_id.not.is.null,imei.not.is.null");
  const b = await q();
  const a = { data: (b.data ?? []).filter(v => !V.includes(v.id)) };
  check("3b. Harita (araç katmanı)", "vehicles+cihaz", V.some(id => hasV(b.data, id)), V.some(id => hasV(a.data, id)));
}
// 4) Araçlar sayfası — lib/vehicles.ts:33
{
  const b = await sb.from("vehicles").select("id, plate").order("plate");
  const a = { data: (b.data ?? []).filter(v => !V.includes(v.id)) };
  check("4. Araçlar sayfası", "vehicles", V.some(id => hasV(b.data, id)), V.some(id => hasV(a.data, id)));
}
// 4b) Araçlar — şoför dropdown'ı — app/admin/araclar/page.tsx:21
{
  const q = () => sb.from("workers").select("id, name, is_active").order("name");
  const b = await q(); const a = await without(q(), "id", W);
  check("4b. Araçlar (şoför dropdown)", "workers", has(b.data, TEST_WORKER), has(a.data, TEST_WORKER));
}
// 5) Çalışanlar sayfası — app/admin/workers/page.tsx:34
{
  const q = () => sb.from("workers").select("id, name").order("name");
  const b = await q(); const a = await without(q(), "id", W);
  check("5. Çalışanlar sayfası", "workers", has(b.data, TEST_WORKER), has(a.data, TEST_WORKER));
}
// 6) Dikkat/Aksiyon — ehliyet sorgusu (admin-dashboard.ts:272)
{
  const q = () => sb.from("workers").select("id, name, license_expiry").eq("is_active", true);
  const b = await q(); const a = await without(q(), "id", W);
  check("6. Dikkat/Aksiyon (ehliyet)", "workers", has(b.data, TEST_WORKER), has(a.data, TEST_WORKER));
}
// 7) Kapanmamış Vardiyalar + Operasyon Özeti — aynı açık-vardiya dizisi
{
  const q = () => sb.from("time_entries").select("id, worker_id").is("ended_at", null);
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("7. Kapanmamış Vardiyalar / Ops Özeti", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
}
// 8) Vardiya Kayıtları arşivi — app/admin/page.tsx:80
{
  const q = () => sb.from("time_entries").select("id, worker_id").gte("started_at", "2026-01-01");
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("8. Vardiya Kayıtları arşivi", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
}
// 9) Analiz (güvenlik skoru / rölanti / olay tabloları) — lib/analytics.ts:132-133
{
  const bw = await sb.from("workers").select("id, name").eq("is_active", true);
  const aw = await without(sb.from("workers").select("id, name").eq("is_active", true), "id", W);
  check("9. Analiz (şoför evreni)", "workers", has(bw.data, TEST_WORKER), has(aw.data, TEST_WORKER));
  const bv = await sb.from("vehicles").select("id, plate, assigned_worker_id");
  const av = { data: (bv.data ?? []).filter(v => !V.includes(v.id)) };
  check("9b. Analiz (araç evreni)", "vehicles", V.some(id => hasV(bv.data, id)), V.some(id => hasV(av.data, id)));
}
// 10) Raporlar — yakıt (KENDİ sorgusu, lib/reports.ts:465-467)
{
  const bv = await sb.from("vehicles").select("id, plate, tank_capacity_l");
  const av = { data: (bv.data ?? []).filter(v => !V.includes(v.id)) };
  check("10. Yakıt raporu (araç)", "vehicles", V.some(id => hasV(bv.data, id)), V.some(id => hasV(av.data, id)));
  const bw = await sb.from("workers").select("id, name").eq("is_active", true);
  const aw = await without(sb.from("workers").select("id, name").eq("is_active", true), "id", W);
  check("10b. Yakıt raporu (şoför)", "workers", has(bw.data, TEST_WORKER), has(aw.data, TEST_WORKER));
}
// 11) Raporlar — performans (lib/reports.ts:219)
{
  const q = () => sb.from("time_entries").select("id, worker_id").gte("started_at", "2026-01-01");
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("11. Performans raporu", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
}
// 12) PDF/CSV — AZG (time_entries) + CO2 (plaka)
{
  const q = () => sb.from("time_entries").select("id, worker_id").not("ended_at", "is", null);
  const b = await q(); const a = await without(q(), "worker_id", W);
  check("12. AZG PDF", "time_entries", hasW(b.data, TEST_WORKER), hasW(a.data, TEST_WORKER));
  const bf = await sb.from("fuel_entries").select("vehicle_plate").eq("status", "approved");
  const af = { data: (bf.data ?? []).filter(r => !TEST_PLATES.includes(r.vehicle_plate)) };
  check("13b. CO2 PDF (plaka bazlı)", "fuel_entries", TEST_PLATES.some(p => hasPlate(bf.data, p)), TEST_PLATES.some(p => hasPlate(af.data, p)));
}
// 13) ⌘K araç dizini — app/actions/vehicles.ts:333
{
  const b = await sb.from("vehicles").select("id, plate").order("plate");
  const a = { data: (b.data ?? []).filter(v => !V.includes(v.id)) };
  check("13. ⌘K araç dizini", "vehicles", V.some(id => hasV(b.data, id)), V.some(id => hasV(a.data, id)));
}

const w = [Math.max(...rows.map(r => r.surface.length)), 14, 8, 9];
console.log("YÜZEY".padEnd(w[0]) + " | " + "TABLO".padEnd(w[1]) + " | " + "FİLTRESİZ".padEnd(w[2]) + " | FİLTRELİ | SONUÇ");
console.log("-".repeat(w[0] + w[1] + 46));
for (const r of rows) {
  console.log(r.surface.padEnd(w[0]) + " | " + r.detail.padEnd(w[1]) + " | " + r.before.padEnd(w[2]) + " | " + r.after.padEnd(8) + " | " + r.verdict);
}
console.log(
  `\nKANITLANDI: ${pass}   SIZIYOR: ${fail}   SINANAMADI: ${untested}`
);
if (fail > 0) {
  console.error(
    "\n❌ SIZINTI VAR — yukarıdaki yüzeylerde test kaydı filtreden geçiyor."
  );
  process.exit(1);
}
if (untested > 0) {
  console.log(
    `\n⚠️  ${untested} yüzey SINANAMADI: o yüzeyde gizlenecek kayıt yok.` +
      "\n   Bu bir geçme değil. Migration 028'i çalıştır, test hesabıyla bir" +
      "\n   vardiya aç/kapat, sonra bu betiği tekrar çalıştır."
  );
}

// Test şoförünün canlı veri ayak izi
const foot = {};
for (const [t, col] of [["time_entries","worker_id"],["shift_packages","worker_id"],["shift_photos","worker_id"],["driver_reports","worker_id"],["fuel_entries","worker_id"],["assignments","worker_id"],["driver_locations","worker_id"]]) {
  const { count, error } = await sb.from(t).select("id", { count: "exact", head: true }).eq(col, TEST_WORKER);
  foot[t] = error ? "ERR" : count;
}
console.log("\nTest şoförünün veri ayak izi:", JSON.stringify(foot));
