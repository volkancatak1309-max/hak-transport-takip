#!/usr/bin/env node
/**
 * MOBİL ANALİZ UÇLARI — CANLIDA KANIT.
 *
 * NE YAPAR: üç ucun GERÇEK işleyicilerini çağırır (sorgu yolu taklit EDİLMEZ),
 * sonra aynı sayıları PANELİN kendi yolundan bağımsız olarak yeniden üretip
 * karşılaştırır. Token deponun kendi `issueTokens`'ıyla mühürlenir.
 *
 * ── ⚠️ CANLI VERİTABANI: NEYE DOKUNUR ────────────────────────────────────
 * HİÇBİR ŞEY YAZMAZ. Üç uç da salt okuma; betiğin kendi sorguları da select.
 * Gerçek kişilere giden tek istekler REDDEDİLMESİ BEKLENEN isteklerdir
 * (token yok / şoför token'ı / şef token'ı) ve hiçbiri veri döndürmez.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-mobil-analiz.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import {
  computeAnalyticsRange,
  previousPeriod,
  computeTopDriversByType,
  computeSafetyScores,
  computeIdleWaste,
  drivenVehiclesFromEntries,
  workedDaysFromEntries,
  getWorkerShiftDistance,
  shiftKmForScoring,
  shiftWindowsForScoring,
  scoreMinKmForWorkedDays,
  scoreMinKmForSpan,
  getVehicleDistanceSpan,
  listVehiclesAndWorkers,
  SCORE_MIN_KM_COVERAGE,
} from "@/lib/analytics";
import {
  SAFETY_SCORE_WEIGHTS,
  TOP10_EVENT_TYPES,
  IDLE_FUEL_L_PER_HOUR,
  DIESEL_EUR_PER_L,
} from "@/lib/analytics-shared";
import {
  SAFETY_SCORE_K,
  SCORE_MIN_KM_PER_DAY,
  SCORE_MIN_KM_FLOOR,
} from "@/lib/metric-thresholds";
import {
  SAFETY_SCORE_CALIBRATED,
  SCORE_THRESHOLD_WORKED_DAYS,
} from "@/lib/tenant";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getLatestConfigEpoch, comparisonCrossesEpoch } from "@/lib/config-epoch";
import { mapBounded } from "@/lib/db-fanout";
import { GET as ANALYTICS_GET } from "@/app/api/mobile/analytics/route";
import { GET as SCORECFG_GET } from "@/app/api/mobile/score-config/route";
import { GET as SCORES_GET } from "@/app/api/mobile/driver-scores/route";

let dusen = 0;
let olculmeyen = 0;

function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function olculmedi(baslik, sebep) {
  console.log(`  ○ ${baslik}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
}
function bilgi(satir) {
  console.log(`     ${satir}`);
}
const n = (x, d = 0) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
const sa = (ms) => (ms / 3_600_000).toFixed(1);

const istek = (url, token) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(url, { headers: h });
};
async function cagir(handler, url, token) {
  const res = await handler(istek(url, token));
  return { status: res.status, json: await res.json().catch(() => null) };
}
const analiz = (qs, t) => cagir(ANALYTICS_GET, `http://x/api/mobile/analytics${qs ?? ""}`, t);
const skorAyari = (t) => cagir(SCORECFG_GET, "http://x/api/mobile/score-config", t);
const skorlar = (qs, t) => cagir(SCORES_GET, `http://x/api/mobile/driver-scores${qs ?? ""}`, t);

/**
 * PANEL REPLİKASI — app/admin/analiz/page.tsx `loadPeriod` + hesapların BİREBİR
 * aynısı. Ucun kodunu HİÇ çağırmaz; amacı bağımsız bir ikinci ölçüm üretmek.
 * (Panelin time_entries sorgusu KESİŞEN vardiyaları alır; buildPerformanceReport
 * ise `started_at` aralıkta olanları — fark bilerek korunuyor, ölçülecek olan
 * da bu.)
 */
async function panelDonemi(range, vehicles, workers) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));
  const testScope = await getTestScope();

  const [events, idleEpisodes, entryRes] = await Promise.all([
    listEventsInRange(startISO, endISO),
    listIdleEpisodesInRange(startISO, endISO),
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("worker_id, vehicle_id, started_at")
        .lte("started_at", endISO)
        .or(`ended_at.is.null,ended_at.gte.${startISO}`),
      "worker_id",
      testScope.workerIds
    ),
  ]);
  const rows = entryRes.data ?? [];
  const drivenVehiclesByWorker = drivenVehiclesFromEntries(rows);
  const workedDaysByWorker = workedDaysFromEntries(rows);
  const shiftKmRes = await getWorkerShiftDistance(startISO, endISO);
  const spanEntries = await mapBounded(
    vehicles,
    async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)]
  );
  const spanByVehicle = new Map(spanEntries);
  const distanceByVehicle = new Map([...spanByVehicle].map(([id, s]) => [id, s.km]));

  const gate = (vehicleIds, workerId) => {
    const worked = workedDaysByWorker.get(workerId) ?? 0;
    if (SCORE_THRESHOLD_WORKED_DAYS && worked > 0) return scoreMinKmForWorkedDays(range, worked);
    return scoreMinKmForSpan(
      range,
      vehicleIds.map((id) => spanByVehicle.get(id) ?? { firstAt: null, lastAt: null })
    );
  };

  const safety = computeSafetyScores(
    events,
    idleEpisodes,
    vehiclesById,
    workersById,
    distanceByVehicle,
    gate,
    drivenVehiclesByWorker,
    shiftKmForScoring(shiftKmRes),
    shiftWindowsForScoring(shiftKmRes)
  );
  const topByType = computeTopDriversByType(events, idleEpisodes, vehiclesById, workersById);
  const idle = computeIdleWaste(idleEpisodes, vehiclesById, workersById);
  const skorlu = safety.filter((r) => r.score !== null);

  const tur = {};
  for (const ty of TOP10_EVENT_TYPES) tur[ty] = topByType[ty].total;

  return {
    tur,
    alarmToplam: Object.values(tur).reduce((s, x) => s + x, 0),
    rolantiMs: idle.totalMs,
    rolantiEuro: idle.totalEuro,
    rolantiEpizod: idleEpisodes.length,
    skorlanan: skorlu.length,
    ortalama: skorlu.length
      ? Math.round(skorlu.reduce((s, r) => s + r.score, 0) / skorlu.length)
      : null,
    safety,
  };
}

console.log(`\n╔══ MOBİL ANALİZ UÇLARI · CANLIDA KANIT ═══════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
  const { data: patron } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (!patron) {
    console.error("✗ aktif yönetici hesabı bulunamadı, çıkıyorum.");
    process.exit(1);
  }
  const { data: sofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", false)
    .eq("is_active", true)
    .is("managed_fleet", null)
    .order("name")
    .limit(1)
    .maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version, managed_fleet")
    .not("managed_fleet", "is", null)
    .eq("is_admin", false)
    .eq("is_active", true)
    .order("name")
    .limit(1);
  const sef = (sefler ?? [])[0] ?? null;

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const soforToken = sofor
    ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken
    : null;
  const sefToken = sef
    ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken
    : null;

  console.log(`║ patron  ${patron.name.slice(0, 3)}***`);
  console.log(`║ şoför   ${sofor ? `${sofor.name.slice(0, 3)}***` : "YOK"}`);
  console.log(`║ şef     ${sef ? `${sef.name.slice(0, 3)}*** (${sef.managed_fleet})` : "YOK"}`);

  // ══ 1. KAPI (üç uç) ══════════════════════════════════════════════════════
  console.log(`\n── 1. KAPI ──`);
  const kapilar = [
    ["GET /analytics", (t) => analiz("", t)],
    ["GET /score-config", (t) => skorAyari(t)],
    ["GET /driver-scores", (t) => skorlar("", t)],
  ];
  for (const [ad, f] of kapilar) {
    const a = await f(null);
    iddia(`${ad} · token yok → 401`, a.status === 401, `${a.status} ${a.json?.error}`);
    const b = await f("kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, b.status === 401, `${b.status} ${b.json?.error}`);
    if (soforToken) {
      const c = await f(soforToken);
      iddia(
        `${ad} · ŞOFÖR → 403 admin_required`,
        c.status === 403 && c.json?.error === "admin_required",
        `${c.status} ${c.json?.error}`
      );
    } else olculmedi(`${ad} · şoför → 403`, "aktif şoför hesabı yok");
    if (sefToken) {
      const d = await f(sefToken);
      iddia(
        `${ad} · FİLO ŞEFİ → 403 admin_required`,
        d.status === 403 && d.json?.error === "admin_required",
        `${d.status} ${d.json?.error}`
      );
    } else olculmedi(`${ad} · filo şefi → 403`, "filo şefi hesabı yok");
  }

  // ══ 2. GİRDİ REDLERİ ═════════════════════════════════════════════════════
  console.log(`\n── 2. GİRDİ REDLERİ (/analytics) ──`);
  {
    const a = await analiz("?range=aylik", patronToken);
    iddia(
      "range=aylik → 400 invalid_range + geçerli küme",
      a.status === 400 &&
        a.json?.error === "invalid_range" &&
        Array.isArray(a.json?.gecerli) &&
        a.json.gecerli.join(",") === "gun,hafta,ay,tumzaman,ozel",
      `${a.status} ${a.json?.error} gecerli=${JSON.stringify(a.json?.gecerli)}`
    );
    const b = await analiz("?range=ozel&from=12.08.2026&to=2026-08-18", patronToken);
    iddia(
      "from=12.08.2026 → 400 invalid_tarih",
      b.status === 400 && b.json?.error === "invalid_tarih",
      `${b.status} ${b.json?.error}`
    );
    // Biçimi doğru, takvimde YOK. Denetim olmasaydı sessizce 3 Mart'a kayardı.
    const c = await analiz("?range=ozel&from=2026-02-31&to=2026-03-05", patronToken);
    iddia(
      "from=2026-02-31 (takvimde yok) → 400 invalid_tarih",
      c.status === 400 && c.json?.error === "invalid_tarih",
      `${c.status} ${c.json?.error}`
    );
  }

  // ══ 3. SCORE-CONFIG: DEĞERLER KOD SABİTLERİYLE BİREBİR Mİ ════════════════
  console.log(`\n── 3. /score-config · sabitlerle birebir mi ──`);
  {
    const r = await skorAyari(patronToken);
    const j = r.json;
    iddia("200 ok", r.status === 200 && j?.ok === true, `${r.status}`);
    iddia(
      `kalibre === SAFETY_SCORE_CALIBRATED`,
      j?.kalibre === SAFETY_SCORE_CALIBRATED,
      `uç=${j?.kalibre} kod=${SAFETY_SCORE_CALIBRATED}`
    );
    iddia(`K === SAFETY_SCORE_K`, j?.K === SAFETY_SCORE_K, `uç=${j?.K} kod=${SAFETY_SCORE_K}`);
    const agirlikEsit =
      j?.agirliklar &&
      Object.keys(SAFETY_SCORE_WEIGHTS).length === Object.keys(j.agirliklar).length &&
      Object.entries(SAFETY_SCORE_WEIGHTS).every(([k, v]) => j.agirliklar[k] === v);
    iddia(
      "agirliklar === SAFETY_SCORE_WEIGHTS (anahtar+değer)",
      agirlikEsit,
      JSON.stringify(j?.agirliklar)
    );
    iddia(
      "esikler.minKmGun === SCORE_MIN_KM_PER_DAY",
      j?.esikler?.minKmGun === SCORE_MIN_KM_PER_DAY,
      `uç=${j?.esikler?.minKmGun} kod=${SCORE_MIN_KM_PER_DAY}`
    );
    iddia(
      "esikler.minKmTaban === SCORE_MIN_KM_FLOOR",
      j?.esikler?.minKmTaban === SCORE_MIN_KM_FLOOR,
      `uç=${j?.esikler?.minKmTaban} kod=${SCORE_MIN_KM_FLOOR}`
    );
    iddia(
      "esikler.kapsamaOrani === SCORE_MIN_KM_COVERAGE",
      j?.esikler?.kapsamaOrani === SCORE_MIN_KM_COVERAGE,
      `uç=${j?.esikler?.kapsamaOrani} kod=${SCORE_MIN_KM_COVERAGE}`
    );
    iddia(
      "esikler.calisilanGuneGore === SCORE_THRESHOLD_WORKED_DAYS",
      j?.esikler?.calisilanGuneGore === SCORE_THRESHOLD_WORKED_DAYS,
      `uç=${j?.esikler?.calisilanGuneGore} kod=${SCORE_THRESHOLD_WORKED_DAYS}`
    );
  }

  // ══ 4. ANALYTICS: BEŞ DÖNEMİN HEPSİ GERÇEK SAYILARLA ═════════════════════
  console.log(`\n── 4. /analytics · beş dönem ──`);
  const epoch = await getLatestConfigEpoch();
  bilgi(
    `device_config_epochs son sınır: ${epoch ? epoch.changedAt.toISOString() : "YOK"}`
  );
  const donemler = [
    ["gun", "?range=gun"],
    ["hafta", "?range=hafta"],
    ["ay", "?range=ay"],
    ["tumzaman", "?range=tumzaman"],
    ["ozel", "?range=ozel&from=2026-08-01&to=2026-08-10"],
  ];
  const sonuclar = new Map();
  console.log(
    `     ${"dönem".padEnd(9)} ${"vardiya".padStart(7)} ${"km".padStart(9)} ${"saat".padStart(7)} ${"ort".padStart(4)} ${"skorlu".padStart(6)} ${"yeter.".padStart(6)} ${"alarm".padStart(6)} ${"rölanti-sa".padStart(10)} ${"€".padStart(8)}  trendBloke`
  );
  for (const [ad, qs] of donemler) {
    const t0 = Date.now();
    const r = await analiz(qs, patronToken);
    const ms = Date.now() - t0;
    if (r.status !== 200) {
      iddia(`${ad} → 200`, false, `${r.status} ${JSON.stringify(r.json)}`);
      continue;
    }
    const j = r.json;
    sonuclar.set(ad, j);
    const T = j.toplam;
    console.log(
      `     ${ad.padEnd(9)} ${String(T.vardiya).padStart(7)} ${n(T.km, 0).padStart(9)} ${sa(T.calismaMs).padStart(7)} ${String(T.skor.ortalama ?? "—").padStart(4)} ${String(T.skor.skorlanan).padStart(6)} ${String(T.skor.yetersizVeri).padStart(6)} ${String(T.alarm.toplam).padStart(6)} ${sa(T.rolanti.toplamMs).padStart(10)} ${n(T.rolanti.euro, 0).padStart(8)}  ${j.trendBloke}   (${ms} ms)`
    );
    iddia(
      `${ad} · alarm.toplam === Σ tür`,
      T.alarm.toplam === Object.values(T.alarm.tur).reduce((s, x) => s + x, 0),
      `${T.alarm.toplam}`
    );
    iddia(
      `${ad} · kapsam dışı olay yok`,
      T.alarm.kapsamDisi === 0,
      `kapsamDisi=${T.alarm.kapsamDisi}`
    );
    iddia(
      `${ad} · skorlanan + yetersizVeri === şoför sayısı`,
      T.skor.skorlanan + T.skor.yetersizVeri === T.skor.soforSayisi,
      `${T.skor.skorlanan}+${T.skor.yetersizVeri}=${T.skor.soforSayisi}`
    );
    iddia(
      `${ad} · rölanti litre = saat × ${IDLE_FUEL_L_PER_HOUR}`,
      Math.abs(T.rolanti.litre - (T.rolanti.toplamMs / 3_600_000) * IDLE_FUEL_L_PER_HOUR) < 1e-6,
      `${n(T.rolanti.litre, 1)} L`
    );
    iddia(
      `${ad} · euro = litre × ${DIESEL_EUR_PER_L}`,
      Math.abs(T.rolanti.euro - T.rolanti.litre * DIESEL_EUR_PER_L) < 1e-6,
      `€${n(T.rolanti.euro, 2)}`
    );
  }

  // tumzaman'da önceki dönem OLMAMALI
  {
    const j = sonuclar.get("tumzaman");
    if (j) {
      iddia(
        "tumzaman · oncekiDonem null + sebep dolu",
        j.oncekiDonem === null && j.oncekiDonemYok === "filo_baslangici",
        `oncekiDonem=${j.oncekiDonem} sebep=${j.oncekiDonemYok}`
      );
      iddia("tumzaman · trendBloke false (kıyas yok)", j.trendBloke === false, `${j.trendBloke}`);
    }
    for (const ad of ["gun", "hafta", "ay", "ozel"]) {
      const x = sonuclar.get(ad);
      if (!x) continue;
      iddia(
        `${ad} · oncekiDonem bloğu dolu`,
        !!x.oncekiDonem && !!x.oncekiDonem.toplam,
        x.oncekiDonem
          ? `${x.oncekiDonem.baslangic.slice(0, 10)}→${x.oncekiDonem.bitis.slice(0, 10)} vardiya=${x.oncekiDonem.toplam.vardiya}`
          : "null"
      );
    }
  }

  // ══ 5. trendBloke: GERÇEK ÖRNEK ══════════════════════════════════════════
  console.log(`\n── 5. trendBloke · gerçek örnek ──`);
  if (!epoch) {
    olculmedi("trendBloke true örneği", "device_config_epochs boş");
  } else {
    const b = epoch.changedAt.toISOString();
    for (const ad of ["gun", "hafta", "ay", "tumzaman", "ozel"]) {
      const j = sonuclar.get(ad);
      if (!j) continue;
      const r = computeAnalyticsRange(
        j.donem.tur,
        j.donem.from,
        j.donem.to
      );
      const p = previousPeriod(r);
      const beklenen = !!p && comparisonCrossesEpoch(r.start, r.end, p.start, p.end, epoch);
      iddia(
        `${ad} · trendBloke uç === lib/config-epoch.ts`,
        j.trendBloke === beklenen,
        `uç=${j.trendBloke} kütüphane=${beklenen}`
      );
    }
    const bloklu = [...sonuclar.entries()].filter(([, j]) => j.trendBloke === true);
    if (bloklu.length === 0) {
      // Bugünün pencereleri sınırı aşmıyorsa, sınırı ORTADAN KESEN bir özel
      // pencere kurup gösteririz — uydurma veri değil, gerçek sınır.
      const g = new Date(epoch.changedAt);
      const gun = (d) => d.toISOString().slice(0, 10);
      const once = new Date(g.getTime() - 3 * 86400000);
      const sonra = new Date(g.getTime() + 3 * 86400000);
      const r = await analiz(`?range=ozel&from=${gun(once)}&to=${gun(sonra)}`, patronToken);
      iddia(
        `sınırı kesen özel pencere (${gun(once)}→${gun(sonra)}) · trendBloke true`,
        r.json?.trendBloke === true,
        `trendBloke=${r.json?.trendBloke}`
      );
      bilgi(`sınır: ${b}`);
    } else {
      for (const [ad, j] of bloklu) {
        bilgi(
          `${ad}: ${j.donem.baslangic.slice(0, 10)}→${j.donem.bitis.slice(0, 10)} pencere sınırı (${b.slice(0, 10)}) ORTADAN KESİYOR → trendBloke=true`
        );
        bilgi(
          `   önceki dönem sayıları YİNE DÖNÜYOR (alarm=${j.oncekiDonem?.toplam?.alarm?.toplam}) ama ok/fark GÖSTERİLMEMELİ`
        );
      }
      iddia("en az bir dönemde trendBloke=true (gerçek pencere)", true, `${bloklu.map(([a]) => a).join(", ")}`);
    }
    // Sınırın TAMAMEN sonrasında kalan bir kıyas bloklanmamalı — karşı örnek.
    const j = sonuclar.get("hafta");
    if (j) {
      iddia(
        "hafta · iki pencere de sınırın SONRASINDA → trendBloke false",
        j.trendBloke === false &&
          new Date(j.oncekiDonem.baslangic).getTime() > epoch.changedAt.getTime(),
        `önceki başlangıç=${j.oncekiDonem?.baslangic?.slice(0, 10)} sınır=${b.slice(0, 10)}`
      );
    }
  }

  // ══ 6. PANEL KARŞILAŞTIRMASI (ÖNCEKİ DÖNEM DAHİL) ════════════════════════
  console.log(`\n── 6. /analytics · panel replikasıyla karşılaştırma ──`);
  bilgi("replika = app/admin/analiz/page.tsx loadPeriod + aynı hesaplar (ucun kodu ÇAĞRILMADI)");
  {
    const { vehicles, workers } = await listVehiclesAndWorkers();
    for (const ad of ["hafta", "ay"]) {
      const j = sonuclar.get(ad);
      if (!j) continue;
      const range = computeAnalyticsRange(ad);
      const prev = previousPeriod(range);
      const pencereler = [["bu dönem", range, j.toplam]];
      if (prev && j.oncekiDonem) pencereler.push(["önceki dönem", prev, j.oncekiDonem.toplam]);

      for (const [etiket, r, T] of pencereler) {
        const p = await panelDonemi(r, vehicles, workers);
        console.log(`     [${ad} · ${etiket}] ${r.start.toISOString().slice(0, 10)} → ${r.end.toISOString().slice(0, 10)}`);
        iddia(
          `  alarm toplamı  uç=${T.alarm.toplam} panel=${p.alarmToplam}`,
          T.alarm.toplam === p.alarmToplam
        );
        for (const ty of TOP10_EVENT_TYPES) {
          iddia(
            `  ${ty.padEnd(19)} uç=${String(T.alarm.tur[ty]).padStart(5)} panel=${String(p.tur[ty]).padStart(5)}`,
            T.alarm.tur[ty] === p.tur[ty]
          );
        }
        iddia(
          `  rölanti ms     uç=${T.rolanti.toplamMs} panel=${p.rolantiMs}`,
          T.rolanti.toplamMs === p.rolantiMs
        );
        iddia(
          `  rölanti €      uç=${n(T.rolanti.euro, 2)} panel=${n(p.rolantiEuro, 2)}`,
          Math.abs(T.rolanti.euro - p.rolantiEuro) < 1e-6
        );
        iddia(
          `  rölanti epizod uç=${T.rolanti.epizod} panel=${p.rolantiEpizod}`,
          T.rolanti.epizod === p.rolantiEpizod
        );
        // SKOR: ucun kaynağı buildPerformanceReport (Raporlar › Performans),
        // /admin/analiz ise KESİŞEN vardiya sorgusuyla kendi computeSafetyScores'unu
        // çalıştırıyor. İki evren AYNI OLMAK ZORUNDA DEĞİL — fark ÖLÇÜLÜP yazılıyor.
        const ayni = T.skor.skorlanan === p.skorlanan && T.skor.ortalama === p.ortalama;
        console.log(
          `     ${ayni ? "≡" : "≠"} skor  uç(rapor)=${T.skor.skorlanan}/${T.skor.ortalama ?? "—"}  panel(analiz)=${p.skorlanan}/${p.ortalama ?? "—"}`
        );
      }
    }
  }

  // ══ 7. DRIVER-SCORES: GERİYE UYUM + YENİ ALANLAR ═════════════════════════
  console.log(`\n── 7. /driver-scores · geriye uyum + yeni alanlar ──`);
  const ESKI_ALANLAR = [
    "workerId", "adSoyad", "sira", "oncekiSira", "siraDegisimi", "yetersizVeri",
    "guvenlikSkoru", "vardiya", "calismaMs", "km", "teslim", "teslimEdilemeyen", "ihlal",
  ];
  const YENI_ALANLAR = ["esikKm", "olculenKm", "kapsama", "sebep"];
  {
    const r = await skorlar("?donem=ay&limit=200", patronToken);
    iddia("200 ok", r.status === 200 && r.json?.ok === true, `${r.status}`);
    const satirlar = r.json?.satirlar ?? [];
    iddia("satır var", satirlar.length > 0, `${satirlar.length} satır`);

    // Eski alanların HEPSİ hâlâ var ve tipi değişmemiş
    const eksik = ESKI_ALANLAR.filter((a) => !(a in (satirlar[0] ?? {})));
    iddia("13 eski alanın hepsi duruyor", eksik.length === 0, eksik.join(",") || "eksik yok");
    iddia(
      "ihlal alt alanları duruyor",
      satirlar[0] &&
        ["toplam", "sertFren", "aniHizlanma", "asiriHiz"].every((k) => k in satirlar[0].ihlal),
      JSON.stringify(satirlar[0]?.ihlal)
    );
    const fazla = Object.keys(satirlar[0] ?? {}).filter(
      (k) => !ESKI_ALANLAR.includes(k) && !YENI_ALANLAR.includes(k)
    );
    iddia("beklenmeyen alan yok", fazla.length === 0, fazla.join(",") || "yok");

    // Yeni alanlar dolu ve TUTARLI
    const tutarsiz = satirlar.filter((s) => s.yetersizVeri !== (s.sebep !== null));
    iddia(
      "yetersizVeri === (sebep !== null) · her satırda",
      tutarsiz.length === 0,
      `${satirlar.length - tutarsiz.length}/${satirlar.length} tutarlı`
    );
    const kmYetersizYanlis = satirlar.filter(
      (s) => s.sebep === "km_yetersiz" && !(s.olculenKm !== null && s.olculenKm < s.esikKm)
    );
    iddia(
      "km_yetersiz ⇒ olculenKm < esikKm",
      kmYetersizYanlis.length === 0,
      kmYetersizYanlis.map((s) => `${s.adSoyad}:${s.olculenKm}/${s.esikKm}`).join(" ") || "hepsi doğru"
    );
    const kapsamaYanlis = satirlar.filter(
      (s) => s.sebep === "kapsama_dusuk" && s.kapsama !== null && s.kapsama >= SCORE_MIN_KM_COVERAGE
    );
    iddia(
      `kapsama_dusuk ⇒ kapsama < ${SCORE_MIN_KM_COVERAGE}`,
      kapsamaYanlis.length === 0,
      kapsamaYanlis.map((s) => `${s.adSoyad}:${n(s.kapsama, 2)}`).join(" ") || "hepsi doğru"
    );
    const skorluAmaKapsama = satirlar.filter(
      (s) => s.guvenlikSkoru !== null && s.kapsama !== null && s.kapsama < SCORE_MIN_KM_COVERAGE
    );
    iddia(
      `skoru olan hiçbir şoförde kapsama < ${SCORE_MIN_KM_COVERAGE} yok`,
      skorluAmaKapsama.length === 0,
      skorluAmaKapsama.map((s) => s.adSoyad).join(" ") || "yok"
    );

    const dagilim = new Map();
    for (const s of satirlar) dagilim.set(s.sebep, (dagilim.get(s.sebep) ?? 0) + 1);
    bilgi(
      `sebep dağılımı (ay): ${[...dagilim].map(([k, v]) => `${k ?? "skorlu"}=${v}`).join("  ")}`
    );

    // ── CANLI ÖRNEK: çok km sürmüş ama skorlanmamış şoförler ───────────────
    console.log(`\n     ── çok sürüp skorlanmayanlar (ay) ──`);
    const kurbanlar = satirlar
      .filter((s) => s.yetersizVeri && (s.km ?? 0) > 500)
      .sort((a, b) => (b.km ?? 0) - (a.km ?? 0));
    if (kurbanlar.length === 0) olculmedi("yüksek km + skorsuz örnek", "aralıkta böyle şoför yok");
    for (const s of kurbanlar) {
      console.log(
        `     ${s.adSoyad.padEnd(20)} vardiya=${String(s.vardiya).padStart(3)}  km=${n(s.km, 0).padStart(6)}  ölçülenKm=${n(s.olculenKm, 0).padStart(6)}  eşik=${n(s.esikKm, 0).padStart(5)}  kapsama=${s.kapsama === null ? "—" : (s.kapsama * 100).toFixed(0) + "%"}  → ${s.sebep}`
      );
    }

    // Hedefli: adı geçen şoför (varsa) — ham RPC ile ÇAPRAZ DOĞRULAMA
    const hedef = satirlar.find((s) => s.adSoyad.toLocaleLowerCase("tr").includes("cumhur"));
    if (!hedef) {
      olculmedi("Cumhur Karataş satırı", "aralıkta satırı yok");
    } else {
      const range = computeAnalyticsRange("ay");
      const res = await getWorkerShiftDistance(
        range.start.toISOString(),
        range.end.toISOString()
      );
      const cov = res.coverage?.get(hedef.workerId) ?? null;
      const hamKm = res.km?.get(hedef.workerId) ?? null;
      const suzulmus = shiftKmForScoring(res)?.get(hedef.workerId) ?? null;
      console.log(`\n     ── ${hedef.adSoyad} · ham RPC çapraz doğrulama ──`);
      bilgi(`uç:      sebep=${hedef.sebep} ölçülenKm=${n(hedef.olculenKm, 0)} eşik=${n(hedef.esikKm, 0)} kapsama=${hedef.kapsama === null ? "—" : (hedef.kapsama * 100).toFixed(1) + "%"}`);
      bilgi(`ham RPC: vardiya=${cov ? `${cov.olculen}/${cov.toplam}` : "—"} kapsama=${cov && cov.toplam ? ((cov.olculen / cov.toplam) * 100).toFixed(1) + "%" : "—"} ham km=${n(hamKm, 0)} süzülmüş km=${n(suzulmus, 0)}`);
      iddia(
        "kapsama oranı ham RPC sayacıyla birebir",
        cov && cov.toplam > 0
          ? Math.abs(hedef.kapsama - cov.olculen / cov.toplam) < 1e-9
          : hedef.kapsama === null,
        `uç=${hedef.kapsama} rpc=${cov ? cov.olculen / cov.toplam : null}`
      );
      iddia(
        "sebep, kapsamanın eşiğe göre konumuyla tutarlı",
        hedef.sebep === null ||
          (hedef.sebep === "kapsama_dusuk"
            ? hedef.kapsama !== null && hedef.kapsama < SCORE_MIN_KM_COVERAGE
            : true),
        `sebep=${hedef.sebep}`
      );
    }
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error(e?.stack ?? "");
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
