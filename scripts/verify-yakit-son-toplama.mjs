#!/usr/bin/env node
/**
 * MIGRATION 106 — YAKIT YÜZDE SON TOPLAMA TEK GEÇİŞ. DENKLİK KANITI.
 *
 * ═══ NE KANITLANIYOR ══════════════════════════════════════════════════════
 *   1. 106'nın `report_fuel_stats_vehicle` ve `_v2`si, 104'teki hâlleriyle
 *      BAYT-BAYT aynı: 4 pencere × 3 etiket durumu × her araç × 11 kolon.
 *   2. Etiket durumları: TAM etiket · MELEZ (ilk yarı etiketli) · BOŞ tablo.
 *      v2'nin melez okuması 106'dan etkilenmiyor.
 *   3. ARIZA ENJEKSİYONU: yeni kuyruğun her bir toplayıcısını boz —
 *      denklik KIRILMALI. Kırılmıyorsa test boştur.
 *   4. SÜRE: canlı ölçekte (68.000 yakıt okuması = demo/HAK61'in en yoğun
 *      aracının 30 günü) 106 ne kadar kazandırıyor — ÖLÇÜLÜR, iddia edilmez.
 *
 * ⚠️ GÖVDELERİN İKİSİ DE DOSYADAN OKUNUYOR, buraya KOPYALANMIYOR:
 *   104 → db/migrations/104_yuzde_odo_kapisi_hizalama.sql   (eski hâl)
 *   106 → db/migrations/106_yakit_son_toplama.sql           (yeni hâl)
 *
 * Kullanım:  npm run verify:yakit-son-toplama
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (f) => readFileSync(join(KOK, "db/migrations", f), "utf8").replace(/\r/g, "");
const temizle = (x) => x.replace(/notify pgrst[^;]*;/g, "");

const m052 = oku("052_shift_distance_and_refill_merge.sql");
const M101 = temizle(oku("101_yakit_seri_etiket.sql"));
const M102 = temizle(oku("102_yakit_v2_pencere_duzeltme.sql"));
const M104 = temizle(oku("104_yuzde_odo_kapisi_hizalama.sql"));
const M106 = temizle(oku("106_yakit_son_toplama.sql"));

function govde(kaynak, ad) {
  const b = kaynak.indexOf(`create or replace function public.${ad}(`);
  if (b < 0) throw new Error(`${ad} bulunamadı`);
  return kaynak.slice(b, kaynak.indexOf("$$;", b) + 3);
}

const db = await PGlite.create();
const q = (s, p) => db.query(s, p);

await db.exec(`
  create table vehicles (id uuid primary key, plate text);
  create table device_telemetry (
    id bigserial primary key,
    vehicle_id uuid not null,
    recorded_at timestamptz not null,
    fuel_level_pct numeric,
    fuel_volume_l numeric,
    odometer_km numeric,
    unique (vehicle_id, recorded_at)
  );
  create index idx_dt_v_r on device_telemetry (vehicle_id, recorded_at);
`);

// ═══ VERİ — her araç ayrı bir patoloji ════════════════════════════════════
const T0 = Date.UTC(2026, 7, 1);
const ADIM = 5 * 60000; // 5 dk
const N = 2600; // araç başına ~9 gün
const ARACLAR = [
  ["10000000-0000-0000-0000-000000000000", "A-DUZ", "düzgün tüketim + 3 dolum"],
  ["20000000-0000-0000-0000-000000000000", "B-CUKUR", "tek satırlık sensör çukurları (de-glitch elemeli)"],
  ["30000000-0000-0000-0000-000000000000", "C-DUSUS", "hareketsizken KALICI düşüş 12 ve 9,5 puan (eşiğin iki yanı)"],
  ["40000000-0000-0000-0000-000000000000", "D-ESIK", "eşik SINIRINDA dolum (4,9 · 5,0 · 5,1 puan)"],
  ["50000000-0000-0000-0000-000000000000", "E-BOS", "hiç yakıt okuması yok"],
  ["60000000-0000-0000-0000-000000000000", "F-TEK", "tek okuma (first = last)"],
  ["70000000-0000-0000-0000-000000000000", "G-YOLDA", "15 puan düşüş ama ODOMETRE +5 km (kapı elemeli)"],
];
for (const [id, plate] of ARACLAR) {
  await q(`insert into vehicles values ($1,$2)`, [id, plate]);
}

const satir = [];
for (let i = 0; i < N; i++) {
  const t = new Date(T0 + i * ADIM).toISOString();
  const odo = 100000 + Math.floor(i / 7);

  // A: duzgun
  let a = 90 - (i % 900) * 0.09;
  satir.push([ARACLAR[0][0], t, Math.round(a * 10) / 10, odo]);

  // B: her 300'de bir tek satirlik 0
  let b = 85 - (i % 700) * 0.1;
  satir.push([ARACLAR[1][0], t, i % 300 === 0 && i > 0 ? 0 : Math.round(b * 10) / 10, odo]);

  /**
   * C: KALICI dususler, odometre SABIT (supheli kayip).
   * ⚠️ Dusus KALICI olmali: tek satirlik cukuru de-glitch zaten siliyor ve
   * o zaman drop_count 0 kalir — ariza enjeksiyonu da bos gecer (olculdu).
   * Iki buyukluk var: 12 puan (esik 10 ve 9'da da sayilir) ve 9,5 puan
   * (YALNIZ esik 9'a dusunce sayilir) — esik degisimini AYIRT EDER.
   */
  const cDus12 = Math.floor(i / 400);
  const cDus95 = Math.floor((i + 200) / 400);
  const c = 95 - cDus12 * 12 - cDus95 * 9.5 - (i % 400) * 0.002;
  satir.push([ARACLAR[2][0], t, Math.round(c * 10) / 10, 100000]);

  // D: esigin iki yaninda dolumlar
  let d = 40;
  if (i > 0 && i % 600 === 0) d = 40 + 4.9;
  else if (i > 0 && i % 601 === 0) d = 40 + 5.0;
  else if (i > 0 && i % 602 === 0) d = 40 + 5.1;
  satir.push([ARACLAR[3][0], t, d, odo]);

  // E: yakit yok (odometre var)
  satir.push([ARACLAR[4][0], t, null, odo]);

  /**
   * G: 15 puanlik KALICI dusus ama odometre 5 km ilerliyor.
   * Kapi (`odo - prev_odo between -1 and 1`) bunu ELEMELI. Kapi kaldirilirsa
   * drop_count artar — enjeksiyon bu araca carpar.
   */
  const gDus = Math.floor(i / 500);
  const gOdo = 200000 + gDus * 5;
  satir.push([ARACLAR[6][0], t, Math.round((98 - gDus * 15 - (i % 500) * 0.001) * 10) / 10, gOdo]);
}
// F: tek okuma
satir.push([ARACLAR[5][0], new Date(T0 + 10 * ADIM).toISOString(), 55.5, 100000]);

for (let i = 0; i < satir.length; i += 1200) {
  const d = satir.slice(i, i + 1200);
  const vals = d.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`).join(",");
  await q(
    `insert into device_telemetry (vehicle_id, recorded_at, fuel_level_pct, odometer_km) values ${vals}`,
    d.flat()
  );
}
await q(`analyze device_telemetry`);

// ═══ ŞEMA: 052 → 101 → 102 → 104  (ESKİ HÂL) ═════════════════════════════
await db.exec(govde(m052, "report_fuel_stats_vehicle"));
await db.exec(M101);
await db.exec(M102);
await db.exec(M104);

// 104'ün hâli AYRI ADLA saklanır — 106 onu ezecek.
for (const [ad, yeni] of [
  ["report_fuel_stats_vehicle", "fsv_104"],
  ["report_fuel_stats_vehicle_v2", "fsv2_104"],
]) {
  await db.exec(
    govde(M104, ad).replace(`function public.${ad}(`, `function public.${yeni}(`)
  );
}

// ═══ ŞEMA: 106 (YENİ HÂL) ════════════════════════════════════════════════
await db.exec(M106);

// ═══ DENETİM ALTYAPISI ═══════════════════════════════════════════════════
let gecti = 0;
let kaldi = 0;
const ok = (ad, kosul, not = "") => {
  if (kosul) {
    gecti++;
    console.log(`  ✓ ${ad}${not ? ` — ${not}` : ""}`);
  } else {
    kaldi++;
    console.log(`  ✗ ${ad}${not ? ` — ${not}` : ""}`);
  }
};

const KOLON = [
  "sample_count", "avg_pct", "min_pct", "max_pct", "first_pct", "last_pct",
  "refill_count", "refill_pct", "drop_count", "drop_pct",
];
const kanon = (rows) =>
  rows
    .map(
      (r) =>
        `${r.vehicle_id}|` +
        KOLON.map((k) => (r[k] === null ? "null" : Number(r[k]).toFixed(9))).join("|")
    )
    .join("\n");

const cek = async (fn, f, t) => {
  const out = [];
  for (const [id] of ARACLAR) {
    const r = await q(`select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`, [f, t, id]);
    if (r.rows[0]) out.push(r.rows[0]);
  }
  return out;
};

const an = (i) => new Date(T0 + i * ADIM).toISOString();
const PENCERELER = [
  ["tam aralık", an(0), an(N)],
  ["ilk üçte bir", an(0), an(Math.floor(N / 3))],
  ["orta dilim", an(Math.floor(N / 3)), an(Math.floor((2 * N) / 3))],
  ["son dilim + kuyruk", an(Math.floor(N / 2)), an(N + 50)],
];

async function etiketDurumu(ad) {
  await q(`delete from public.fuel_seri`);
  if (ad === "tam") {
    for (const [id] of ARACLAR)
      await q(`select public.yakit_seri_etiketle($1::timestamptz,$2::timestamptz,$3::uuid)`, [an(0), an(N + 50), id]);
  } else if (ad === "melez") {
    for (const [id] of ARACLAR)
      await q(`select public.yakit_seri_etiketle($1::timestamptz,$2::timestamptz,$3::uuid)`, [an(0), an(Math.floor(N / 2)), id]);
  }
  const { rows } = await q(`select count(*)::int n from public.fuel_seri`);
  return rows[0].n;
}

console.log(`\n═══ 1 · BAYT-BAYT DENKLİK (104 → 106) ═══════════════════════════`);
console.log(`veri: ${satir.length.toLocaleString("tr-TR")} satır · ${ARACLAR.length} araç\n`);
for (const durum of ["tam", "melez", "bos"]) {
  const n = await etiketDurumu(durum);
  for (const [pad, f, t] of PENCERELER) {
    const a1 = await cek("fsv_104", f, t);
    const b1 = await cek("report_fuel_stats_vehicle", f, t);
    const a2 = await cek("fsv2_104", f, t);
    const b2 = await cek("report_fuel_stats_vehicle_v2", f, t);
    const e1 = kanon(a1) === kanon(b1);
    const e2 = kanon(a2) === kanon(b2);
    ok(
      `${durum.padEnd(5)} · ${pad.padEnd(19)} v1 ve v2 eşit`,
      e1 && e2,
      `etiket ${n} · v1 ${a1.length} araç · v2 ${a2.length} araç`
    );
    if (!e1) console.log(`      104: ${kanon(a1)}\n      106: ${kanon(b1)}`);
    if (!e2) console.log(`      104: ${kanon(a2)}\n      106: ${kanon(b2)}`);
  }
}

console.log(`\n═══ 2 · ARIZA ENJEKSİYONU ═══════════════════════════════════════`);
await etiketDurumu("tam");
const ARIZALAR = [
  ["dolum eşiği 5 → 4", (s) => s.replace(/from rises where total_rise >= 5/g, "from rises where total_rise >= 4")],
  ["düşüş eşiği 10 → 9", (s) => s.replace(/prev_fuel - fuel >= 10/g, "prev_fuel - fuel >= 9")],
  ["odometre kapısı kalktı", (s) => s.replace(/\s+and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1/g, "")],
  ["first/last ters çevrildi", (s) => s.replace("(array_agg(fuel order by recorded_at asc))[1]   as first_pct", "(array_agg(fuel order by recorded_at desc))[1]  as first_pct")],
  ["boş seri kapısı kalktı (sample_count > 0)", (s) => s.replace(/where t\.sample_count > 0;/g, ";")],
];
for (const [ad, boz] of ARIZALAR) {
  const bozuk = boz(M106);
  if (bozuk === M106) {
    ok(`arıza: ${ad}`, false, "🔴 ENJEKSİYON TUTMADI — eşleşen metin yok");
    continue;
  }
  await db.exec(bozuk);
  let yakalandi = false;
  for (const [, f, t] of PENCERELER) {
    const a = kanon(await cek("fsv2_104", f, t));
    const b = kanon(await cek("report_fuel_stats_vehicle_v2", f, t));
    const a1 = kanon(await cek("fsv_104", f, t));
    const b1 = kanon(await cek("report_fuel_stats_vehicle", f, t));
    if (a !== b || a1 !== b1) {
      yakalandi = true;
      break;
    }
  }
  ok(`arıza: ${ad}`, yakalandi, yakalandi ? "denklik kırıldı (doğru)" : "🔴 fark edilmedi");
  await db.exec(M106);
}
{
  const a = kanon(await cek("fsv2_104", PENCERELER[0][1], PENCERELER[0][2]));
  const b = kanon(await cek("report_fuel_stats_vehicle_v2", PENCERELER[0][1], PENCERELER[0][2]));
  ok("arızalardan sonra 106 temiz hâline döndü", a === b);
}

console.log(`\n═══ 3 · SÜRE — CANLI ÖLÇEK (68.000 okuma, tek araç) ═════════════`);
{
  const V = "90000000-0000-0000-0000-000000000000";
  await q(`insert into vehicles values ($1,$2)`, [V, "Z-YOGUN"]);
  const BUYUK = 68000;
  const rows = [];
  let fuel = 80;
  let odo = 500000;
  for (let i = 0; i < BUYUK; i++) {
    const t = new Date(T0 + i * 40000).toISOString();
    if (i % 900 === 0 && i > 0) fuel = Math.min(100, fuel + 45);
    else fuel = Math.max(5, fuel - 0.05);
    if (i % 7 === 0) odo += 1;
    rows.push([V, t, Math.round(fuel * 10) / 10, odo]);
  }
  for (let i = 0; i < rows.length; i += 1500) {
    const d = rows.slice(i, i + 1500);
    const vals = d.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`).join(",");
    await q(
      `insert into device_telemetry (vehicle_id, recorded_at, fuel_level_pct, odometer_km) values ${vals}`,
      d.flat()
    );
  }
  await q(`analyze device_telemetry`);
  const F = new Date(T0).toISOString();
  const T = new Date(T0 + BUYUK * 40000).toISOString();
  await q(`select public.yakit_seri_etiketle($1::timestamptz,$2::timestamptz,$3::uuid)`, [F, T, V]);

  const olc = async (fn) => {
    await q(`select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`, [F, T, V]);
    const s = [];
    let row = null;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await q(`select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`, [F, T, V]);
      s.push(performance.now() - t0);
      row = r.rows[0];
    }
    return { m: [...s].sort((a, b) => a - b)[2], row };
  };
  const r104 = await olc("fsv2_104");
  const r106 = await olc("report_fuel_stats_vehicle_v2");
  const w104 = await olc("fsv_104");
  const w106 = await olc("report_fuel_stats_vehicle");
  console.log(`  v2  104 ${String(Math.round(r104.m)).padStart(4)} ms → 106 ${String(Math.round(r106.m)).padStart(4)} ms   (%${Math.round(((r104.m - r106.m) / r104.m) * 100)})`);
  console.log(`  v1  104 ${String(Math.round(w104.m)).padStart(4)} ms → 106 ${String(Math.round(w106.m)).padStart(4)} ms   (%${Math.round(((w104.m - w106.m) / w104.m) * 100)})`);
  ok("yoğun araçta da v2 çıktısı birebir", kanon([r104.row]) === kanon([r106.row]));
  ok("yoğun araçta da v1 çıktısı birebir", kanon([w104.row]) === kanon([w106.row]));
}

console.log(`\n═══ SONUÇ ═══════════════════════════════════════════════════════`);
console.log(`  ${gecti}/${gecti + kaldi} geçti${kaldi ? ` · ${kaldi} KALDI` : ""}\n`);
process.exit(kaldi ? 1 : 0);
