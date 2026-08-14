/**
 * ÖLÇÜM — telemetri GECİKMESİ + AÇIK VARDİYA, iki kiracıda. Salt okuma.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const KOK = "C:/Users/90553/Desktop/business/hak-transport-takip";
function env(f) {
  const o = {};
  for (const l of readFileSync(`${KOK}/${f}`, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(l.trim());
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const TZ = "Europe/Vienna";
const vt = (i) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" })
    .format(new Date(i));
const dk = (ms) => (ms / 60000).toFixed(1);
const sa = (ms) => `${Math.floor(ms / 3600000)}s ${Math.round((ms % 3600000) / 60000)}dk`;
const B = (s) => `\n${"═".repeat(74)}\n  ${s}\n${"═".repeat(74)}`;

async function olc(ad, dosya) {
  const e = env(dosya);
  console.log(B(`${ad}  ·  ${e.NEXT_PUBLIC_SUPABASE_URL.replace("https://", "").split(".")[0]}`));
  const c = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const now = Date.now();

  const { data: vs } = await c
    .from("vehicles")
    .select("id, plate, status, is_test, assigned_worker_id")
    .order("plate");
  const { data: ws } = await c.from("workers").select("id, name, is_test");
  const nm = (id) => ws?.find((w) => w.id === id)?.name ?? "—";
  console.log(`araç: ${vs.length}   şoför: ${ws.length}`);

  // ── TELEMETRİ GECİKMESİ — araç başına son fix ────────────────────────────
  console.log(`\n── TELEMETRİ GECİKMESİ (araç başına son kayıt) ──`);
  const gecikmeler = [];
  for (const v of vs) {
    // PENCERELİ ARAMA — kayan 7 gün. Penceresiz `order desc limit 1` bu şemada
    // ifade zaman aşımına düşüyor ve `data:null` dönüyordu; hata yutulursa
    // "KAYIT YOK" sanılır (sessiz eksik YASAK). Hata artık BASILIYOR ve
    // yokluk ile arıza ayrı raporlanıyor.
    const pencere = new Date(now - 7 * 24 * 3600_000).toISOString();
    const r = await c
      .from("device_telemetry")
      .select("recorded_at, odometer_km, speed_kmh, ignition_on, ingested_at")
      .eq("vehicle_id", v.id)
      .gte("recorded_at", pencere)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error) {
      console.log(`  ${v.plate.padEnd(11)} ${v.is_test ? "[TEST] " : ""}🔴 SORGU HATASI ${r.error.code}: ${r.error.message}`);
      gecikmeler.push({ plate: v.plate, ms: null, test: v.is_test, hata: true });
      continue;
    }
    const son = r.data;
    if (!son) {
      console.log(`  ${v.plate.padEnd(11)} ${v.is_test ? "[TEST] " : ""}7 GÜNDE KAYIT YOK`);
      gecikmeler.push({ plate: v.plate, ms: null, test: v.is_test });
      continue;
    }
    const lag = now - new Date(son.recorded_at).getTime();
    gecikmeler.push({ plate: v.plate, ms: lag, test: v.is_test });
    const bayrak = lag > 24 * 3600_000 ? "  🔴 24s+" : lag > 3600_000 ? "  ⚠️ 1s+" : "";
    console.log(
      `  ${v.plate.padEnd(11)} son fix ${vt(son.recorded_at)}  gecikme ${sa(lag).padStart(9)}` +
        `  odo=${son.odometer_km ?? "—"}${bayrak}`
    );
  }
  const canli = gecikmeler.filter((g) => g.ms !== null && !g.test);
  if (canli.length) {
    const sirali = [...canli].sort((a, b) => a.ms - b.ms);
    const med = sirali[Math.floor(sirali.length / 2)].ms;
    console.log(
      `\n  en taze ${dk(sirali[0].ms)} dk (${sirali[0].plate})  ·  ortanca ${dk(med)} dk` +
        `  ·  en bayat ${sa(sirali[sirali.length - 1].ms)} (${sirali[sirali.length - 1].plate})`
    );
    console.log(`  1 saatten bayat: ${canli.filter((g) => g.ms > 3600_000).length}/${canli.length}` +
      `   ·   24 saatten bayat: ${canli.filter((g) => g.ms > 24 * 3600_000).length}/${canli.length}`);
  }

  // ── AÇIK VARDİYALAR ──────────────────────────────────────────────────────
  console.log(`\n── AÇIK VARDİYALAR ──`);
  const { data: acik } = await c
    .from("time_entries")
    .select("id, worker_id, vehicle_id, plate, started_at, start_km, break_started_at, start_source")
    .is("ended_at", null)
    .order("started_at");
  if (!acik?.length) console.log("  YOK");
  const H = 3600_000;
  for (const a of acik ?? []) {
    const sure = now - new Date(a.started_at).getTime();
    // AZG tavanı: gece penceresine (00:00-04:00) değiyorsa 10 sa, değilse 12 sa
    let gece = false;
    for (let t = new Date(a.started_at).getTime(); t <= now; t += 15 * 60_000) {
      const h = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })
        .format(new Date(t)) % 24;
      if (h < 4) { gece = true; break; }
    }
    const tavan = gece ? 10 * H : 12 * H;
    console.log(
      `  ${nm(a.worker_id).padEnd(17)} ${vt(a.started_at)} → AÇIK   ${sa(sure).padStart(9)}` +
        `  ${a.plate ?? "—"}  km0=${a.start_km}  tavan=${tavan / H}s${sure > tavan ? "  🔴 AŞTI" : ""}` +
        `  kaynak=${a.start_source ?? "—"}${a.break_started_at ? "  MOLADA" : ""}`
    );
  }
  return { acik: acik?.length ?? 0 };
}

await olc("HAK61", ".env.local");
await olc("SENDIGO", ".env.sendigo");
