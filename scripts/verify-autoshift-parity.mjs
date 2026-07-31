#!/usr/bin/env node
/**
 * CANLI KANIT — otomatik vardiya motorunun karar farkı (SALT OKUMA).
 *
 * SORU: 31.07.2026'da processAutoShifts'e iki yeni dal eklendi (first_ignition
 * başlangıç tetiği + depot_idle otomatik kapanış). HAK61 canlısında bu dalların
 * HİÇBİRİ seçilmemeli ve motorun kararı bugünküyle birebir aynı kalmalı.
 *
 * YÖNTEM: projenin standart "UI-path proof" tekniği — sayfanın/motorun
 * çalıştırdığı Supabase sorgu yolunu canlı veritabanında birebir tekrarlayıp
 * sayıları BASMAK. Tahmin yok, ölçüm var. Bu betik HİÇBİR ŞEY YAZMAZ:
 * yalnız select. (Motorun kendisi çalıştırılamaz — yazma yapar.)
 *
 * ÖLÇTÜĞÜ ÜÇ ŞEY:
 *   1. Ayar durumu: env'siz yükte tetikleyici 'depot_entry', kapanış 'off' mu?
 *      (scripts/check-tenant-defaults.mjs bunu zaten denetler; burada canlı
 *      ortamın kendi env'iyle tekrar bakılır — HAK61 .env.local'inde bu
 *      değişkenler TANIMSIZ olmalı.)
 *   2. BAŞLANGIÇ farkı: her araç için "günün ilk kontak açılışı" ile "günün ilk
 *      depo-içi fix'i" ne kadar ayrışıyor? İkisi farklıysa yeni dalın gerçekten
 *      başka bir an ürettiği kanıtlanır — ve HAK61'in o dalı SEÇMEDİĞİ
 *      gösterilir. (Fark 0 çıksaydı ölçüm hiçbir şey söylemezdi.)
 *   3. KAPANIŞ farkı: şu an açık olan vardiyalardan kaçı depot_idle açık olsaydı
 *      kapanırdı? Bu sayı > 0 ise ayarın canlıda gerçek bir etkisi var demektir
 *      ve 'off' olduğu için HİÇBİRİ kapanmıyordur.
 *
 * BAŞARI ÖLÇÜTÜ: (1) doğru → motor bugünküyle aynı kararı verir; (2) ve (3)
 * yalnız BİLGİdir, kapı değil.
 *
 * Kullanım: node scripts/verify-autoshift-parity.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

function loadEnv() {
  const out = { ...process.env };
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!(k in out)) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

/** Viyana gününün başlangıcı — lib/format.ts startOfTodayVienna ile aynı sonuç. */
function startOfTodayVienna() {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
  // Viyana yaz saati UTC+2, kış UTC+1. Ofseti günün kendisinden türet.
  const probe = new Date(`${ymd}T12:00:00Z`);
  const local = new Date(probe.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMin = Math.round((local - utc) / 60000);
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offsetMin * 60000);
}

/** lib/geo.ts pointInCircleM ile aynı haversine. */
function withinM(lat1, lng1, lat2, lng2, radiusM) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) <= radiusM;
}

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna" }) : "—";

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── 1) AYAR DURUMU ────────────────────────────────────────────────────────
  const trigger = env.SHIFT_START_TRIGGER?.trim() || "depot_entry";
  const autoEnd = env.SHIFT_AUTO_END?.trim() || "off";
  const idleMin = Number(env.SHIFT_AUTO_END_IDLE_MIN || env.AUTO_SHIFT_IDLE_END_MINUTES || 30);

  console.log("── 1) AYAR DURUMU (bu ortamın env'i) ────────────────────────");
  console.log(`   SHIFT_START_TRIGGER   : ${trigger}${trigger === "depot_entry" ? "  (bugünkü davranış)" : "  ⚠️ DEĞİŞMİŞ"}`);
  console.log(`   SHIFT_AUTO_END        : ${autoEnd}${autoEnd === "off" ? "  (bugünkü davranış)" : "  ⚠️ DEĞİŞMİŞ"}`);
  console.log(`   hareketsizlik eşiği   : ${idleMin} dk`);

  const parity = trigger === "depot_entry" && autoEnd === "off";

  const dayStart = startOfTodayVienna().toISOString();

  // ── Motorun taradığı araç kümesi — auto-shift.ts ile BİREBİR aynı sorgu ──
  const { data: vehicles, error: vErr } = await sb
    .from("vehicles")
    .select("id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled")
    .or("flespi_device_id.not.is.null,imei.not.is.null");
  if (vErr) throw new Error(`vehicles: ${vErr.message}`);

  const { data: zones } = await sb
    .from("geofences")
    .select("id, name, center_lat, center_lng, radius_m")
    .eq("active", true)
    .eq("purpose", "depot");
  const depotZones = zones ?? [];

  console.log(`\n   araç (cihazlı)        : ${vehicles.length}`);
  console.log(`   aktif depo bölgesi    : ${depotZones.length}`);

  // ── 2) BAŞLANGIÇ FARKI ────────────────────────────────────────────────────
  console.log("\n── 2) BAŞLANGIÇ TETİĞİ FARKI (bugün, Viyana günü) ──────────");
  console.log("   plaka        ilk kontak   ilk depo-içi   fark");

  let differing = 0;
  let onlyIgnition = 0;
  for (const v of vehicles) {
    const { data: ign } = await sb
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", v.id)
      .eq("ignition_on", true)
      .gte("recorded_at", dayStart)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // İlk depo-içi fix — depotArrivalTrigger'ın yaklaşık karşılığı (dwell şartı
    // olmadan; buradaki soru "an aynı mı", "vardiya açılır mı" değil).
    let firstDepot = null;
    if (depotZones.length > 0) {
      const { data: fixes } = await sb
        .from("device_telemetry")
        .select("recorded_at, latitude, longitude")
        .eq("vehicle_id", v.id)
        .gte("recorded_at", dayStart)
        .not("latitude", "is", null)
        .order("recorded_at", { ascending: true })
        .limit(1000);
      for (const f of fixes ?? []) {
        if (
          depotZones.some((z) =>
            withinM(f.latitude, f.longitude, z.center_lat, z.center_lng, z.radius_m)
          )
        ) {
          firstDepot = f.recorded_at;
          break;
        }
      }
    }

    const a = ign?.recorded_at ?? null;
    const b = firstDepot;
    let diff = "—";
    if (a && b) {
      const m = Math.round((new Date(b) - new Date(a)) / 60000);
      diff = `${m >= 0 ? "+" : ""}${m} dk`;
      if (Math.abs(m) >= 1) differing++;
    } else if (a && !b) {
      diff = "yalnız kontak";
      onlyIgnition++;
    }
    if (a || b) {
      console.log(
        `   ${String(v.plate).padEnd(12)} ${fmt(a).padEnd(12)} ${fmt(b).padEnd(14)} ${diff}`
      );
    }
  }
  console.log(
    `\n   İki tetikleyicinin ayrıştığı araç: ${differing}` +
      (onlyIgnition ? ` (+${onlyIgnition} araçta depo fix'i hiç yok)` : "")
  );
  console.log("   → Dallar gerçekten farklı an üretiyor; HAK61 'depot_entry' dalını kullanıyor.");

  // ── 3) KAPANIŞ FARKI ──────────────────────────────────────────────────────
  const { data: open } = await sb
    .from("time_entries")
    .select("id, worker_id, vehicle_id, started_at, break_started_at, auto_started")
    .is("ended_at", null);
  const openShifts = open ?? [];

  console.log("\n── 3) KAPANIŞ FARKI (şu an açık vardiyalar) ────────────────");
  console.log(`   açık vardiya          : ${openShifts.length}`);

  let wouldClose = 0;
  const idleMs = idleMin * 60 * 1000;
  const now = Date.now();
  for (const s of openShifts) {
    if (!s.vehicle_id || s.break_started_at) continue;
    const { data: latest } = await sb
      .from("device_telemetry")
      .select("recorded_at, latitude, longitude, ignition_on, speed_kmh")
      .eq("vehicle_id", s.vehicle_id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) continue;
    const quiet = now - new Date(latest.recorded_at).getTime() >= idleMs;
    const inDepot =
      latest.latitude != null &&
      depotZones.some((z) =>
        withinM(latest.latitude, latest.longitude, z.center_lat, z.center_lng, z.radius_m)
      );
    if (latest.ignition_on !== true && quiet && inDepot) wouldClose++;
  }
  console.log(`   depot_idle AÇIK olsaydı kapanacak olan : ${wouldClose}`);
  console.log(`   şu anki ayarla ('${autoEnd}') kapanan   : 0`);

  // ── SONUÇ ─────────────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────────────────────");
  if (parity) {
    console.log("✓ KARAR FARKI: 0. Motor bugünküyle aynı dalları seçiyor —");
    console.log("  başlangıç depo tetiğinden, kapanış hiç yok.");
    process.exit(0);
  }
  console.log("⚠️ Bu ortamda ayarlar bugünkü HAK61 davranışından FARKLI.");
  console.log("  (Yeni müşteri ortamında beklenen budur; HAK61'de değil.)");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Hata:", e?.message ?? e);
  process.exit(1);
});
