#!/usr/bin/env node
/**
 * EKSEN BİRLİĞİ · KAPI DENETİMİ — ARIZA ENJEKSİYONU. YAZMAZ, DB'YE GİTMEZ.
 *
 * ═══ NE DEĞİŞTİ (18.09.2026) ═══════════════════════════════════════════════
 *
 * Bu betik `shiftWindowsForScoring`in km ile AYNI üç durumu ayırıp ayırmadığını
 * sınıyordu. O mekanizma kaldırıldı: pay (olay atfı) ile payda (km) artık
 * `lib/score-core.ts` içinde TEK fonksiyondan, TEK satır kümesinden üretiliyor.
 * Yani "iki kaynak ayrışır mı" sorusu yapısal olarak ortadan kalktı.
 *
 * Betiğin işi de buna göre değişti: ayrışmayı değil, BİRLİĞİ kanıtlıyor.
 * `scoreInputFromShifts` saf bir fonksiyon (ağ yok, saat yok), dolayısıyla
 * uydurma veri enjekte edip kuralın kenarlarını tek tek sınayabiliyoruz.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-eksen-kapilar.mjs
 */
import { workerDrivingAt, computeSafetyScores } from "@/lib/analytics";
import { scoreInputFromShifts } from "@/lib/score-core";
import { SCORE_MIN_KM } from "@/lib/metric-thresholds";

let gecti = 0;
let kaldi = 0;
const iddia = (ad, kosul, kanit) => {
  if (kosul) {
    gecti++;
    console.log(`  ✓ ${ad}`);
  } else {
    kaldi++;
    console.log(`  ✗ ${ad}${kanit ? `  — ${kanit}` : ""}`);
  }
};

const RANGE = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2026-09-08T00:00:00.000Z"),
};
/** `loadScoreShifts`in döndürdüğü satırın sınama kopyası. */
const vardiya = (id, worker, vehicle, bas, bit, km) => ({
  id,
  worker_id: worker,
  vehicle_id: vehicle,
  started_at: bas,
  ended_at: bit,
  start_km: null,
  end_km: null,
  break_minutes: null,
  cargo_count: null,
  undelivered_count: null,
  km_measured: true,
  km_karar: { km, kaynak: km === null ? "olculmedi" : "cihaz" },
});

console.log(`\n══ EKSEN BİRLİĞİ · ARIZA ENJEKSİYONU ══`);

// ── 1. PAY VE PAYDA AYNI SATIRLARDAN ───────────────────────────────────────
console.log(`\n── 1. km ve pencere AYNI kümeden üretiliyor ──`);
{
  const s = [
    vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T14:00:00.000Z", 120),
    vardiya("b", "W1", "V1", "2026-09-03T06:00:00.000Z", "2026-09-03T14:00:00.000Z", 80),
    // ÖLÇÜLEMEYEN vardiya: km'ye katkı vermez ama PENCERE üretir — şoför o
    // araçtaydı ve yaptığı ihlal ONUN ihlalidir (bkz. lib/score-core.ts).
    vardiya("c", "W1", "V2", "2026-09-04T06:00:00.000Z", "2026-09-04T14:00:00.000Z", null),
  ];
  const inp = scoreInputFromShifts(s, RANGE);
  iddia("km yalnız ÖLÇÜLEN vardiyalardan toplanıyor", inp.kmByWorker.get("W1") === 200,
    `${inp.kmByWorker.get("W1")}`);
  iddia("kapsama ölçülen/toplam sayıyor",
    inp.coverageByWorker.get("W1").olculen === 2 && inp.coverageByWorker.get("W1").toplam === 3,
    JSON.stringify(inp.coverageByWorker.get("W1")));
  iddia("ölçülemeyen vardiya da PENCERE üretiyor",
    inp.windowsByVehicle.get("V2")?.length === 1, `${inp.windowsByVehicle.get("V2")?.length}`);
  iddia("pencere sayısı = vardiya sayısı (hiçbiri düşmüyor)",
    [...inp.windowsByVehicle.values()].reduce((a, x) => a + x.length, 0) === 3);
}

// ── 2. "ÖLÇÜLDÜ, 0 km" ile "ÖLÇEMEDİK" AYRI ───────────────────────────────
console.log(`\n── 2. 0 km bir ÖLÇÜMDÜR, yokluk değildir ──`);
{
  const sifir = scoreInputFromShifts(
    [vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T07:00:00.000Z", 0)],
    RANGE
  );
  iddia("0 km olan şoför HARİTAYA giriyor (değer 0)",
    sifir.kmByWorker.has("W1") && sifir.kmByWorker.get("W1") === 0);
  const yok = scoreInputFromShifts(
    [vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T07:00:00.000Z", null)],
    RANGE
  );
  iddia("ölçülemeyen şoför HARİTAYA girmiyor", !yok.kmByWorker.has("W1"));
  // Kapıdaki fark: ilki "km_yetersiz" (0 < 100), ikincisi "kapsama_dusuk".
  const rows0 = computeSafetyScores([], [], new Map([["W1", { id: "W1", name: "A" }]]), sifir);
  const rowsN = computeSafetyScores([], [], new Map([["W1", { id: "W1", name: "A" }]]), yok);
  iddia("0 km → skor null ama PAYDA ölçülmüş (distanceKm === 0)",
    rows0[0].score === null && rows0[0].distanceKm === 0, `${rows0[0].distanceKm}`);
  iddia("ölçülemedi → distanceKm null", rowsN[0].distanceKm === null);
}

// ── 3. AÇIK VARDİYA PENCERESİ ARALIK SONUNDA KAPANIYOR ────────────────────
console.log(`\n── 3. açık vardiya: pencere sonu = aralık sonu ──`);
{
  const inp = scoreInputFromShifts(
    [vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", null, 50)],
    RANGE
  );
  const w = inp.windowsByVehicle.get("V1")[0];
  iddia("endMs === range.end", w.endMs === RANGE.end.getTime(), `${w.endMs}`);
  iddia("aralık sonunda hâlâ direksiyonda",
    workerDrivingAt(inp.windowsByVehicle, "V1", RANGE.end.toISOString()) === "W1");
  iddia("aralık sonrasında değil",
    workerDrivingAt(inp.windowsByVehicle, "V1", "2026-09-20T00:00:00.000Z") === null);
}

// ── 4. ÇAKIŞMADA EN GEÇ BAŞLAYAN KAZANIR (sıra deterministik) ─────────────
console.log(`\n── 4. çakışan pencere: en geç başlayan ──`);
{
  // Ters sırada veriyoruz — `scoreInputFromShifts` sıralamayı KENDİ kuruyor.
  const inp = scoreInputFromShifts(
    [
      vardiya("b", "W2", "V1", "2026-09-02T10:00:00.000Z", "2026-09-02T18:00:00.000Z", 10),
      vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T14:00:00.000Z", 10),
    ],
    RANGE
  );
  iddia("pencereler başlangıca göre sıralı",
    inp.windowsByVehicle.get("V1")[0].workerId === "W1");
  iddia("çakışma anında devralan kazanıyor",
    workerDrivingAt(inp.windowsByVehicle, "V1", "2026-09-02T12:00:00.000Z") === "W2");
  iddia("çakışma öncesinde ilk şoför",
    workerDrivingAt(inp.windowsByVehicle, "V1", "2026-09-02T08:00:00.000Z") === "W1");
  iddia("olay ASLA iki şoföre birden yazılmıyor (tek dönüş)",
    typeof workerDrivingAt(inp.windowsByVehicle, "V1", "2026-09-02T12:00:00.000Z") === "string");
}

// ── 5. HİÇBİR PENCEREYE DÜŞMEYEN OLAY SAHİPSİZ ────────────────────────────
console.log(`\n── 5. vardiyasız an → hiç kimseye yazılmaz ──`);
{
  const inp = scoreInputFromShifts(
    [vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T14:00:00.000Z", 500)],
    RANGE
  );
  const workers = new Map([["W1", { id: "W1", name: "A" }]]);
  const olay = (at) => ({ vehicle_id: "V1", occurred_at: at, event_type: "overspeeding", speed_kmh: 90 });
  const icinde = computeSafetyScores([olay("2026-09-02T10:00:00.000Z")], [], workers, inp);
  const disinda = computeSafetyScores([olay("2026-09-02T20:00:00.000Z")], [], workers, inp);
  iddia("vardiya içindeki olay şoföre yazılıyor", icinde[0].totalEvents === 1);
  iddia("vardiya dışındaki olay kimseye yazılmıyor", disinda[0].totalEvents === 0);
  iddia("atanmış şoföre GERİ DÜŞÜLMÜYOR (uydurma atıf yok)", disinda[0].penalty === 0);
  iddia("başka aracın olayı bu şoföre yazılmıyor",
    computeSafetyScores([{ ...olay("2026-09-02T10:00:00.000Z"), vehicle_id: "V9" }], [], workers, inp)[0]
      .totalEvents === 0);
}

// ── 6. EŞİK: DÜZ 100 km, KİŞİYE GÖRE DEĞİŞMİYOR ───────────────────────────
console.log(`\n── 6. eşik herkeste ${SCORE_MIN_KM} km ──`);
{
  const workers = new Map([
    ["W1", { id: "W1", name: "Az" }],
    ["W2", { id: "W2", name: "Çok" }],
  ]);
  const inp = scoreInputFromShifts(
    [
      // 2 vardiya · 99 km  → eşiğin ALTINDA
      vardiya("a", "W1", "V1", "2026-09-02T06:00:00.000Z", "2026-09-02T14:00:00.000Z", 99),
      // 26 günlük yoğun çalışan: eskiden eşiği 520'ye çıkardı, artık değil
      ...Array.from({ length: 26 }, (_, i) =>
        vardiya(`b${i}`, "W2", "V2", `2026-09-02T06:00:00.000Z`, `2026-09-02T14:00:00.000Z`, 4)
      ),
    ],
    RANGE
  );
  const rows = computeSafetyScores([], [], workers, inp);
  const w1 = rows.find((r) => r.workerId === "W1");
  const w2 = rows.find((r) => r.workerId === "W2");
  iddia("eşik iki şoförde de aynı", w1.minKm === SCORE_MIN_KM && w2.minKm === SCORE_MIN_KM,
    `${w1.minKm} / ${w2.minKm}`);
  iddia("99 km → skor yok", w1.score === null, `${w1.score}`);
  iddia("104 km · 26 vardiya → skor VAR (çok çalışmak cezalandırmıyor)",
    w2.score !== null && w2.distanceKm === 104, `km=${w2.distanceKm} skor=${w2.score}`);
}

console.log(`\n══ ${kaldi === 0 ? "✓" : "✗"} ${gecti} geçti · ${kaldi} kaldı ══\n`);
process.exit(kaldi > 0 ? 1 : 0);
