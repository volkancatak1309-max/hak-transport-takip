#!/usr/bin/env node
/**
 * TELEMETRİ HATTI + OTOMATİK VARDİYA NABZI — ÖLÇÜM. HİÇBİR ŞEY YAZMAZ.
 *
 * 1. ölçümde iki şey çelişti: son 7 günde araç başına ~10.000 fix VAR ama
 * "son 24 saat" sorgusu 0 döndü. Biri yanlış. Bu betik ikisini de araç-eksenli
 * (indeksli) sorgularla yeniden ölçer ve hattın gerçekte ne zaman sustuğunu
 * gün gün gösterir.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/measure-depo-hat.mjs [gun]
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { addCalendarDaysVienna, startOfDayVienna, viennaDayKey } from "@/lib/format";

const GUN = Number(process.argv[2] ?? 14);
const start = addCalendarDaysVienna(startOfDayVienna(), -(GUN - 1));
const n = (x, w = 6) => String(x).padStart(w);
const ad = (s, w = 12) => String(s).slice(0, w).padEnd(w);

console.log(`\n╔══ TELEMETRİ HATTI · NABIZ ÖLÇÜMÜ (yazma YOK) ════════════════════`);
console.log(`║ an      ${new Date().toISOString()}`);

const scope = await getTestScope();
const { data: vehData } = await supabaseAdmin
  .from("vehicles").select("id, plate, flespi_device_id, imei, assigned_worker_id");
const vehicles = dropTestRows((vehData ?? []), (v) => ({ vehicle: v.id }), scope)
  .filter((v) => v.flespi_device_id != null || v.imei != null);

// ── 1. ARAÇ BAŞINA SON FIX ────────────────────────────────────────────────
console.log(`\n── 1. ARAÇ BAŞINA SON FIX (araç-eksenli, indeksli sorgu) ──`);
const sonlar = [];
for (const v of vehicles) {
  const { data, error } = await supabaseAdmin
    .from("device_telemetry")
    .select("recorded_at")
    .eq("vehicle_id", v.id)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  sonlar.push({
    plate: v.plate,
    son: error ? `HATA ${error.code ?? ""}` : data?.recorded_at ?? null,
    atanmis: !!v.assigned_worker_id,
  });
}
sonlar.sort((a, b) => String(b.son).localeCompare(String(a.son)));
console.log(`  ${ad("plaka")} ${ad("son fix", 26)} ${n("yaş(sa)", 8)}`);
for (const s of sonlar) {
  const yas = s.son && !s.son.startsWith("HATA")
    ? ((Date.now() - Date.parse(s.son)) / 3600000).toFixed(1) : "—";
  console.log(`  ${ad(s.plate)} ${ad(s.son ?? "(hiç)", 26)} ${n(yas, 8)}${s.atanmis ? "" : "  [şoförsüz]"}`);
}
const taze = sonlar.filter((s) => s.son && !s.son.startsWith("HATA") && Date.now() - Date.parse(s.son) < 3600_000);
console.log(`\n  → son 1 saatte konuşan araç: ${taze.length}/${vehicles.length}`);

// ── 2. GÜN GÜN FIX SAYISI (filo toplamı) ──────────────────────────────────
console.log(`\n── 2. GÜN GÜN FIX SAYISI (araç-eksenli toplam, ${GUN} gün) ──`);
const gunSayim = new Map();
for (const v of vehicles) {
  const { data } = await fetchAllRows(
    (from, to) =>
      supabaseAdmin
        .from("device_telemetry")
        .select("recorded_at")
        .eq("vehicle_id", v.id)
        .gte("recorded_at", start.toISOString())
        .order("recorded_at", { ascending: true })
        .order("id")
        .range(from, to),
    `hat/${v.plate}`
  );
  for (const r of data ?? []) {
    const k = viennaDayKey(r.recorded_at);
    gunSayim.set(k, (gunSayim.get(k) ?? 0) + 1);
  }
}
console.log(`  ${ad("gün")} ${n("fix", 9)}`);
for (const [k, c] of [...gunSayim].sort()) {
  console.log(`  ${ad(k)} ${n(c, 9)} ${"█".repeat(Math.round(c / 3000))}`);
}

// ── 3. OTOMATİK VARDİYA NABZI (gün gün) ───────────────────────────────────
console.log(`\n── 3. VARDİYA AÇILIŞLARI GÜN GÜN (kaynağa göre) ──`);
{
  const { data } = await fetchAllRows(
    (from, to) =>
      supabaseAdmin
        .from("time_entries")
        .select("started_at, start_source, auto_started, plate")
        .gte("started_at", start.toISOString())
        .order("started_at", { ascending: true })
        .order("id")
        .range(from, to),
    "hat/vardiyalar"
  );
  const g = new Map();
  for (const r of data ?? []) {
    const k = viennaDayKey(r.started_at);
    const cur = g.get(k) ?? { auto: 0, self: 0, admin: 0, chief: 0 };
    const src = r.auto_started === true ? "auto" : (r.start_source ?? "self");
    if (cur[src] !== undefined) cur[src]++;
    g.set(k, cur);
  }
  console.log(`  ${ad("gün")} ${n("auto", 6)} ${n("self", 6)} ${n("admin", 6)} ${n("chief", 6)} ${n("toplam", 7)}`);
  for (const [k, c] of [...g].sort()) {
    console.log(`  ${ad(k)} ${n(c.auto, 6)} ${n(c.self, 6)} ${n(c.admin, 6)} ${n(c.chief, 6)} ${n(c.auto + c.self + c.admin + c.chief, 7)}`);
  }
}

console.log(`\n╚══ ÖLÇÜM BİTTİ · hiçbir satır yazılmadı ═══════════════════════════\n`);
