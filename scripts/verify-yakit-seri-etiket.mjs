#!/usr/bin/env node
/**
 * MIGRATION 101 — YAKIT SERİSİ ÖN-ETİKETLEME. DENKLİK KANITI.
 *
 * ═══ NEDEN PGlite, NEDEN CANLI DEĞİL ══════════════════════════════════════
 * Kanıtlanacak şey "101 uygulandıktan sonra çıktı değişmiyor". Bunu canlıda
 * ölçmek için önce canlıya uygulamak gerekir — yani kanıt, kanıtlayacağı
 * riski ALDIKTAN sonra gelir. PGlite (gerçek PostgreSQL, WASM) migration'ı
 * boş bir veritabanına uygular ve ESKİ fonksiyonla YENİSİNİ aynı veri
 * üstünde yan yana koşturur. Docker gerekmez.
 *
 * ⚠️ İKİ FONKSİYON DA DOSYADAN OKUNUYOR, buraya KOPYALANMIYOR:
 *   v1 → db/migrations/052_shift_distance_and_refill_merge.sql
 *   v2 → db/migrations/101_yakit_seri_etiket.sql
 * Kopyalasaydık betik, kodun ne yaptığını değil, kendi kopyasının ne
 * yaptığını doğrulardı.
 *
 * ═══ NE KANITLANIYOR ══════════════════════════════════════════════════════
 *   1. v2 = v1, BAYT-BAYT, dört pencerede (7 gün · 30 gün · gün sınırını
 *      kesen aralık · pencere kenarında sensör çukuru olan aralık).
 *   2. Etiketleme GÜN GÜN koşuyor (cron'un yapacağı gibi) ve buna rağmen
 *      sonuç tek pencereli hesapla aynı — 090'ın reddettiği günlük
 *      parçalama sapması DOĞMUYOR.
 *   3. Aynı veride GÜNLÜK PARÇALAMA hâlâ sapma üretiyor (090 doğrulanıyor) —
 *      yani test, ölçtüğü kusuru gerçekten üretebiliyor.
 *   4. MELEZ OKUMA: yalnız ilk 20 gün etiketliyken 30 günlük sorgu yine
 *      birebir aynı (kuyruk canlı hesaplanıyor).
 *   5. TABLO BOŞKEN v2 = v1 (kill-switch / migration öncesi güvenliği).
 *
 * Kullanım:  npm run verify:yakit-seri-etiket
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");

const m052 = readFileSync(join(KOK, "db/migrations/052_shift_distance_and_refill_merge.sql"), "utf8");
const v1Bas = m052.indexOf("create or replace function public.report_fuel_stats_vehicle(");
if (v1Bas < 0) throw new Error("052'de report_fuel_stats_vehicle bulunamadı");
const V1 = m052.slice(v1Bas, m052.indexOf("$$;", v1Bas) + 3);

// PGlite'ta PostgREST yok; NOTIFY dışında migration OLDUĞU GİBİ uygulanır.
const M101 = readFileSync(join(KOK, "db/migrations/101_yakit_seri_etiket.sql"), "utf8").replace(
  /notify pgrst[^;]*;/g,
  ""
);

let gecen = 0;
const dusen = [];
const ok = (b, k, kanit = "") => {
  if (k) {
    gecen++;
    console.log(`  ✓ ${b}${kanit ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push({ b, kanit });
    console.log(`  ✗ ${b}   [${kanit}]`);
  }
};

const db = await PGlite.create();
const q = (s, p) => db.query(s, p);

// ── Şema: yalnız bu iki fonksiyonun dokunduğu kadarı ──────────────────────
await q(`create table vehicles (id uuid primary key, plate text)`);
await q(`create table device_telemetry (
  id bigserial primary key,
  vehicle_id uuid not null references vehicles(id),
  recorded_at timestamptz not null,
  fuel_level_pct numeric,
  odometer_km numeric,
  unique (vehicle_id, recorded_at)
)`);
await q(V1);
await db.exec(M101);
console.log(`\n═══ PGlite · şema + 052'nin v1'i + migration 101 ═══`);
{
  const r = await q(`select
    (select count(*) from information_schema.tables where table_schema='public' and table_name='fuel_seri')::int tablo,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('yakit_seri_etiketle','report_fuel_stats_vehicle_v2'))::int fn,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='report_fuel_stats_vehicle')::int eski`);
  const x = r.rows[0];
  ok("101 uygulandı: tablo 1 · yeni fonksiyon 2 · ESKİSİ duruyor", x.tablo === 1 && x.fn === 2 && x.eski === 1, `${x.tablo}/${x.fn}/${x.eski}`);
}

// ── SENTETİK SERİ ─────────────────────────────────────────────────────────
/**
 * 3 araç × 30 gün × 5 dakikada bir okuma = 8.640 satır/araç.
 * Kusurlar BİLEREK kondu; testin ölçtüğü kusuru üretebiliyor olması şart:
 *   · tüketim + dolum (4 günde bir, 6 okumada +45 puan)
 *   · tek satırlık sensör çukuru (-25 puan, her 500 okumada)
 *   · GECE YARISINI KESEN dolum (23:50 → 00:10)
 *   · GÜN SINIRINI KESEN ÇOK SATIRLI çukur — küresel seride temizlenir,
 *     gün gün bakıldığında temizlenmez (090 sapmasının kaynağı)
 *   · pencere kenarına denk gelen çukur (uç satır kuralı)
 *   · SİFON: tek adımda -18 puan, odometre artmadan, geri gelmez (drop_*)
 */
const ARAC = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
];
for (let i = 0; i < ARAC.length; i++) {
  await q(`insert into vehicles (id, plate) values ($1,$2)`, [ARAC[i], `TEST-${i + 1}`]);
}

const T0 = Date.parse("2026-08-01T00:00:00Z");
const ADIM = 5 * 60 * 1000;
const GUN = 30;
const GUNLUK = (24 * 60) / 5;

let toplam = 0;
for (let a = 0; a < ARAC.length; a++) {
  const satir = [];
  let fuel = 90 - a * 5;
  let odo = 100000 + a * 5000;
  for (let g = 0; g < GUN; g++) {
    for (let k = 0; k < GUNLUK; k++) {
      const idx = g * GUNLUK + k;
      const t = new Date(T0 + idx * ADIM);
      if (k / 12 >= 6 && k / 12 < 18) {
        fuel -= 0.12 + a * 0.02;
        odo += 0.9;
      }
      if (g % 4 === a % 4 && k >= 17 * 12 && k < 17 * 12 + 6) fuel += 7.5;
      /**
       * ⚠️ EŞİK SINIRINDA DOLUMLAR. Arıza enjeksiyonunda görüldü: yalnız
       * büyük dolumlar varken `total_rise >= 5` eşiğini 6'ya çekmek çıktıyı
       * HİÇ değiştirmiyordu — yani kanıt o eşiği ÖLÇMÜYORDU. Bunlar eşiğin
       * iki yanına oturuyor (5,5 ve 4,5 puan); eşik bir puan oynarsa sonuç
       * değişir ve kanıt kırmızıya döner.
       */
      if (g % 5 === 2 && k === 9 * 12) fuel += 5.5;
      if (g % 5 === 3 && k === 9 * 12) fuel += 4.5;
      /**
       * ⚠️ 15 DAKİKALIK SERİ KOPMASI. İki yükseliş arasında 20 dakikalık
       * boşluk bırakılıyor (aradaki 3 okuma hiç yazılmıyor). Eşik 15'ten
       * başka bir değere çekilirse iki yükseliş tek seri sayılır ve
       * refill_count değişir.
       */
      if (g % 7 === 5 && k >= 11 * 12 + 1 && k <= 11 * 12 + 3) continue;
      if (g % 7 === 5 && (k === 11 * 12 || k === 11 * 12 + 4)) fuel += 4;
      if (a === 1 && ((g === 12 && k >= 287) || (g === 13 && k < 3))) fuel += 6;
      if (fuel < 8) fuel = 8 + Math.abs((idx * 7) % 3);
      if (fuel > 100) fuel = 100;
      let y = fuel;
      if (idx > 0 && idx % 500 === 0) y = Math.max(0, fuel - 25);
      /**
       * ⚠️ PENCERE KENARINA OTURAN ÇOK SATIRLI ÇUKUR — arıza enjeksiyonunda
       * bulundu. Tek satırlık çukur bu kuralı ÖLÇMÜYORDU: pencerenin ilk
       * satırlarından biri tek başına çukurdaysa, pencere içinde kırpılmış
       * geri pencere de yüksek kalıyor ve karar değişmiyordu.
       *
       * 10 okumalık çukur, "pencere KENARINDA çukur" testinin TAM BAŞINA
       * (7. günün 00:00'ı) ve TAM SONUNA (8. günün 23:15'i) oturuyor.
       * Pencere içinde bakıldığında geri/ileri pencere tamamen çukurun
       * içinde kalır → temizlenmez; küresel seride ise komşu günün yüksek
       * satırları görülür → temizlenir. `rn <= 31` düzeltmesi kalkarsa
       * ikisi ayrışır ve kanıt kırmızıya döner.
       */
      if (a === 2 && g === 7 && k <= 9) y = Math.max(0, fuel - 30);
      // Kuyruk çukuru pencerenin SON satırına kadar sürer: içeride ondan
      // sonra yüksek satır kalmazsa ileri pencere de kırpılmış olur.
      if (a === 2 && ((g === 8 && k >= 278) || (g === 9 && k === 0)))
        y = Math.max(0, fuel - 30);
      if (a === 0 && g === 20 && k === 36) {
        fuel -= 18;
        y = fuel;
      }
      if (a === 1 && ((g % 6 === 3 && k >= 286) || (g % 6 === 4 && k <= 2))) {
        y = Math.max(0, fuel - 22);
      }
      satir.push([ARAC[a], t.toISOString(), Number(y.toFixed(2)), Number(odo.toFixed(1))]);
    }
  }
  for (let i = 0; i < satir.length; i += 1000) {
    const d = satir.slice(i, i + 1000);
    const vals = d.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`).join(",");
    await q(`insert into device_telemetry (vehicle_id, recorded_at, fuel_level_pct, odometer_km) values ${vals}`, d.flat());
  }
  toplam += satir.length;
}
console.log(`\nsentetik telemetri: ${toplam} satır · ${ARAC.length} araç · ${GUN} gün · 5 dk aralık`);

/** Cron'un yapacağı şeyin birebir aynısı: gün gün, tekrar çalıştırılabilir. */
async function gunGunEtiketle(ilk, sonGun) {
  let n = 0;
  for (let g = ilk; g < sonGun; g++) {
    const r = await q(`select public.yakit_seri_etiketle($1::timestamptz,$2::timestamptz,null) as n`, [
      new Date(T0 + g * 86400000).toISOString(),
      new Date(T0 + (g + 1) * 86400000 - 1).toISOString(),
    ]);
    n += Number(r.rows[0].n);
  }
  return n;
}

const KOLON = ["sample_count","avg_pct","min_pct","max_pct","first_pct","last_pct","refill_count","refill_pct","drop_count","drop_pct"];
const kanonik = (r) =>
  r === undefined
    ? "SATIR YOK"
    : KOLON.map((k) => `${k}=${r[k] === null ? "null" : Number(r[k]).toPrecision(12)}`).join(" ");

const PENCERELER = [
  ["7 gün", 5, 12],
  ["30 gün (tamamı)", 0, 30],
  ["gün sınırını KESEN dolum", 12.5, 14.5],
  ["pencere KENARINDA çukur", 7, 9],
];

/** v1 ile v2'yi bütün araç × pencere kombinasyonunda kıyaslar. */
async function kiyasla(etiket) {
  for (const [ad, g1, g2] of PENCERELER) {
    const f = new Date(T0 + g1 * 86400000).toISOString();
    const t = new Date(T0 + g2 * 86400000).toISOString();
    let esit = 0;
    let ilkFark = "";
    for (const v of ARAC) {
      const a = await q(`select * from public.report_fuel_stats_vehicle($1::timestamptz,$2::timestamptz,$3::uuid)`, [f, t, v]);
      const b = await q(`select * from public.report_fuel_stats_vehicle_v2($1::timestamptz,$2::timestamptz,$3::uuid)`, [f, t, v]);
      const ka = kanonik(a.rows[0]);
      const kb = kanonik(b.rows[0]);
      if (ka === kb) esit++;
      else if (!ilkFark) ilkFark = `\n      v1: ${ka}\n      v2: ${kb}`;
    }
    ok(
      `${etiket} · ${ad} · v2 = v1 BAYT-BAYT`,
      esit === ARAC.length,
      esit === ARAC.length ? `${esit}/${ARAC.length} araç` : ilkFark
    );
  }
}

// ── 1) TAM ETİKET, GÜN GÜN ÜRETİLMİŞ ──────────────────────────────────────
console.log(`\n────────── 1 · etiket GÜN GÜN üretildi (cron simülasyonu) ──────────`);
const yazilan = await gunGunEtiketle(0, GUN);
const say = await q(`select count(*)::int n from public.fuel_seri`);
ok(
  "30 günlük etiket GÜN GÜN yazıldı",
  say.rows[0].n === toplam && yazilan === toplam,
  `${GUN} çağrı · upsert ${yazilan} · tabloda ${say.rows[0].n}`
);
await kiyasla("tam etiket");

// ── 2) 090 VAKASI ─────────────────────────────────────────────────────────
console.log(`\n────────── 2 · 090 vakası: günlük parçalama vs tek pencere ──────────`);
const f30 = new Date(T0).toISOString();
const t30 = new Date(T0 + GUN * 86400000).toISOString();
let tekV1 = 0;
let tekV2 = 0;
let gunluk = 0;
for (const v of ARAC) {
  const a = await q(`select * from public.report_fuel_stats_vehicle($1::timestamptz,$2::timestamptz,$3::uuid)`, [f30, t30, v]);
  const b = await q(`select * from public.report_fuel_stats_vehicle_v2($1::timestamptz,$2::timestamptz,$3::uuid)`, [f30, t30, v]);
  tekV1 += Number(a.rows[0]?.refill_pct ?? 0);
  tekV2 += Number(b.rows[0]?.refill_pct ?? 0);
  for (let g = 0; g < GUN; g++) {
    const d = await q(`select * from public.report_fuel_stats_vehicle($1::timestamptz,$2::timestamptz,$3::uuid)`, [
      new Date(T0 + g * 86400000).toISOString(),
      new Date(T0 + (g + 1) * 86400000).toISOString(),
      v,
    ]);
    gunluk += Number(d.rows[0]?.refill_pct ?? 0);
  }
}
const sapmaGunluk = ((gunluk - tekV1) / tekV1) * 100;
const sapmaV2 = ((tekV2 - tekV1) / tekV1) * 100;
console.log(`     tek pencere v1 : ${tekV1.toFixed(2)} puan dolum`);
console.log(`     GÜNLÜK toplam  : ${gunluk.toFixed(2)}  → sapma %${sapmaGunluk.toFixed(1)}   ← 090'ın REDDETTİĞİ yol`);
console.log(`     tek pencere v2 : ${tekV2.toFixed(2)}  → sapma %${sapmaV2.toFixed(6)}   ← 101`);
ok(
  "🔑 GÜNLÜK ÖZET sapma ÜRETİYOR — test ölçtüğü kusuru üretebiliyor (090 doğrulandı)",
  Math.abs(sapmaGunluk) > 0.5,
  `%${sapmaGunluk.toFixed(1)}`
);
ok(
  "🔑 101 sapma ÜRETMİYOR — etiket gün gün yazıldığı HÂLDE",
  Math.abs(sapmaV2) < 1e-9,
  `%${sapmaV2.toFixed(6)}`
);

// ── 3) MELEZ OKUMA: yalnız ilk 20 gün etiketli ────────────────────────────
console.log(`\n────────── 3 · melez okuma (ilk 20 gün etiketli, kalanı canlı) ──────────`);
await q(`truncate public.fuel_seri`);
await gunGunEtiketle(0, 20);
const kismi = await q(`select count(*)::int n, max(recorded_at) son from public.fuel_seri`);
console.log(`     etiketli ${kismi.rows[0].n} satır · son ${String(kismi.rows[0].son).slice(0, 16)} (10 gün ETİKETSİZ)`);
await kiyasla("melez");

// ── 4) TABLO BOŞ: v2 tamamen canlı ────────────────────────────────────────
console.log(`\n────────── 4 · etiket tablosu BOŞ (migration öncesi / kill-switch) ──────────`);
await q(`truncate public.fuel_seri`);
await kiyasla("boş tablo");

// ── 5) TEKRAR ÇALIŞTIRILABİLİRLİK ─────────────────────────────────────────
console.log(`\n────────── 5 · idempotans ──────────`);
await gunGunEtiketle(0, GUN);
/**
 * ⚠️ Toplam `numeric`e YUVARLANARAK alınıyor. `sum(double precision)`
 * kayan nokta toplamı olduğu için tarama sırasına göre son basamakta
 * oynayabiliyor ve idempotans denetimi kendi ölçüm gürültüsüne düşüyordu
 * (PGlite'ta birebir bu görüldü: satır sayısı aynı, toplam farklı).
 */
const ilkHal = await q(`select count(*)::int n, sum(round(bwd_max::numeric,6)) b, sum(round(fwd_max::numeric,6)) f from public.fuel_seri`);
await gunGunEtiketle(0, GUN);
const ikinciHal = await q(`select count(*)::int n, sum(round(bwd_max::numeric,6)) b, sum(round(fwd_max::numeric,6)) f from public.fuel_seri`);
ok(
  "aynı gün ikinci kez etiketlenince satır ve değerler DEĞİŞMİYOR",
  ilkHal.rows[0].n === ikinciHal.rows[0].n &&
    String(ilkHal.rows[0].b) === String(ikinciHal.rows[0].b) &&
    String(ilkHal.rows[0].f) === String(ikinciHal.rows[0].f),
  `${ilkHal.rows[0].n} → ${ikinciHal.rows[0].n} satır · Σbwd ${ilkHal.rows[0].b} → ${ikinciHal.rows[0].b}`
);

// ── 6) GERİ ALMA ──────────────────────────────────────────────────────────
console.log(`\n────────── 6 · geri alma ──────────`);
await db.exec(`
  drop function if exists public.report_fuel_stats_vehicle_v2(timestamptz, timestamptz, uuid);
  drop function if exists public.yakit_seri_etiketle(timestamptz, timestamptz, uuid);
  drop view if exists public.fuel_seri_kapsama;
  drop table if exists public.fuel_seri;
`);
{
  const r = await q(`select
    (select count(*) from information_schema.tables where table_schema='public' and table_name='fuel_seri')::int tablo,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='report_fuel_stats_vehicle')::int eski,
    (select count(*) from device_telemetry)::int ham`);
  const x = r.rows[0];
  ok(
    "geri alma: 101 tamamen kalktı · ESKİ fonksiyon ve HAM veri sağlam",
    x.tablo === 0 && x.eski === 1 && x.ham === toplam,
    `tablo ${x.tablo} · eski ${x.eski} · ham ${x.ham}`
  );
  const a = await q(`select * from public.report_fuel_stats_vehicle($1::timestamptz,$2::timestamptz,$3::uuid)`, [f30, t30, ARAC[0]]);
  ok("geri alındıktan sonra eski yol hâlâ çalışıyor", a.rows.length === 1, `${a.rows[0]?.sample_count} satır`);
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} yakıt seri etiketi: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
