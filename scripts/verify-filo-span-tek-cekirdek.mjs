#!/usr/bin/env node
/**
 * MIGRATION 105 — ODOMETRE AÇIKLIĞI TEK ÇEKİRDEK. DENKLİK KANITI.
 *
 * ═══ NE KANITLANIYOR ══════════════════════════════════════════════════════
 *   1. 105'in `fleet_odometer_spans`i = 097'ninki, BAYT-BAYT, dört pencerede
 *      (7 gün · 30 gün · gün sınırını kesen · pencere kenarında bozuk okuma).
 *      Yani LATERAL'e geçiş SAYIYI DEĞİŞTİRMİYOR.
 *   2. TEK ÇEKİRDEK: her araç için `vehicle_odometer_span(...)` çıktısı, filo
 *      sürümünün o araç satırıyla BİREBİR aynı. (16c'nin asıl derdi buydu:
 *      yedek yol farklı kural uyguluyordu.)
 *   3. BİLİNEN VE BİLEREK olan tek fark: `device_telemetry`de olup
 *      `vehicles`te olmayan araç 105'te çıktıya GİRMEZ, 097'de girerdi.
 *      Test bunu ölçer ve BEKLENEN fark olarak raporlar.
 *   4. ARIZA ENJEKSİYONU: 105'in gövdesindeki kuralın dört ayrı yerini boz,
 *      her birinde denklik testi KIRILMALI. Kırılmıyorsa test boştur.
 *
 * ⚠️ İKİ GÖVDE DE DOSYADAN OKUNUYOR, buraya KOPYALANMIYOR:
 *   097 → db/migrations/097_odometre_blok_ve_filo_span.sql
 *   105 → db/migrations/105_filo_span_tek_cekirdek.sql
 * Kopyalasaydık betik, kodun ne yaptığını değil kendi kopyasının ne yaptığını
 * doğrulardı.
 *
 * Kullanım:  npm run verify:filo-span
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (f) => readFileSync(join(KOK, "db/migrations", f), "utf8");
const temizle = (x) => x.replace(/notify pgrst[^;]*;/g, "");

// ── 097'nin filo gövdesi: ADI DEĞİŞTİRİLİR, gövde birebir kalır ───────────
const m097 = oku("097_odometre_blok_ve_filo_span.sql");
const b097 = m097.indexOf("create or replace function public.fleet_odometer_spans(");
if (b097 < 0) throw new Error("097'de fleet_odometer_spans bulunamadı");
const S097 = m097
  .slice(b097, m097.indexOf("$$;", b097) + 3)
  .replace("function public.fleet_odometer_spans(", "function public.spans_097(");

const M105_HAM = temizle(oku("105_filo_span_tek_cekirdek.sql"));

const db = await PGlite.create();
const q = (s, p) => db.query(s, p);

await db.exec(`
  create table vehicles (id uuid primary key, plate text);
  create table device_telemetry (
    id bigserial primary key,
    vehicle_id uuid not null,
    recorded_at timestamptz not null,
    odometer_km numeric,
    unique (vehicle_id, recorded_at)
  );
  create index idx_dt_vehicle_odo on device_telemetry (vehicle_id, recorded_at)
    include (odometer_km) where odometer_km is not null;
`);

// ═══ VERİ — her araç AYRI bir patoloji ════════════════════════════════════
const T0 = Date.UTC(2026, 6, 1); // 01.07.2026 00:00 UTC
const an = (dk) => new Date(T0 + dk * 60000).toISOString();
const ARACLAR = [
  ["10000000-0000-0000-0000-000000000000", "V1-TEMIZ", "düzgün artan"],
  ["20000000-0000-0000-0000-000000000000", "V2-SIFIR13", "13 ardışık sıfır (097'nin DO-505GS vakası)"],
  ["30000000-0000-0000-0000-000000000000", "V3-ILKSIFIR", "ilk okuma 0 (demo W-GF-107 vakası)"],
  ["40000000-0000-0000-0000-000000000000", "V4-SICRAMA", "ortada +90.000 fiziksel atlama"],
  ["50000000-0000-0000-0000-000000000000", "V5-GERI", "sayaç geri sayıyor"],
  ["60000000-0000-0000-0000-000000000000", "V6-BOS", "odometresi tamamen null"],
  ["70000000-0000-0000-0000-000000000000", "V7-TELEMETRISIZ", "vehicles'ta var, telemetrisi yok"],
  ["90000000-0000-0000-0000-000000000000", "V8-BANT", "25. gunde +500 km sicrama (2 saatlik blok araligi -> kapi 200 ile sinir 400, eler; 400 ile 800, elemez) — kapi BANDINDA (200 eler, 400 elemez)"],
];
const HAYALET = "80000000-0000-0000-0000-000000000000"; // vehicles'TA YOK
for (const [id, plate] of ARACLAR) {
  await q(`insert into vehicles (id, plate) values ($1,$2)`, [id, plate]);
}

const satirlar = [];
const ek = (vid, dk, odo) => satirlar.push([vid, an(dk), odo]);
const GUN = 1440;
// 45 gün × saatte 1 okuma
for (let s = 0; s < 45 * 24; s++) {
  const dk = s * 60;
  const ilerleme = Math.floor(s / 2); // ~12 km/gün, ardışık EŞİT değerler doğar
  ek(ARACLAR[0][0], dk, 100000 + ilerleme);
  // V2: 12. günün ilk 13 saatinde 0
  ek(ARACLAR[1][0], dk, s >= 12 * 24 && s < 12 * 24 + 13 ? 0 : 200000 + ilerleme);
  // V3: yalnız ilk okuma 0
  ek(ARACLAR[2][0], dk, s === 0 ? 0 : 300000 + ilerleme);
  // V4: 20. günün 5. saatinde +90.000
  ek(ARACLAR[3][0], dk, s === 20 * 24 + 5 ? 400000 + ilerleme + 90000 : 400000 + ilerleme);
  // V5: 30. günden sonra sayaç sıfırlanıp yeniden başlıyor (cihaz değişimi)
  ek(ARACLAR[4][0], dk, s < 30 * 24 ? 500000 + ilerleme : 1000 + ilerleme);
  ek(ARACLAR[5][0], dk, null);
  // V8: 25. gunden itibaren taban +500 — blok araligi 2 saat oldugu icin
  // kapi siniri 400 (200 x 2sa). 501 > 400 -> ONCEKI blok basi elenir; 400
  // katsayisiyla sinir 800 olur ve elenmez. Ayirt edici vaka budur.
  ek(ARACLAR[7][0], dk, 600000 + ilerleme + (s >= 25 * 24 ? 500 : 0));
  ek(HAYALET, dk, 900000 + ilerleme);
}
// Pencere KENARINDA bozuk okuma: 7. günün son dakikası ve 30. günün ilk dakikası
ek(ARACLAR[0][0], 7 * GUN - 1, 0);
ek(ARACLAR[0][0], 30 * GUN + 1, 0);
// Pencere sinirinda TAM oturan satir ZATEN VAR (s=720 -> an(30*GUN)); `< p_to`
// onu eler. Ariza enjeksiyonundaki `<= p_to` vakasi tam bu satirdan yakalanir.

for (let i = 0; i < satirlar.length; i += 1500) {
  const d = satirlar.slice(i, i + 1500);
  const vals = d.map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`).join(",");
  await q(
    `insert into device_telemetry (vehicle_id, recorded_at, odometer_km) values ${vals}`,
    d.flat()
  );
}
await q(`analyze device_telemetry`);

await db.exec(S097);
await db.exec(M105_HAM);

const PENCERELER = [
  ["7 gün", an(0), an(7 * GUN)],
  ["30 gün", an(0), an(30 * GUN)],
  ["gün sınırını kesen (3,5 → 18,5)", an(3.5 * GUN), an(18.5 * GUN)],
  ["kenarında bozuk okuma (6 → 31)", an(6 * GUN), an(31 * GUN)],
];

const kanon = (rows) =>
  rows
    .map(
      (r) =>
        `${r.vehicle_id}|${r.odometre_ilk}|${r.odometre_son}|` +
        `${new Date(r.ilk_an).toISOString()}|${new Date(r.son_an).toISOString()}|` +
        `${r.okuma_sayisi}|${r.temiz_sayisi}`
    )
    .join("\n");

const VEH = new Set(ARACLAR.map((a) => a[0]));
const sadeceKadro = (rows) => rows.filter((r) => VEH.has(String(r.vehicle_id)));

async function cek(fn, f, t) {
  const r = await q(
    `select * from public.${fn}($1::timestamptz,$2::timestamptz) order by vehicle_id`,
    [f, t]
  );
  return r.rows;
}

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

console.log(`\n═══ 1 · BAYT-BAYT DENKLİK (097 → 105) ═══════════════════════════`);
console.log(`veri: ${satirlar.length.toLocaleString("tr-TR")} satır · ${ARACLAR.length} araç + 1 hayalet\n`);
for (const [ad, f, t] of PENCERELER) {
  const a = sadeceKadro(await cek("spans_097", f, t));
  const b = sadeceKadro(await cek("fleet_odometer_spans", f, t));
  const esit = kanon(a) === kanon(b);
  ok(`pencere: ${ad}`, esit, `${a.length} araç · ${b.length} araç`);
  if (!esit) {
    const x = kanon(a).split("\n");
    const y = kanon(b).split("\n");
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] !== y[i]) console.log(`      097: ${x[i]}\n      105: ${y[i]}`);
    }
  }
}

console.log(`\n═══ 2 · TEK ÇEKİRDEK (filo satırı = araç satırı) ════════════════`);
for (const [ad, f, t] of PENCERELER) {
  const filo = new Map(
    sadeceKadro(await cek("fleet_odometer_spans", f, t)).map((r) => [String(r.vehicle_id), r])
  );
  let uyan = 0;
  let toplam = 0;
  for (const [id, plate] of ARACLAR) {
    const tek = await q(
      `select * from public.vehicle_odometer_span($1::timestamptz,$2::timestamptz,$3::uuid)`,
      [f, t, id]
    );
    const a = filo.get(id);
    const b = tek.rows[0];
    toplam++;
    const esit = (!a && !b) || (a && b && kanon([a]) === kanon([b]));
    if (esit) uyan++;
    else console.log(`      ${plate}: filo ${a ? kanon([a]) : "—"} · araç ${b ? kanon([b]) : "—"}`);
  }
  ok(`tek çekirdek: ${ad}`, uyan === toplam, `${uyan}/${toplam} araç birebir`);
}

console.log(`\n═══ 3 · BİLİNEN TEK DAVRANIŞ FARKI ══════════════════════════════`);
{
  const [, f, t] = PENCERELER[1];
  const a097 = await cek("spans_097", f, t);
  const a105 = await cek("fleet_odometer_spans", f, t);
  const h097 = a097.some((r) => String(r.vehicle_id) === HAYALET);
  const h105 = a105.some((r) => String(r.vehicle_id) === HAYALET);
  ok(
    "vehicles'ta olmayan araç: 097 döndürür, 105 döndürmez",
    h097 === true && h105 === false,
    `097 ${h097 ? "var" : "yok"} · 105 ${h105 ? "var" : "yok"} (BEKLENEN, migration başlığında yazılı)`
  );
  const bos = a105.some((r) => String(r.vehicle_id) === ARACLAR[6][0]);
  ok("telemetrisi olmayan araç iki tarafta da satır ÜRETMEZ", bos === false);
  const nullOdo = a105.some((r) => String(r.vehicle_id) === ARACLAR[5][0]);
  ok("odometresi tamamen null olan araç satır ÜRETMEZ", nullOdo === false);
}

console.log(`\n═══ 4 · ARIZA ENJEKSİYONU (kural bozulursa test KIRILMALI) ══════`);
const ARIZALAR = [
  ["kapı katsayısı 200 → 400", (s) => s.replace("/ 3600.0 * 200)", "/ 3600.0 * 400)")],
  ["kapı tamamen kaldırıldı", (s) => s.replace(/from kapili\n    where sonraki_km is null[\s\S]*?\* 200\)\n  \)/, "from kapili\n  )")],
  [
    "blok başı indirgemesi kaldırıldı",
    (s) => s.replace("where onc_km is null or odometer_km <> onc_km", "where true"),
  ],
  [
    "monotonluk filtresi kaldırıldı",
    (s) => s.replace("from monoton where kosan_max is null or odometer_km >= kosan_max", "from monoton"),
  ],
  [
    "zaman yüklemi < p_to → <= p_to",
    (s) => s.replace("dt.recorded_at >= p_from and dt.recorded_at < p_to", "dt.recorded_at >= p_from and dt.recorded_at <= p_to"),
  ],
  [
    "zaman yüklemi >= p_from → > p_from",
    (s) => s.replace("dt.recorded_at >= p_from and dt.recorded_at < p_to", "dt.recorded_at > p_from and dt.recorded_at < p_to"),
  ],
  [
    "null odometre filtresi kaldırıldı",
    (s) => s.replace("      and dt.odometer_km is not null\n", ""),
  ],
];
for (const [ad, boz] of ARIZALAR) {
  const bozuk = boz(M105_HAM);
  if (bozuk === M105_HAM) {
    ok(`arıza: ${ad}`, false, "🔴 ENJEKSİYON TUTMADI — eşleşen metin yok, test boş");
    continue;
  }
  await db.exec(bozuk);
  let yakalandi = false;
  for (const [, f, t] of PENCERELER) {
    const a = sadeceKadro(await cek("spans_097", f, t));
    const b = sadeceKadro(await cek("fleet_odometer_spans", f, t));
    if (kanon(a) !== kanon(b)) {
      yakalandi = true;
      break;
    }
  }
  ok(`arıza: ${ad}`, yakalandi, yakalandi ? "denklik kırıldı (doğru)" : "🔴 fark edilmedi");
  await db.exec(M105_HAM); // geri al
}
// Geri alma gerçekten oldu mu?
{
  const [, f, t] = PENCERELER[1];
  const a = sadeceKadro(await cek("spans_097", f, t));
  const b = sadeceKadro(await cek("fleet_odometer_spans", f, t));
  ok("arızalardan sonra 105 temiz hâline döndü", kanon(a) === kanon(b));
}

console.log(`\n═══ 5 · GÖZLENEMEYEN DEĞİŞİKLİK (ölçüldü, iddia edilmedi) ═══`);
/**
 * `odometer_km >= kosan_max` → `> kosan_max` bir ARIZA ENJEKSİYONU DEĞİLDİR:
 * blok başı indirgemesi onu soğurur. `>=` eşit satırı geçirir, sonra
 * `odometer_km <> onc_km` onu zaten atar; `>` ise aynı satırı bir adım önce atar.
 * Kalan küme aynı. Bunu ARIZA listesine koyarsak test SAHTE bir boşluk raporlar;
 * koymayıp sessiz geçersek de kimse neden olmadığını bilmez. Ölçüp yazıyoruz.
 */
{
  const bozuk = M105_HAM.replace(
    "kosan_max is null or odometer_km >= kosan_max",
    "kosan_max is null or odometer_km > kosan_max"
  );
  ok("`>=` → `>` metni gerçekten değişti", bozuk !== M105_HAM);
  await db.exec(bozuk);
  let ayni = true;
  for (const [, f, t] of PENCERELER) {
    const a = sadeceKadro(await cek("spans_097", f, t));
    const b = sadeceKadro(await cek("fleet_odometer_spans", f, t));
    if (kanon(a) !== kanon(b)) ayni = false;
  }
  ok(
    "monotonluk karşılaştırması `>=` mi `>` mi — ÇIKTIYA YANSIMIYOR",
    ayni,
    "blok başı indirgemesi soğuruyor (dört pencerede de aynı)"
  );
  await db.exec(M105_HAM);
}

console.log(`\n═══ SONUÇ ═══════════════════════════════════════════════════════`);
console.log(`  ${gecti}/${gecti + kaldi} geçti${kaldi ? ` · ${kaldi} KALDI` : ""}\n`);
process.exit(kaldi ? 1 : 0);
