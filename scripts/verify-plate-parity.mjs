#!/usr/bin/env node
/**
 * PLAKA PARİTESİ — liste ucu ile detay ucu aynı plakayı mı gösteriyor?
 *
 * NE ÇÖZÜYOR: `app/api/mobile/workers` (liste) plakayı bir zamanlar ham
 * `workers.plate` serbest metninden döndürüyordu; `app/api/mobile/workers/[id]`
 * (detay) ve panelin Çalışanlar sayfası ise tek kaynak olan
 * `vehicles.assigned_worker_id` ilişkisinden türetiyordu. Aynı uygulamanın iki
 * ekranı aynı kişide farklı plaka gösterebiliyordu (canlı HAK61, 09.08.2026:
 * 33 kişinin 17'sinde farklı).
 *
 * NE YAPAR: üç sorgu yolunu canlı Supabase'de BİREBİR tekrarlar —
 *   ÖNCE (regresyon)  workers.plate ham hâli
 *   DETAY             vehicles.assigned_worker_id · status != inactive ·
 *                     order("plate") · ilk · ?? workers.plate
 *   LİSTE (bugünkü)   sayfadaki kimlikler için TEK vehicles sorgusu, aynı kural
 * ve LİSTE ile DETAY'ın farkını sayar. Fark 0 değilse çıkış kodu 1.
 *
 * SALT OKUMA — hiçbir satır yazmaz, güncellemez, silmez.
 *
 * Kullanım:
 *   node scripts/verify-plate-parity.mjs                      # .env.local
 *   node scripts/verify-plate-parity.mjs .env.sendigo SENDIGO # başka müşteri
 *
 * Not: bu betik uca HTTP ile gitmez, ucun ÇALIŞTIRDIĞI sorgu yolunu tekrarlar
 * (UI-path proof). Kimlik doğrulamalı QA bu projede bloklu; kural CLAUDE.md'de.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_FILE = path.resolve(ROOT, process.argv[2] ?? ".env.local");
const LABEL = process.argv[3] ?? "HAK61";
/** "1" = yalnız aktif (ucun varsayılanı) · "0" = pasif · "all" = tümü */
const AKTIF = process.argv[4] ?? "all";

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

/** lib/test-data.ts withoutTestRows ile BİREBİR aynı mekanik. */
const without = (q, col, ids) => (ids.length === 0 ? q : q.not(col, "in", `(${ids.join(",")})`));
const norm = (x) => (x == null || x === "" ? null : String(x).trim());

// ── getTestScope() replikası (kolon yoksa boş kümeye düşer) ─────────────────
const [wRes, vRes] = await Promise.all([
  sb.from("workers").select("id").eq("is_test", true),
  sb.from("vehicles").select("id").eq("is_test", true),
]);
const testWorkerIds = wRes.error ? [] : (wRes.data ?? []).map((w) => w.id);
const testVehicleIds = vRes.error ? [] : (vRes.data ?? []).map((v) => v.id);

// ── LİSTE UCU: workers sorgusu (app/api/mobile/workers/route.ts) ────────────
// Patron kapsamı BİLEREK uygulanmıyor: SECURITY_LAYER_ENABLED kapalıyken zaten
// boş kapsam döner ve açıkken de yalnız SATIR SAYISINI daraltır — plaka
// türetimini değiştirmez. Buradaki amaç en geniş kadroyu sınamak.
let q = sb.from("workers").select("id, name, plate", { count: "exact" }).order("name");
q = without(q, "id", testWorkerIds);
if (AKTIF === "1") q = q.eq("is_active", true);
else if (AKTIF === "0") q = q.eq("is_active", false);
const { data: workers, count, error } = await q.range(0, 199); // lib/mobile-list MAX_LIMIT
if (error) {
  console.error(`✗ workers sorgusu: ${error.message}`);
  process.exit(1);
}
const ids = workers.map((w) => w.id);

// ── DETAY UCU: kişi başına ANAHTARLI sorgu (workers/[id]/route.ts) ──────────
const detay = new Map();
for (const w of workers) {
  const { data: veh, error: e } = await sb
    .from("vehicles")
    .select("plate")
    .eq("assigned_worker_id", w.id)
    .neq("status", "inactive")
    .order("plate")
    .limit(1)
    .maybeSingle();
  if (e) {
    console.error(`✗ detay sorgusu: ${e.message}`);
    process.exit(1);
  }
  detay.set(w.id, norm(veh?.plate ?? w.plate));
}

// ── LİSTE UCU (bugünkü): TEK vehicles sorgusu ───────────────────────────────
const liste = new Map();
if (ids.length > 0) {
  const { data: vehData, error: vErr } = await without(
    sb
      .from("vehicles")
      .select("plate, assigned_worker_id")
      .in("assigned_worker_id", ids)
      .neq("status", "inactive")
      .order("plate"),
    "id",
    testVehicleIds
  );
  if (vErr) {
    console.error(`✗ vehicles sorgusu: ${vErr.message}`);
    process.exit(1);
  }
  const ilk = new Map();
  for (const v of vehData ?? []) {
    if (!ilk.has(v.assigned_worker_id)) ilk.set(v.assigned_worker_id, v.plate);
  }
  for (const w of workers) liste.set(w.id, norm(ilk.get(w.id) ?? w.plate));
}

// ── REGRESYON TABANI: ham workers.plate ────────────────────────────────────
const once = new Map(workers.map((w) => [w.id, norm(w.plate)]));

const dolu = (m) => workers.filter((w) => m.get(w.id) !== null).length;
const farkOnce = workers.filter((w) => once.get(w.id) !== detay.get(w.id));
const farkSimdi = workers.filter((w) => liste.get(w.id) !== detay.get(w.id));

console.log(`\n═══ ${LABEL} · plaka paritesi (aktif=${AKTIF}) ═══`);
console.log(`kadro                       ${count} (sayfada ${workers.length})`);
console.log(`plakası dolu — ham sütun    ${dolu(once)}`);
console.log(`plakası dolu — detay ucu    ${dolu(detay)}`);
console.log(`plakası dolu — liste ucu    ${dolu(liste)}`);
console.log(`FARK  ham sütun ↔ detay     ${farkOnce.length}   (düzeltme öncesi hâl)`);
console.log(`FARK  liste ucu ↔ detay     ${farkSimdi.length}   ← 0 olmalı`);

if (farkSimdi.length) {
  console.error("\n✗ LİSTE ≠ DETAY — aynı kişi iki ekranda farklı plaka görüyor:\n");
  console.error("kişi".padEnd(14) + "LİSTE".padEnd(14) + "DETAY");
  for (const w of farkSimdi) {
    console.error(
      `${w.name.slice(0, 3)}***`.padEnd(14) +
        String(liste.get(w.id) ?? "—").padEnd(14) +
        String(detay.get(w.id) ?? "—")
    );
  }
  console.error("\n  Beklenen kural: atanmış araç (status != inactive, plakaca ilk),");
  console.error("  yoksa workers.plate. Üç yüzey de aynı kuralı uygulamalı.\n");
  process.exit(1);
}

console.log(`\n✓ ${workers.length} kişide liste ucu ile detay ucu AYNI plakayı veriyor.\n`);
