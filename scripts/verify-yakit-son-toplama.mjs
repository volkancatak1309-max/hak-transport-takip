#!/usr/bin/env node
/**
 * MIGRATION 106 + 107 — SON TOPLAMA TEK GEÇİŞ + `zero_count`. DENKLİK KANITI.
 *
 * ═══ NE KANITLANIYOR ══════════════════════════════════════════════════════
 *   1. 107'nin `report_fuel_stats_vehicle` ve `_v2`si, 104'teki hâlleriyle
 *      BAYT-BAYT aynı: 4 pencere × 3 etiket durumu × her araç × 11 kolon.
 *      (107 = 106'nın gövdeleri + 12. kolon `zero_count`.)
 *   2. Etiket durumları: TAM etiket · MELEZ (ilk yarı etiketli) · BOŞ tablo.
 *      v2'nin melez okuması 106'dan etkilenmiyor.
 *   3. ARIZA ENJEKSİYONU: yeni kuyruğun her bir toplayıcısını boz —
 *      denklik KIRILMALI. Kırılmıyorsa test boştur.
 *   4. `zero_count` = UYGULAMANIN ESKİ SAYIMI. Aynı aralık, aynı araç için
 *      `count(*) where fuel_level_pct = 0` ile birebir eşit mi.
 *   5. SÜRE: canlı ölçekte (68.000 yakıt okuması = demo/HAK61'in en yoğun
 *      aracının 30 günü) 106/107 ne kadar kazandırıyor — ÖLÇÜLÜR, iddia edilmez.
 *      `zero_count` eklemenin maliyeti de ayrıca ölçülüyor (kısmi indeks
 *      gerekip gerekmediği sorusunun cevabı).
 *
 * ⚠️ GÖVDELERİN İKİSİ DE DOSYADAN OKUNUYOR, buraya KOPYALANMIYOR:
 *   104 → db/migrations/104_yuzde_odo_kapisi_hizalama.sql   (eski hâl)
 *   106 → db/migrations/106_yakit_son_toplama.sql           (tek geçiş)
 *   107 → db/migrations/107_yakit_sifir_sayimi.sql          (+ zero_count)
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
const M107 = temizle(oku("107_yakit_sifir_sayimi.sql"));

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
// 107 = 106 + zero_count. Ikisi de uygulaniyor: yeni bir kiracida kurulum
// sirasi tam olarak budur (106 create or replace, 107 drop + create).
await db.exec(M106);
// 106'nın hâli de ayrı adla saklanır: "tek geçiş" ile "tek geçiş + zero_count"
// arasındaki farkı ölçebilmek için (kısmi indeks gerekiyor mu sorusu).
for (const [ad, yeni] of [
  ["report_fuel_stats_vehicle", "fsv_106"],
  ["report_fuel_stats_vehicle_v2", "fsv2_106"],
]) {
  await db.exec(
    govde(M106, ad).replace(`function public.${ad}(`, `function public.${yeni}(`)
  );
}
await db.exec(M107);

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

/**
 * `zero_count` 11 kolonluk kanona GİRMİYOR (104'te o kolon yok). Bu yüzden
 * onu bozan bir arıza, 104 ↔ 107 kıyasıyla YAKALANAMAZ. Ayrı dedektör:
 * RPC'nin sayımı, uygulamanın ESKİ sorgusuyla birebir eşit mi.
 */
async function sifirSapmasiVarMi(f, t) {
  for (const fn of ["report_fuel_stats_vehicle", "report_fuel_stats_vehicle_v2"]) {
    for (const [id] of ARACLAR) {
      const r = await q(
        `select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`,
        [f, t, id]
      );
      if (!r.rows[0]) continue;
      const eski = await q(
        `select count(*)::bigint as n from public.device_telemetry
          where vehicle_id = $3::uuid and fuel_level_pct = 0
            and recorded_at >= $1::timestamptz and recorded_at <= $2::timestamptz`,
        [f, t, id]
      );
      if (Number(r.rows[0].zero_count) !== Number(eski.rows[0].n)) return true;
    }
  }
  return false;
}

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

console.log(`\n═══ 1b · zero_count = UYGULAMANIN ESKİ SAYIMI ══════════════`);
/**
 * Eski yol: `.eq(vehicle_id).eq(fuel_level_pct, 0).gte(from).lte(to)` — HAM
 * satırlar, de-glitch ÖNCESİ. Burada birebir o sorgu çalıştırılıp RPC'nin
 * `zero_count`u ile karşılaştırılıyor.
 */
await etiketDurumu("tam");
for (const [pad, f, t] of PENCERELER) {
  for (const fn of ["report_fuel_stats_vehicle", "report_fuel_stats_vehicle_v2"]) {
    let uyan = 0;
    let bakilan = 0;
    let toplamRpc = 0;
    let toplamEski = 0;
    for (const [id, plate] of ARACLAR) {
      const r = await q(
        `select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`,
        [f, t, id]
      );
      if (!r.rows[0]) continue;
      bakilan++;
      const eski = await q(
        `select count(*)::bigint as n from public.device_telemetry
          where vehicle_id = $3::uuid and fuel_level_pct = 0
            and recorded_at >= $1::timestamptz and recorded_at <= $2::timestamptz`,
        [f, t, id]
      );
      const a = Number(r.rows[0].zero_count);
      const b = Number(eski.rows[0].n);
      toplamRpc += a;
      toplamEski += b;
      if (a === b) uyan++;
      else console.log(`      ${plate}: rpc ${a} · eski ${b}`);
    }
    ok(
      `zero_count · ${fn === "report_fuel_stats_vehicle" ? "v1" : "v2"} · ${pad}`,
      uyan === bakilan && bakilan > 0,
      `${uyan}/${bakilan} araç · Σ rpc ${toplamRpc} = eski ${toplamEski}`
    );
  }
}

console.log(`\n═══ 1c · YANIT SÖZLEŞMESİ (uygulama neye bakarak karar veriyor) ══`);
/**
 * `lib/reports.ts` şu tek satırla karar veriyor:
 *     const sifirKolonuVar = statRows.some((r) => r.zero_count !== undefined);
 * Yani bayrağa değil YANITIN KENDİSİNE bakıyor. Bu bölüm o sözleşmeyi
 * veritabanı tarafında donduruyor: 104'ün hâli kolonu TAŞIMAMALI, 107'ninki
 * TAŞIMALI. Biri bozulursa uygulama sessizce yanlış yola girer.
 */
{
  const [, f, t] = PENCERELER[0];
  const eski = await q(
    `select * from public.fsv2_104($1::timestamptz,$2::timestamptz,$3::uuid)`,
    [f, t, ARACLAR[0][0]]
  );
  const yeni = await q(
    `select * from public.report_fuel_stats_vehicle_v2($1::timestamptz,$2::timestamptz,$3::uuid)`,
    [f, t, ARACLAR[0][0]]
  );
  ok(
    "104'ün yanıtında `zero_count` YOK → uygulama ESKİ 19 sorguya düşer",
    eski.rows[0] !== undefined && eski.rows[0].zero_count === undefined,
    `kolonlar: ${Object.keys(eski.rows[0] ?? {}).length}`
  );
  ok(
    "107'nin yanıtında `zero_count` VAR → uygulama yanıttan okur",
    yeni.rows[0] !== undefined && yeni.rows[0].zero_count !== undefined,
    `kolonlar: ${Object.keys(yeni.rows[0] ?? {}).length}`
  );
  ok(
    "11 kolonun ADLARI ve SIRASI değişmedi, `zero_count` SONA eklendi",
    JSON.stringify(Object.keys(yeni.rows[0] ?? {})) ===
      JSON.stringify([...Object.keys(eski.rows[0] ?? {}), "zero_count"]),
    Object.keys(yeni.rows[0] ?? {}).join(",")
  );
}

console.log(`\n═══ 2 · ARIZA ENJEKSİYONU ═══════════════════════════════════════`);
await etiketDurumu("tam");
const ARIZALAR = [
  ["dolum eşiği 5 → 4", (s) => s.replace(/from rises where total_rise >= 5/g, "from rises where total_rise >= 4")],
  ["düşüş eşiği 10 → 9", (s) => s.replace(/prev_fuel - fuel >= 10/g, "prev_fuel - fuel >= 9")],
  ["odometre kapısı kalktı", (s) => s.replace(/\s+and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1/g, "")],
  ["first/last ters çevrildi", (s) => s.replace("(array_agg(fuel order by recorded_at asc))[1]   as first_pct", "(array_agg(fuel order by recorded_at desc))[1]  as first_pct")],
  ["boş seri kapısı kalktı (sample_count > 0)", (s) => s.replace(/where t\.sample_count > 0;/g, ";")],
  [
    "zero_count TEMİZ seriden sayarsın (ham yerine)",
    (s) => s.replace(/from base where fuel = 0/g, "from stepped where fuel = 0"),
  ],
  [
    "zero_count yanlış değer sayarsın (0 yerine 5)",
    (s) => s.replace(/from base where fuel = 0/g, "from base where fuel = 5"),
  ],
];
for (const [ad, boz] of ARIZALAR) {
  const bozuk = boz(M107);
  if (bozuk === M107) {
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
    // 11 kolon kıyası + zero_count dedektörü: ikisinden biri bile kırılsa yeter.
    if (a !== b || a1 !== b1 || (await sifirSapmasiVarMi(f, t))) {
      yakalandi = true;
      break;
    }
  }
  ok(`arıza: ${ad}`, yakalandi, yakalandi ? "denklik kırıldı (doğru)" : "🔴 fark edilmedi");
  await db.exec(M107);
}
{
  const a = kanon(await cek("fsv2_104", PENCERELER[0][1], PENCERELER[0][2]));
  const b = kanon(await cek("report_fuel_stats_vehicle_v2", PENCERELER[0][1], PENCERELER[0][2]));
  ok("arızalardan sonra 107 temiz hâline döndü", a === b && !(await sifirSapmasiVarMi(PENCERELER[0][1], PENCERELER[0][2])));
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

  /**
   * ⚠️ DÖNÜŞÜMLÜ ÖLÇÜM. PGlite (WASM) türbülanslı: peş peşe 7 koşum alsak
   * sıranın kendisi sonucu kaydırıyor (ölçüldü: aynı gövde 335–450 ms arası
   * oynadı). Bu yüzden altı gövde TUR TUR, dönüşümlü koşuluyor ve her biri
   * için medyan alınıyor — sürüklenme hepsine eşit dağılır.
   */
  const ADAYLAR = [
    ["v2 · 104 (onbir alt sorgu)", "fsv2_104"],
    ["v2 · 106 (tek geçiş)", "fsv2_106"],
    ["v2 · 107 (+ zero_count)", "report_fuel_stats_vehicle_v2"],
    ["v1 · 104 (onbir alt sorgu)", "fsv_104"],
    ["v1 · 106 (tek geçiş)", "fsv_106"],
    ["v1 · 107 (+ zero_count)", "report_fuel_stats_vehicle"],
  ];
  const olcum = {};
  const satirlar = {};
  for (const [, fn] of ADAYLAR) {
    olcum[fn] = [];
    await q(`select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`, [F, T, V]);
  }
  for (let tur = 0; tur < 9; tur++) {
    for (const [, fn] of ADAYLAR) {
      const t0 = performance.now();
      const r = await q(
        `select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`,
        [F, T, V]
      );
      olcum[fn].push(performance.now() - t0);
      satirlar[fn] = r.rows[0];
    }
  }
  const med9 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const sonuc = {};
  for (const [etiket, fn] of ADAYLAR) {
    sonuc[fn] = { m: med9(olcum[fn]), row: satirlar[fn] };
    console.log(`  ${etiket.padEnd(30)} ${String(Math.round(sonuc[fn].m)).padStart(4)} ms`);
  }
  console.log(
    `  ${"— 104 → 106 (tek geçiş)".padEnd(30)} v2 %${Math.round(((sonuc.fsv2_104.m - sonuc.fsv2_106.m) / sonuc.fsv2_104.m) * 100)}` +
      ` · v1 %${Math.round(((sonuc.fsv_104.m - sonuc.fsv_106.m) / sonuc.fsv_104.m) * 100)}`
  );
  const zEk2 = sonuc["report_fuel_stats_vehicle_v2"].m - sonuc.fsv2_106.m;
  const zEk1 = sonuc["report_fuel_stats_vehicle"].m - sonuc.fsv_106.m;
  console.log(
    `  ${"— zero_count'un EK maliyeti".padEnd(30)} v2 ${zEk2 >= 0 ? "+" : ""}${Math.round(zEk2)} ms` +
      ` · v1 ${zEk1 >= 0 ? "+" : ""}${Math.round(zEk1)} ms`
  );

  /**
   * ══ KISMİ İNDEKS GEREKİR Mİ? — SAATİN DEĞİL PLANIN CEVABI ══════════
   *
   * 🔴 PGlite'ın saati bu soruyu ÇÖZEMİYOR: aynı gövde ardışık turlarda
   * 335–450 ms arası oynuyor (WASM), ve buradaki "ayrı sayım sorgusu" 8 ms
   * çıkıyor çünkü veritabanı bellekte ve küçük — canlıda aynı sorgu 179 ms.
   * Yani süre karşılaştırması buradan YAPILAMAZ.
   *
   * Cevaplanabilen şey YAPISAL: `zero_count` `base` CTE'sinden geliyor, yani
   * `device_telemetry`ye İKİNCİ BİR ERİŞİM AÇMIYOR. Bunu plan söyler.
   * Denetim: 106 ile 107'nin planlarında `device_telemetry` tarama düğümü
   * SAYISI eşit olmalı, ve 107'de `sifir` CTE'si `base`i taramalı.
   */
  const planSatirlari = async (fn) => {
    const r = await q(
      `explain select * from public.${fn}($1::timestamptz,$2::timestamptz,$3::uuid)`,
      [F, T, V]
    );
    return r.rows.map((x) => x["QUERY PLAN"]);
  };
  const taramaSayisi = (satirlar) =>
    satirlar.filter((x) => /Scan\b.*\bdevice_telemetry\b/.test(x)).length;

  const plan106 = await planSatirlari("fsv2_106");
  const plan107 = await planSatirlari("report_fuel_stats_vehicle_v2");
  ok(
    "107, device_telemetry'ye ek erişim AÇMIYOR (106 ile aynı tarama sayısı)",
    taramaSayisi(plan106) === taramaSayisi(plan107),
    `106 ${taramaSayisi(plan106)} tarama · 107 ${taramaSayisi(plan107)} tarama`
  );
  ok(
    "107'de `base` MADDELEŞTİ — iki tüketici, tek tablo taraması",
    plan107.filter((x) => /CTE Scan on base/.test(x)).length >= 1 &&
      taramaSayisi(plan106) === taramaSayisi(plan107),
    `106 ${plan106.filter((x) => /CTE Scan on base/.test(x)).length} · 107 ${plan107.filter((x) => /CTE Scan on base/.test(x)).length} CTE taraması (106'da base tek tüketicili, satır içi açılıyor)`
  );

  ok("yoğun araçta v2 çıktısı (11 kolon) birebir", kanon([sonuc.fsv2_104.row]) === kanon([sonuc["report_fuel_stats_vehicle_v2"].row]));
  ok("yoğun araçta v1 çıktısı (11 kolon) birebir", kanon([sonuc.fsv_104.row]) === kanon([sonuc["report_fuel_stats_vehicle"].row]));
}

console.log(`\n═══ SONUÇ ═══════════════════════════════════════════════════════`);
console.log(`  ${gecti}/${gecti + kaldi} geçti${kaldi ? ` · ${kaldi} KALDI` : ""}\n`);
process.exit(kaldi ? 1 : 0);
