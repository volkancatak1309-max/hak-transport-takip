import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { fuelConsumedPct, pctToLiters } from "@/lib/fuel-math";
import {
  computeSafetyScores,
  workerDrivingAt,
  getVehicleFuelSpan,
  type DistanceUnavailableReason,
} from "@/lib/analytics";
import { loadScoreInput } from "@/lib/score-core";
import {
  SAFETY_SCORE_WEIGHTS,
  type DateRange,
  type SafetyScoreRow,
} from "@/lib/analytics-shared";
import {
  FUEL_L100_MIN_DAYS,
  FUEL_MIN_CONSUMED_PCT,
  FUEL_MIN_KM,
  FUEL_MIN_WINDOW_OVERLAP_RATIO,
  SPEED_MIN_KM,
} from "@/lib/metric-thresholds";
import { getTestScope, dropTestRows, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { markKmMeasured } from "@/lib/km-quality";
import {
  okuEvren,
  okuOlaylar,
  okuRolanti,
  okuFiloSpan,
  okuAracSpan,
} from "@/lib/report-reads";
import { kmRaporDegeri } from "@/lib/km-ui";
import { AZG_DAILY_MAX_MS } from "@/lib/azg-rules";
import {
  FUEL_PRICE_EUR_PER_L,
  FUEL_PRICE_SOURCE,
  FUEL_PRICE_AS_OF,
  FUEL_PRICE_IS_CUSTOM,
  KM_EKSENI_KESIM_TARIHI,
  YAKIT_OZET_ENABLED,
} from "@/lib/tenant";
import { resolveCostRates } from "@/lib/cost-rates-db";
import {
  computeCost,
  computeVehicleCost,
  fuelRealityCheck,
  type CostBasis,
  type CostBreakdown,
  type CostRateOrigin,
  type CostRates,
  type CostVehicleRow,
} from "@/lib/cost-model";
import {
  workedMs,
  kmDiff,
  viennaDayKey,
  startOfDayVienna,
  addCalendarDaysVienna,
} from "@/lib/format";
import { mapBounded, isTimeoutError } from "@/lib/db-fanout";
import type { TimeEntry } from "@/lib/types";

/**
 * Rapor merkezi (FAZ 3) veri katmanı.
 *
 * TEK KURAL: burada YENİ bir metrik icat edilmez. Üç raporun da sayıları
 * ekranda zaten var olan hesaplardan gelir —
 *   • güvenlik skoru      → computeSafetyScores (Analiz sayfasıyla AYNI)
 *   • mesafe              → getVehicleDistanceKm (odometre uç-noktaları + km-guard)
 *   • vardiya/km/teslimat → time_entries, admin panosuyla aynı alanlar
 * Böylece "Analiz 72 diyor, rapor 68 diyor" durumu doğmaz.
 *
 * MALİYET: hiçbir rapor telemetriyi satır satır çekmez. Aralıktaki telemetri
 * hacmi gün 49 bin, hafta 239 bin satır — sayfaya taşınamaz. Mesafe bu yüzden
 * araç başına İKİ indeksli limit-1 sorgusuyla (ilk/son odometre) çözülür.
 * Ortalama/maksimum hız ve yakıt/sıcaklık serileri Postgres tarafında
 * toplulaştırma ister (RPC) — bu dosyada BİLEREK yoklar.
 */

/**
 * "Aşırı hız / 100 km" neden gösterilmiyor? Boş bir "Veri yok" yöneticiye hiçbir
 * iş vermiyordu (22.07.2026 denetimi); artık sebep taşınır ve ekranda ayrı ayrı
 * yazılır:
 *  • no_odometer  → cihaz odometre göndermiyor      → cihazı kontrol ettir
 *  • inconsistent → sayaç geri saymış / bozuk okuma  → cihaz değişimi mi?
 *  • too_short    → mesafe eşiğin altında            → yapacak bir şey yok, bekle
 *  • olculmedi    → mesafe ÖLÇÜLEMEDİ (RPC hatası)   → veri sağlam, biz okuyamadık
 *
 * ⚠️ `olculmedi` cihaz kusuru DEĞİLDİR (105, 17.09.2026). Önceden bu durumda
 * sessizce başka kurallı bir yedek yola düşülüyor ve YANLIŞ bir km gösteriliyordu;
 * artık "ölçemedim" yazıyoruz. Yöneticiyi cihaza koşturmasın diye ayrı sebep.
 */
export type RatioUnavailableReason =
  | "no_odometer"
  | "inconsistent"
  | "too_short"
  | "olculmedi"
  | null;

export type SpeedRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  violations: number;
  maxSpeedKmh: number | null;
  distanceKm: number | null;
  /** 100 km başına ihlal — Analiz'in km-normalizasyonuyla aynı mantık. */
  per100Km: number | null;
  /** per100Km null ise SEBEBİ (ekranda ayrı mesaj olarak yazılır). */
  per100Reason: RatioUnavailableReason;
};

export type SpeedReport = {
  rows: SpeedRow[];
  totalViolations: number;
  maxSpeedKmh: number | null;
  /** İhlali olan araç sayısı (filodaki toplamla kıyas için). */
  vehiclesWithViolations: number;
  vehicleCount: number;
};

export type DistanceRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  km: number | null;
  /** Aralık uzunluğuna bölünmüş günlük ortalama — dönemler kıyaslanabilsin. */
  kmPerDay: number | null;
};

export type DistanceReport = {
  rows: DistanceRow[];
  totalKm: number;
  /** Mesafesi ÖLÇÜLEBİLEN araç sayısı; geri kalanı "veri yok". */
  measured: number;
  vehicleCount: number;
  days: number;
};

export type PerformanceRow = {
  workerId: string;
  name: string;
  shifts: number;
  workedMs: number;
  /**
   * ═══ ÜÇ KM ALANI, ÜÇ AYRI SORU (13. madde Adım 5) ═══
   *
   * `km`      → çekirdeğin kararı (cihaz → sayaç → null). EKRAN bunu
   *             basar: Analiz/Performans bugünün en iyi ölçümünü gösterir.
   * `kmRapor` → kesim kuralının seçtiği eksen (lib/km-ui.ts
   *             `kmRaporDegeri`). KÂĞIT bunu basar: basılmış bir belge
   *             bugün yeniden üretildiğinde AYNI sayıyı vermek zorunda.
   * `kmSayac` → saf sayaç farkı, dondurulmamış hâliyle. Hiçbir yüzey
   *             basmaz; kesim öncesi "ikisi eşit" iddiasını ölçen
   *             muhafız/denetim için duruyor.
   *
   * `km` ile `kmRapor` kesim tarihinden ÖNCEKİ aralıklarda ayrışır ve bu
   * kasıtlıdır — ekran ileri gitti, kâğıt geçmişine sadık kaldı.
   */
  km: number | null;
  kmSayac: number | null;
  kmRapor: number | null;
  delivered: number;
  undelivered: number;
  /** Analiz'deki güvenlik skorunun AYNISI (null = yeterli km yok). */
  safetyScore: number | null;
  /**
   * CEZAYA GİREN OLAYLARIN TAMAMI — skorun paydası değil PAYI (18.09.2026).
   *
   * `events === harshBraking + harshAcceleration + harshCornering +
   * overspeeding + jamming + idling`. Bu eşitlik bir süs değil, kolonun
   * varlık sebebi: sayı skorun GEREKÇESİ olduğunu iddia ediyor ve iddiayı
   * ancak cezayı üreten kümenin tamamını göstererek taşıyabilir.
   *
   * 18.09'a kadar `events` yalnız `vehicle_events` satırlarını sayıyor,
   * kırılım da onların üçünü gösteriyordu; rölanti epizodları, sert viraj ve
   * sinyal karıştırma cezaya girip ekranda görünmüyordu.
   */
  events: number;
  harshBraking: number;
  harshAcceleration: number;
  harshCornering: number;
  overspeeding: number;
  jamming: number;
  /** Rölanti EPİZODU sayısı — `idle_episodes`ten, `vehicle_events`ten değil. */
  idling: number;
  /**
   * ═══ SKOR KAPISININ GEREKÇESİ (18.08.2026) — SALT RAPORLAMA ═══
   *
   * Aşağıdaki dört alan hiçbir hesabı DEĞİŞTİRMEZ; `safetyScore`ün nasıl
   * hesaplandığını (ya da neden hesaplanamadığını) anlatır. Eklenme sebebi
   * ölçülebilir bir soru: canlıda 1.354 km sürmüş bir şoför "Yetersiz veri"
   * düşüyor ve ekran bunun km azlığından mı, ölçülemeyen vardiyalardan mı
   * olduğunu söyleyemiyordu. Sayı yerine boşluk göstermek bir karar; boşluğun
   * SEBEBİNİ göstermemek bir kusurdur (bkz. lib/metric-thresholds.ts başlığı).
   *
   * DEĞERLER KARARIN KENDİSİNDEN GELİR, TAHMİNDEN DEĞİL:
   *   scoreMinKm   ← computeSafetyScores'un o şoför için çağırdığı kapı
   *   scoreKm      ← skorun paydası (SafetyScoreRow.distanceKm)
   *   scoreCoverage← getWorkerShiftDistance'ın kapsama sayacı
   *   scoreGate    ← yukarıdaki üçünden türeyen, kapının hangi kolunda
   *                  elendiğini söyleyen kod
   */
  /**
   * Km eşiği — 18.09.2026'dan beri HERKES İÇİN AYNI (SCORE_MIN_KM = 100).
   * Alan satırda kaldı: ekran çıtayı bir sabitten değil KARARDAN okusun.
   */
  scoreMinKm: number;
  /** Skorun paydası olan ölçülen km; null = ölçülemedi (0 km sürdü DEĞİL). */
  scoreKm: number | null;
  /**
   * Km'si ölçülebilen vardiya oranı (0–1); hiç vardiya yoksa null.
   *
   * ⚠️ SALT RAPORLAMA. 18.09.2026'ya kadar bu oran bir KAPIYDI (%80 altı →
   * skor yok) ve ölçümde yanlış tarafa düşüyordu: cihazı her vardiyada
   * konuşan ama hiç ilerlemeyen bir odometre %81 alıp kapıyı geçiyordu.
   * Artık hiçbir kararı etkilemez, yalnız "26 vardiyanın 21'i ölçüldü"
   * cümlesini kurar.
   */
  scoreCoverage: number | null;
  /**
   * Skor NEDEN yok? `safetyScore` doluysa null.
   *   km_yetersiz    → km ölçüldü ama eşiğin altında (scoreKm < scoreMinKm)
   *   kapsama_dusuk  → vardiya VAR ama çekirdek HİÇBİRİNDE km ölçemedi
   *                    (mobil etiketi: "Cihaz verisi eksik"). Ad tarihsel;
   *                    gerekçesi buildPerformanceReport'taki kapı notunda.
   *   vardiya_yok    → aralıkta hiç vardiya yok; km atfedilecek sürüş yok
   */
  scoreGate: "km_yetersiz" | "kapsama_dusuk" | "vardiya_yok" | null;
};

/**
 * PERFORMANSIN GÜN KIRILIMI (10.08.2026) — aralığın her takvim günü için bir
 * satır. Mobil Özet ekranı 7 günlük seriyi buradan okuyor.
 *
 * TOPLAMLARIN TÜREVİ, YENİ BİR ÖLÇÜM DEĞİL: aynı `entries` dizisinden, aynı
 * şoför evreniyle (`base.workers`) ve aynı formüllerle (workedMs / kmDiff)
 * toplanır. Bu yüzden ŞU ÜÇ EŞİTLİK HER ZAMAN SAĞLANIR:
 *   Σ daily.shifts   === totalShifts
 *   Σ daily.workedMs === totalWorkedMs
 *   Σ daily.km       === totalKm
 * Ayrı bir sorgu ya da ayrı bir eşik yok — aksi hâlde "rapor 412 diyor, grafik
 * 409 diyor" durumu doğardı.
 *
 * GÜN: vardiyanın BAŞLANGIÇ anının kiracı takvim günü (viennaDayKey). Gece
 * yarısını aşan vardiya başladığı güne yazılır — panelin her yerinde olduğu gibi.
 */
export type PerformanceDaily = {
  /** Kiracı takvim günü, YYYY-MM-DD (lib/format.ts viennaDayKey). */
  day: string;
  shifts: number;
  workedMs: number;
  /**
   * Ölçülebilen km toplamı; o gün hiçbir vardiyada km yoksa **null**.
   * 0 ile null bilinçli ayrı: "çalıştı ama sayaç yok" ≠ "0 km sürdü"
   * (PerformanceRow.km ile aynı kural).
   */
  km: number | null;
};

export type PerformanceReport = {
  rows: PerformanceRow[];
  /** Skoru hesaplanabilen şoförlerin ortalaması (null'lar sayılmaz). */
  avgScore: number | null;
  totalShifts: number;
  totalWorkedMs: number;
  totalKm: number;
  /**
   * KM KAPSAMASI (15.08.2026). `totalKm` yalnız ölçülebilen vardiyaların
   * toplamıdır; bu iki sayı olmadan eksik bir toplam "tam" gibi okunuyordu.
   * Cihazı sessiz vardiyada `end_km - start_km` bayat odometreden 0 çıkıyor ve
   * bu 0 bir ölçüm değil (bkz. lib/km-quality.ts).
   */
  kmMeasuredShifts: number;
  kmUnmeasuredShifts: number;
  scoredCount: number;
  /** Aralığın her günü için vardiya/km/çalışma — toplamların kırılımı. */
  daily: PerformanceDaily[];
};

function rangeDays(range: DateRange): number {
  return Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)
  );
}

/**
 * Üç raporun da ihtiyaç duyduğu ortak taban: araç/şoför sözlüğü, aralıktaki
 * olaylar ve araç başına mesafe. Tek yerde toplanır ki üç rapor aynı sayıyı
 * iki farklı şekilde hesaplamasın.
 */
async function loadBase(range: DateRange) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();
  // TUR İÇİ PAYLAŞIM (16. madde): kap açıksa bu dört okuma turda BİR KEZ
  // yapılır. Kap yoksa (panel, cron) davranış birebir eskisi — bkz.
  // lib/report-reads.ts başlığı.
  const { vehicles, workers, workerNames } = await okuEvren();
  const [events, idleEpisodes, spanEntries] = await Promise.all([
    okuOlaylar(startISO, endISO),
    okuRolanti(startISO, endISO),
    /**
     * ODOMETRE AÇIKLIĞI — önce filo geneli RPC (097/105), yoksa araç-araç.
     *
     * ⚠️ 105'TEN SONRA İKİ YOL AYNI ÇEKİRDEĞİ ÇAĞIRIYOR (17.09.2026).
     * Öncesinde araç-araç yol HAM uç okumayı alıyordu ve tek bozuk satırda
     * aracı `inconsistent` yapıyordu — yani filo RPC'si tavanı aşıp geri
     * düşüldüğünde AYNI ARACA BAŞKA BİR KM çıkıyordu. Şimdi geri düşüş
     * yalnız YAVAŞLATIR, sayıyı değiştirmez. Maliyet ölçümü ve gerekçe:
     * `lib/analytics.ts` → `getFleetDistanceSpans` / `getVehicleDistanceSpan`.
     */
    (async () => {
      const filo = await okuFiloSpan(startISO, endISO);
      if (filo) return vehicles.map((v) => [v.id, filo.get(v.id) ?? BOS_SPAN] as const);
      // Eşzamanlılık tavanı: araç başına İKİ sorgu (bkz. lib/db-fanout.ts).
      return mapBounded(
        vehicles,
        async (v) => [v.id, await okuAracSpan(v.id, startISO, endISO)] as const
      );
    })(),
  ]);
  return {
    startISO,
    endISO,
    vehicles,
    /** ŞOFÖR EVRENİ — satır/sayı üreten her yer bunu kullanır. */
    workers,
    /** İSİM SÖZLÜĞÜ — araç satırına sürücü etiketi basan yerler bunu kullanır. */
    workerNames,
    events,
    idleEpisodes,
    distanceByVehicle: new Map(spanEntries.map(([id, s]) => [id, s.km] as const)),
    /** km null ise sebebi — oran metrikleri "neden yok" diyebilsin diye. */
    distanceReasonByVehicle: new Map(
      spanEntries.map(([id, s]) => [id, s.reason] as const)
    ),
    /** Ölçüm PENCERESİ — güvenlik skoru kapısı buna göre ölçekleniyor (B). */
    spanByVehicle: new Map(
      spanEntries.map(([id, s]) => [id, { firstAt: s.firstAt, lastAt: s.lastAt }] as const)
    ),
  };
}

/**
 * Bir oran metriğinin paydası (km) yeterli mi? Değilse SEBEBİYLE birlikte döner.
 * Tek yerde durur ki hız raporu ile yakıt raporu aynı araçta farklı gerekçe
 * göstermesin.
 */
function checkKmDenominator(
  km: number | null,
  reason: DistanceUnavailableReason,
  minKm: number
): RatioUnavailableReason {
  if (km === null) return reason ?? "no_odometer";
  if (km < minKm) return "too_short";
  return null;
}

/** HIZ RAPORU — ihlaller `vehicle_events`'ten (gerçek olay + kayıtlı hız). */
export async function buildSpeedReport(range: DateRange): Promise<SpeedReport> {
  const base = await loadBase(range);
  // İSİM SÖZLÜĞÜ (geniş) — hız raporu ARAÇ eksenlidir, driverName yalnız
  // "bu aracı kim kullanıyor" etiketidir. Şoför evreni (base.workers)
  // kullanılsaydı atanmış birinin adı "—"e dönerdi. Yakıt raporu da böyle.
  const workerName = new Map(base.workerNames.map((w) => [w.id, w.name]));

  const byVehicle = new Map<string, { count: number; max: number | null }>();
  for (const e of base.events) {
    if (e.event_type !== "overspeeding") continue;
    const cur = byVehicle.get(e.vehicle_id) ?? { count: 0, max: null };
    cur.count += 1;
    // Olayın kendi hızı — uydurma değil, cihazın ihlal anında bildirdiği değer.
    const s = e.speed_kmh;
    if (typeof s === "number" && (cur.max === null || s > cur.max)) cur.max = s;
    byVehicle.set(e.vehicle_id, cur);
  }

  const rows: SpeedRow[] = base.vehicles.map((v) => {
    const agg = byVehicle.get(v.id);
    const km = base.distanceByVehicle.get(v.id) ?? null;
    // PAYDA KAPISI (22.07.2026): eskiden yalnız `km > 0` bakılıyordu — 2 km
    // giden araçtaki 1 ihlal ekranda "50 ihlal/100 km" oluyordu. Artık payda
    // SPEED_MIN_KM'in altındaysa oran hesaplanmaz ve sebebi yazılır.
    const reason = checkKmDenominator(
      km,
      base.distanceReasonByVehicle.get(v.id) ?? null,
      SPEED_MIN_KM
    );
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName: v.assigned_worker_id
        ? workerName.get(v.assigned_worker_id) ?? null
        : null,
      violations: agg?.count ?? 0,
      maxSpeedKmh: agg?.max ?? null,
      distanceKm: km,
      per100Km: reason === null ? ((agg?.count ?? 0) / (km as number)) * 100 : null,
      per100Reason: reason,
    };
  });

  rows.sort((a, b) => b.violations - a.violations || a.plate.localeCompare(b.plate));
  const maxAll = rows.reduce<number | null>(
    (m, r) => (r.maxSpeedKmh !== null && (m === null || r.maxSpeedKmh > m) ? r.maxSpeedKmh : m),
    null
  );
  return {
    rows,
    totalViolations: rows.reduce((a, r) => a + r.violations, 0),
    maxSpeedKmh: maxAll,
    vehiclesWithViolations: rows.filter((r) => r.violations > 0).length,
    vehicleCount: rows.length,
  };
}

/**
 * RPC hiç satır döndürmeyen araç: o pencerede odometre okuması YOK.
 * "0 km" DEĞİL — ölçülemedi (bkz. lib/km-quality.ts dersi).
 */
const BOS_SPAN = { km: null, reason: "no_odometer", firstAt: null, lastAt: null } as const;

/** FİLO MESAFE — odometre uç-noktaları (getVehicleDistanceKm, km-guard dahil). */
export async function buildDistanceReport(range: DateRange): Promise<DistanceReport> {
  const base = await loadBase(range);
  // İSİM SÖZLÜĞÜ (geniş) — mesafe raporu ARAÇ eksenli; bkz. hız raporu.
  const workerName = new Map(base.workerNames.map((w) => [w.id, w.name]));
  const days = rangeDays(range);

  const rows: DistanceRow[] = base.vehicles.map((v) => {
    const km = base.distanceByVehicle.get(v.id) ?? null;
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName: v.assigned_worker_id
        ? workerName.get(v.assigned_worker_id) ?? null
        : null,
      km,
      kmPerDay: km === null ? null : km / days,
    };
  });

  rows.sort((a, b) => (b.km ?? -1) - (a.km ?? -1) || a.plate.localeCompare(b.plate));
  const measuredRows = rows.filter((r) => r.km !== null);
  return {
    rows,
    totalKm: measuredRows.reduce((a, r) => a + (r.km ?? 0), 0),
    measured: measuredRows.length,
    vehicleCount: rows.length,
    days,
  };
}

/**
 * SÜRÜCÜ PERFORMANSI — vardiya gerçekleri (time_entries) + Analiz'in güvenlik
 * skoru + sürüş alışkanlığı olayları, tek satırda.
 */
export async function buildPerformanceReport(
  range: DateRange
): Promise<PerformanceReport> {
  const base = await loadBase(range);

  /**
   * VARDİYALAR + KM KARARI + PUAN GİRDİSİ — TEK ÇAĞRI (bkz. lib/score-core.ts).
   *
   * Öncesinde bu blok kendi `time_entries` sorgusunu yazıyor, ardından İKİNCİ
   * bir kaynaktan (052 ham şoför toplamı) puan paydası okuyordu. İki kaynak
   * canlıda ayrıştı: aynı şoför ekranda 1.133 km, puanda 11 km.
   * Artık ekranın km'si (`e.km_karar.km`) ile puanın paydası
   * (`input.kmByWorker`) AYNI satırlardan, AYNI kararla üretiliyor.
   */
  const { shifts: entries, input: scoreInput } = await loadScoreInput(range);

  const safety = new Map<string, SafetyScoreRow>(
    computeSafetyScores(
      base.events,
      base.idleEpisodes,
      new Map(base.workers.map((w) => [w.id, w])),
      scoreInput
    ).map((r) => [r.workerId, r])
  );

  /**
   * OLAY SAYILARI — SKORLA BİREBİR AYNI EKSEN, AYNI KÜME.
   *
   * Atıf: olay, o araçta o saatte VARDİYADA olan şoförün (`workerDrivingAt`,
   * skorun kullandığı fonksiyonun ta kendisi).
   *
   * ⚠️ KÜME DE AYNI OLMAK ZORUNDA (18.09.2026). Bu kolon 18.09'a kadar YALNIZ
   * `vehicle_events` satırlarını sayıyordu; rölanti EPİZODLARI cezaya giriyor
   * ama kolona girmiyordu. Canlı sonuç: Şafak Gök ekranda "1 olay" ile 72 puan
   * alıyordu — cezasının 160'ı 32 rölanti epizodundan geliyordu ve ekranda
   * hiçbir izi yoktu. Kolon skorun GEREKÇESİ olduğunu iddia ediyorsa cezayı
   * üreten kümeyi göstermek zorunda.
   *
   * Kırılım da tamamlandı: `harsh_cornering` ve `jamming` de cezaya giriyordu
   * ama hiçbir kolonda yoktu; Ali Özdemir'in 88 olayının 38'i görünmüyordu.
   * Artık `events === Σ (kırılım)` — beş tip + rölanti.
   */
  const olayinSofuru = (vehicleId: string, atISO: string): string | null =>
    workerDrivingAt(scoreInput.windowsByVehicle, vehicleId, atISO);
  type EvAcc = {
    total: number;
    braking: number;
    accel: number;
    cornering: number;
    speeding: number;
    jamming: number;
    idling: number;
  };
  const bosEv = (): EvAcc => ({
    total: 0,
    braking: 0,
    accel: 0,
    cornering: 0,
    speeding: 0,
    jamming: 0,
    idling: 0,
  });
  const evByWorker = new Map<string, EvAcc>();
  for (const e of base.events) {
    // AĞIRLIK SÜZGECİ: cezaya girmeyen bir tip kolona da girmez. Süzgeç
    // computeSafetyScores'un kullandığının ta kendisi — ikinci bir liste
    // tutulsaydı yeni bir olay tipi eklendiğinde biri güncellenir öteki
    // unutulurdu (canlıda tam olarak bu oldu: harsh_cornering + jamming).
    if (SAFETY_SCORE_WEIGHTS[e.event_type] === undefined) continue;
    const wid = olayinSofuru(e.vehicle_id, e.occurred_at);
    if (!wid) continue;
    const a = evByWorker.get(wid) ?? bosEv();
    a.total += 1;
    if (e.event_type === "harsh_braking") a.braking += 1;
    else if (e.event_type === "harsh_acceleration") a.accel += 1;
    else if (e.event_type === "harsh_cornering") a.cornering += 1;
    else if (e.event_type === "overspeeding") a.speeding += 1;
    else if (e.event_type === "jamming") a.jamming += 1;
    evByWorker.set(wid, a);
  }
  // RÖLANTİ EPİZODLARI — `vehicle_events`te DEĞİL, `idle_episodes` tablosunda.
  // Cezaya giriyorlar (ağırlık 5), dolayısıyla kolona da girerler.
  for (const ep of base.idleEpisodes) {
    const wid = olayinSofuru(ep.vehicle_id, ep.started_at);
    if (!wid) continue;
    const a = evByWorker.get(wid) ?? bosEv();
    a.total += 1;
    a.idling += 1;
    evByWorker.set(wid, a);
  }

  type ShiftAcc = {
    shifts: number;
    ms: number;
    /** Çekirdek ekseni (cihaz → sayaç). EKRANIN sayısı. */
    km: number;
    hasKm: boolean;
    /** Saf sayaç farkı (end_km − start_km). Muhafızın kıyas ekseni. */
    kmSayac: number;
    hasKmSayac: boolean;
    /** Kesim kuralının seçtiği eksen. KÂĞIDIN sayısı. */
    kmRapor: number;
    hasKmRapor: boolean;
    delivered: number;
    undelivered: number;
  };
  const shiftByWorker = new Map<string, ShiftAcc>();
  // GÜN KIRILIMI aynı döngüde toplanır (bkz. PerformanceDaily). AYRI bir
  // döngüde toplanamaz: `workedMs` AÇIK vardiyada `Date.now()` okur, yani iki
  // döngü arasında geçen milisaniyeler kırılımı toplamdan ayırır. Canlıda
  // ölçüldü (HAK61, 10.08.2026): iki döngülü ilk sürümde Σ gün = toplam + 30 ms.
  // Tek döngüde her vardiya için `ms`/`km` BİR KEZ hesaplanıp ikisine de yazılır.
  const dailyAcc = emptyDailyBuckets(range);
  const driverIds = new Set(base.workers.map((w) => w.id));
  for (const e of entries) {
    if (!e.worker_id) continue;
    const ms = workedMs(e);
    // Çekirdeğin kararı (cihaz → sayaç → null). `kmDiff` artık yalnız
    // çekirdeğin İÇİNDE, yedek eksen olarak yaşıyor.
    const km = e.km_karar.km;
    const a =
      shiftByWorker.get(e.worker_id) ??
      {
        shifts: 0,
        ms: 0,
        km: 0,
        hasKm: false,
        kmSayac: 0,
        hasKmSayac: false,
        kmRapor: 0,
        hasKmRapor: false,
        delivered: 0,
        undelivered: 0,
      };
    a.shifts += 1;
    a.ms += ms;
    if (km !== null) {
      a.km += km;
      a.hasKm = true;
    }
    /**
     * RAPOR EKSENLERİ (13. madde Adım 5). Ekran `km`i kullanır (çekirdek,
     * kesim yok); KÂĞIT `kmRapor`u kullanır (kesim kuralı). `kmSayac` eski
     * ekseni saf hâliyle taşır — muhafız "kesim öncesi ikisi eşit" iddiasını
     * onunla ölçüyor.
     *
     * ⚠️ `kmRapor` VARDİYA VARDİYA toplanır, iki toplamdan biri SEÇİLEREK
     * değil. Sebebi somut: kesimi ORTASINDAN geçen bir aralıkta (ör. 25.09 →
     * 05.10) doğru cevap ne saf sayaç ne saf çekirdektir — her vardiya kendi
     * tarihine ait ekseni taşımalı. Tek toplamı seçmek o aralığı yanlış yapardı.
     */
    const sayacKm = kmDiff(e);
    if (sayacKm !== null) {
      a.kmSayac += sayacKm;
      a.hasKmSayac = true;
    }
    const { km: raporKm } = kmRaporDegeri(e, KM_EKSENI_KESIM_TARIHI);
    if (raporKm !== null) {
      a.kmRapor += raporKm;
      a.hasKmRapor = true;
    }
    // Teslim edilen yalnız KAPANMIŞ vardiyada gerçektir (açık vardiyada
    // cargo_count hâlâ gün başı yer tutucusu) — panoyla aynı kural.
    if (e.ended_at !== null && e.cargo_count !== null) a.delivered += e.cargo_count;
    if (e.undelivered_count !== null) a.undelivered += e.undelivered_count;
    shiftByWorker.set(e.worker_id, a);

    // TOPLAMLARLA AYNI EVREN: satır toplamları `base.workers` üzerinde dönüyor
    // ve o evrende olmayan bir vardiya `rows`'a hiç girmiyor (aşağıdaki döngü).
    // Buradaki kapı tam olarak o elemeyi tekrarlar — olmasaydı iki evren
    // ayrışıp Σ gün ≠ toplam durumunu doğururdu.
    if (!driverIds.has(e.worker_id)) continue;
    const key = viennaDayKey(e.started_at);
    // Kova yoksa AÇILIR (satır düşürülmez): aralık sınırı ile gün anahtarı bir
    // gün kayarsa bile kırılım toplamı tutmaya devam etsin.
    const d = dailyAcc.get(key) ?? { shifts: 0, ms: 0, km: 0, hasKm: false };
    d.shifts += 1;
    d.ms += ms;
    if (km !== null) {
      d.km += km;
      d.hasKm = true;
    }
    dailyAcc.set(key, d);
  }

  /**
   * SKOR KAPISININ HANGİ KOLUNDA ELENDİ? — karar noktalarının SIRASI önemli.
   *
   * computeSafetyScores'ta tek satır: `reliableKm !== null && reliableKm >= minKm`.
   * `null` iki AYRI sebepten gelir ve ayrımı yapabilen tek yer burası, çünkü
   * vardiya sayısı yalnız burada var.
   *
   * SIRA:
   *  1. skor varsa sebep yoktur (null);
   *  2. km ÖLÇÜLDÜYSE (scoreKm != null) tek olası sebep 100 km'nin altında
   *     kalmak — en güçlü delil sayının kendisidir;
   *  3. hiç vardiya yoksa km atfedilecek sürüş de yoktur → `vardiya_yok`;
   *  4. vardiya var ama çekirdek HİÇBİRİNİ ölçemedi → `kapsama_dusuk`.
   *
   * ⚠️ 4. KOLUN ANLAMI DEĞİŞTİ (18.09.2026) — ADI DEĞİŞMEDİ.
   * Eskiden "ölçülen vardiya oranı %80'in altında" demekti; artık "çekirdek
   * HİÇBİR vardiyada km üretemedi" demek. Kısmi ölçüm artık elemiyor: 10
   * vardiyanın 3'ü ölçüldüyse skor o 3 vardiyanın km'siyle hesaplanır ve
   * oran `scoreCoverage` alanında ekrana taşınır — yöneticinin göreceği
   * cümle "şu kadarı ölçülemedi" olur, boşluk değil.
   *
   * KOD ADI NEDEN KORUNDU: bu değer üç yere gidiyor — mobil istemcinin
   * etiket sözlüğü ("Cihaz verisi eksik"), `sofor_skor_donem.kapi` kolonu ve
   * migration 088'deki CHECK kısıtı (`kapi in ('km_yetersiz','kapsama_dusuk',
   * 'vardiya_yok')`). Yeniden adlandırmak bir migration + yayınlanmış mobil
   * sürüm gerektirirdi; kullanıcının GÖRDÜĞÜ etiket zaten yeni anlamla
   * birebir doğru. Ad borcu bilinçli ve burada yazılı.
   */
  const rows: PerformanceRow[] = [];
  for (const w of base.workers) {
    const s = shiftByWorker.get(w.id);
    const ev = evByWorker.get(w.id);
    const sc = safety.get(w.id);
    // Aralıkta ne vardiyası ne olayı olan şoför rapora girmez — 0'larla dolu
    // satır, "çalışmadı" ile "veri yok"u karıştırır.
    if (!s && !ev) continue;
    // Kapsama artık ÇEKİRDEĞİN kararından: "ölçüldü" = km_karar bir sayı
    // üretti. 052'nin boş okuması ölçüm sayılmıyor (bkz. lib/score-core.ts).
    const kap = scoreInput.coverageByWorker.get(w.id) ?? null;
    const scoreCoverage = kap && kap.toplam > 0 ? kap.olculen / kap.toplam : null;
    const scoreKm = sc?.distanceKm ?? null;
    const scoreGate: PerformanceRow["scoreGate"] =
      (sc?.score ?? null) !== null
        ? null
        : scoreKm !== null
          ? "km_yetersiz"
          : (s?.shifts ?? 0) === 0
            ? "vardiya_yok"
            : "kapsama_dusuk";
    rows.push({
      workerId: w.id,
      name: w.name,
      shifts: s?.shifts ?? 0,
      workedMs: s?.ms ?? 0,
      km: s?.hasKm ? s.km : null,
      kmSayac: s?.hasKmSayac ? s.kmSayac : null,
      kmRapor: s?.hasKmRapor ? s.kmRapor : null,
      delivered: s?.delivered ?? 0,
      undelivered: s?.undelivered ?? 0,
      safetyScore: sc?.score ?? null,
      events: ev?.total ?? 0,
      harshBraking: ev?.braking ?? 0,
      harshAcceleration: ev?.accel ?? 0,
      harshCornering: ev?.cornering ?? 0,
      overspeeding: ev?.speeding ?? 0,
      jamming: ev?.jamming ?? 0,
      idling: ev?.idling ?? 0,
      // Kapı DEĞERİ computeSafetyScores'un o şoför için kullandığı sayının ta
      // kendisi (SafetyScoreRow.minKm) — burada yeniden hesaplanmaz.
      // `sc` HER ZAMAN doludur: computeSafetyScores `base.workers`ın TAMAMI için
      // satır üretir (skoru null olsa bile). `?? 0` yalnız tür kapısıdır.
      scoreMinKm: sc?.minKm ?? 0,
      scoreKm,
      scoreCoverage,
      scoreGate,
    });
  }

  // Sıralama: skoru olan şoförler önce (yüksek → düşük), skorsuzlar sonda.
  rows.sort((a, b) => {
    if (a.safetyScore === null && b.safetyScore === null) return b.shifts - a.shifts;
    if (a.safetyScore === null) return 1;
    if (b.safetyScore === null) return -1;
    return b.safetyScore - a.safetyScore;
  });

  const scored = rows.filter((r) => r.safetyScore !== null);
  return {
    rows,
    avgScore: scored.length
      ? Math.round(scored.reduce((a, r) => a + (r.safetyScore ?? 0), 0) / scored.length)
      : null,
    totalShifts: rows.reduce((a, r) => a + r.shifts, 0),
    totalWorkedMs: rows.reduce((a, r) => a + r.workedMs, 0),
    totalKm: rows.reduce((a, r) => a + (r.km ?? 0), 0),
    /**
     * Km'si ÖLÇÜLEBİLEN / TOPLAM vardiya. Eskiden cihazı sessiz vardiyalar
     * toplama 0 katıyor ve rapor "tam ölçüldü" görünüyordu; artık eksik olduğu
     * bandın kendisinde yazılı.
     */
    kmMeasuredShifts: entries.filter((e) => e.km_karar.km !== null).length,
    kmUnmeasuredShifts: entries.filter(
      (e) => e.end_km !== null && e.start_km !== null && kmDiff(e) === null
    ).length,
    scoredCount: scored.length,
    daily: finalizeDaily(dailyAcc),
  };
}

type DailyAcc = { shifts: number; ms: number; km: number; hasKm: boolean };

/**
 * Aralığın HER takvim günü için boş kova (bkz. PerformanceDaily).
 *
 * BOŞ GÜN DE SATIRDIR: vardiya olmayan gün {0, 0, null} olarak çıkar, yoksa
 * grafik "hiç çalışılmayan pazar"ı atlar ve seri bir gün kayar.
 *
 * Sınırlar kiracı dilimiyle yürüyor (lib/format.ts) — DST günlerinde de gün
 * atlanmaz, çünkü ilerleme saat değil TAKVİM GÜNÜ ekliyor.
 */
function emptyDailyBuckets(range: DateRange): Map<string, DailyAcc> {
  const acc = new Map<string, DailyAcc>();
  const lastKey = viennaDayKey(range.end);
  for (
    let d = startOfDayVienna(range.start), key = viennaDayKey(d);
    key <= lastKey;
    d = addCalendarDaysVienna(d, 1), key = viennaDayKey(d)
  ) {
    acc.set(key, { shifts: 0, ms: 0, km: 0, hasKm: false });
  }
  return acc;
}

/** Kovaları güne göre sıralı diziye çevirir; km üç-durumlu kalır (bkz. tip). */
function finalizeDaily(acc: Map<string, DailyAcc>): PerformanceDaily[] {
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, a]) => ({
      day,
      shifts: a.shifts,
      workedMs: a.ms,
      km: a.hasKm ? a.km : null,
    }));
}

// ── YAKIT RAPORU (fuel) ─────────────────────────────────────────────────────
//
// Kaynak: device_telemetry.fuel_level_pct (cihazın gerçek % okuması) +
// vehicles.tank_capacity_l. Yüzde istatistikleri 258 bin satırlık telemetriden
// Postgres tarafında toplulaştırılır (report_fuel_stats RPC, migration 026) —
// satırlar sayfaya taşınmaz. Litre/L100km çevrimi BURADA, kapasiteyle yapılır;
// kapasitesi olmayan araçta (DO-671GY) yalnız % gösterilir, UYDURMA litre yok.

/** L/100km neden hesaplanmadı — bkz. FuelRow.lPer100Reason. */
export type FuelRatioReason =
  | RatioUnavailableReason
  | "too_little_fuel"
  | "window_mismatch"
  | "unreliable_sensor"
  | "no_capacity";

export type FuelRow = {
  vehicleId: string;
  plate: string;
  driverName: string | null;
  /** vehicles.tank_capacity_l — null ise litre/L100km hesaplanamaz. */
  tankCapacityL: number | null;
  /** RPC bu araç için satır döndü mü (aralıkta yakıt okuması var mı). */
  hasData: boolean;
  sampleCount: number;
  avgPct: number | null;
  minPct: number | null;
  maxPct: number | null;
  refillCount: number;
  refillPct: number;
  /** Kapasite biliniyorsa dolum litresi, yoksa null. */
  refillLiters: number | null;
  /** Dönemde yakılan yakıt = dolumlar + (ilk − son), 0'a kırpılı (yüzde). */
  consumedPct: number;
  consumedLiters: number | null;
  km: number | null;
  lPer100Km: number | null;
  /**
   * lPer100Km null ise SEBEBİ — ekranda boş "—" yerine bu yazılır.
   *  • no_odometer / inconsistent → mesafe ölçülemedi (cihaz sorunu)
   *  • too_short                  → mesafe < FUEL_MIN_KM
   *  • too_little_fuel            → tüketim < FUEL_MIN_CONSUMED_PCT (sensör gürültüsü)
   *  • window_mismatch            → odometre ve yakıt okumaları aynı zamanı ölçmüyor
   *  • unreliable_sensor          → sensör arızalı (zaten tüm sayıları gizli)
   */
  lPer100Reason: FuelRatioReason;
  /** Hareketsizken düşüş = olası kaçak/hırsızlık (odometre ilerlemedi). */
  suspiciousDropCount: number;
  suspiciousDropPct: number;
  suspiciousDropLiters: number | null;
  /** Aralıktaki HAM %0 okuma sayısı (de-glitch öncesi). */
  zeroCount: number;
  /** Sıfır okumaların payı (0–1). */
  zeroRatio: number;
  /**
   * true → sensör güvenilmez; tüketim/dolum sayıları GÖSTERİLMEZ ve filo
   * toplamlarına girmez. Yarım doğru sayı, yokluktan daha zararlıdır.
   */
  dataUnreliable: boolean;
};

/**
 * Rapor neden boş döndü? "Fonksiyon yok" ile "sorgu zaman aşımına uğradı"
 * BİRBİRİNDEN AYRILMALI (22.07.2026): ikisi de `available:false` sayıldığı için
 * migration uygulanmış olmasına rağmen ekranda "026 henüz çalıştırılmadı"
 * yazıyordu. Yönetici olmayan bir sorunu kovalıyordu.
 *  • missing_function → migration gerçekten uygulanmamış (PGRST202 / 42883)
 *  • timeout          → fonksiyon var, aralık çok geniş (57014)
 *  • error            → başka bir DB hatası
 */
export type FuelUnavailableReason =
  | "missing_function"
  | "timeout"
  | "error"
  | null;

export type FuelReport = {
  /** false → rapor hesaplanamadı; sebebi `unavailableReason` söyler. */
  available: boolean;
  /** available=false iken doldurulur; available=true iken null. */
  unavailableReason: FuelUnavailableReason;
  rows: FuelRow[];
  vehicleCount: number;
  /** Aralıkta yakıt verisi olan araç sayısı. */
  measured: number;
  /** Kapasitesi bilinen araçların toplam tüketimi (litre). */
  totalConsumedLiters: number;
  fleetLPer100Km: number | null;
  /**
   * L/100km kolonu bu aralıkta GÖSTERİLİR Mİ? Tam sayı yüzde sensörüyle günlük
   * araç bazlı tüketim ölçülemez — aralık FUEL_L100_MIN_DAYS'ten kısaysa kolon
   * hiç çıkmaz (boş kolon da soru işareti doğurur).
   */
  l100Available: boolean;
  /** Aralık gün sayısı — "en az 7 gün gerekir" mesajında gösterilir. */
  rangeDays: number;
  /**
   * Filo ortalamasına GERÇEKTEN giren araç sayısı (üç kapıyı da geçenler).
   * Ekranda "18/29 araçtan" diye yazılır: ortalama, filonun tamamı değildir.
   */
  l100VehicleCount: number;
  /**
   * PARASAL KARŞILIK (09.08.2026). Çarpım SUNUCUDA yapılır ve yalnız SONUÇ
   * istemciye iner — fiyat env'i istemci paketine hiç girmez.
   * totalConsumedLiters null olamaz (0 başlar), yani maliyet de her zaman sayı.
   */
  totalCostEur: number;
  /** Kullanılan litre fiyatı — ekrandaki küçük notta gösterilir. */
  fuelPriceEurPerL: number;
  /** Fiyat müşterinin kendi girdiği mi (true) yoksa piyasa varsayılanı mı? */
  fuelPriceIsCustom: boolean;
  /** Varsayılan fiyatın kaynağı ve tarihi (yalnız custom değilken anlamlı). */
  fuelPriceSource: string;
  fuelPriceAsOf: string;
  refillTotalCount: number;
  refillTotalLiters: number;
  /** En az bir şüpheli düşüşü olan araç sayısı. */
  suspiciousVehicles: number;
  /** Sensörü güvenilmez sayılan (okumalarının >%10'u sıfır) araç sayısı. */
  unreliableVehicles: number;
  /** Verisi olan ama kapasitesi girilmemiş araç sayısı (litre gösterilemez). */
  capacityMissing: number;
  /**
   * KISMİ RAPOR (09.08.2026) — istatistiği HESAPLANAMAYAN araçların plakaları.
   *
   * NEDEN plaka listesi, sayı değil: "3 araç hesaplanamadı" yöneticiye hangi
   * aracı kontrol edeceğini söylemez; canlı olayda eksik olan 12 araçtı ve
   * rapor 18 araçlık toplamı TAM gibi bastı. Ekranda uyarı çıkar ve o araçlar
   * "Veri yok" satırı olarak kalır — toplamlara girmez.
   *
   * Boş dizi = her araç hesaplandı. `available` YİNE DE true'dur: elde olan
   * veriyi göstermek doğru, onu tam sanmak yanlıştı.
   */
  partialVehicles: string[];
  /** partialVehicles doluysa sebebi (timeout / error). */
  partialReason: FuelUnavailableReason;
};

type FuelStatRow = {
  vehicle_id: string;
  sample_count: number;
  avg_pct: number | null;
  min_pct: number | null;
  max_pct: number | null;
  first_pct: number | null;
  last_pct: number | null;
  refill_count: number;
  refill_pct: number;
  drop_count: number;
  drop_pct: number;
  /**
   * ARIZALI SENSÖR SAYIMI — aralıktaki HAM `fuel_level_pct = 0` okuma sayısı.
   *
   * ⚠️ OPSİYONEL: yalnız migration 107 uygulanmış kiracıda gelir. Yoksa
   * uygulama eski 19 sorgulu yola düşer (aşağıda `sifirKolonuVar`).
   * 2 argümanlı `report_fuel_stats` (geri düşüş yolu) bu kolonu HİÇ döndürmez.
   */
  zero_count?: number | null;
};

/**
 * Okumalarının bu oranından FAZLASI %0 olan aracın yakıt sensörü güvenilmez
 * sayılır (canlı gözlem: DO-687GX %22; sağlıklı araçlarda oran %0,01'in altında,
 * yani eşik geniş bir boşluğun ortasında durur).
 */
const UNRELIABLE_ZERO_RATIO = 0.1;

/** report_fuel_volume_stats (migration 039) satırı — litre cinsinden. */
type FuelVolumeStatRow = {
  vehicle_id: string;
  sample_count: number;
  avg_l: number | null;
  min_l: number | null;
  max_l: number | null;
  first_l: number | null;
  last_l: number | null;
  refill_count: number;
  refill_l: number;
  drop_count: number;
  drop_l: number;
  /** Ardışık iki okuma arasındaki en büyük MUTLAK sıçrama (gürültü muhafızı). */
  max_step_l: number;
};

/**
 * LİTRE GÜRÜLTÜ MUHAFIZI (27.07.2026). Ardışık adım bu eşiği aşıyorsa aracın
 * hacim serisi güvenilmez sayılır ve rapora HİÇ girmez ("Veri yok").
 *
 * Ölçüm (canlı, 3 gün): temiz araçlarda en büyük adım 0,1–1,0 L
 * (DO-776GS 0,1 · DO-753GS 0,3 · DO-945HL 0,5 · DO-775GS 1,0);
 * çöp seride 30–79 L (DO-777GS 79 · DO-747GU 65 · DO-687GX 43).
 * 5 L bu iki kümenin arasındaki geniş boşlukta durur.
 */
const FUEL_VOLUME_MAX_STEP_L = 5;

/**
 * Litre yolunda "ölçülebilir tüketim" eşiği — yüzdedeki %15'in karşılığı.
 * Yüzde eşiği tam sayı sensörün belirsizliğinden doğuyordu; litre ondalıklı
 * geliyor, yani DAHA hassas. 5 L, 60-80 L'lik depolarda %6-8'e denk gelir:
 * yüzde yolundan düşük ama gürültünün üstünde.
 */
const FUEL_MIN_CONSUMED_L = 5;

/**
 * RPC hatasını ayırt eder. Kritik ayrım (22.07.2026): "fonksiyon yok" yöneticiye
 * migration çalıştırtır, "zaman aşımı" ise aralık daralttırır. İkisini aynı
 * mesajla göstermek, migration uygulanmışken "026'yı çalıştırın" demek oluyordu.
 *  • 57014  = query_canceled (statement timeout) — canlıda soğuk cache'te görüldü
 *  • PGRST202 = PostgREST şema önbelleğinde fonksiyon yok
 *  • 42883  = undefined_function
 */
export function classifyRpcError(error: {
  code?: string | null;
  message?: string | null;
}): FuelUnavailableReason {
  const code = (error.code ?? "").toUpperCase();
  const msg = (error.message ?? "").toLowerCase();

  if (
    code === "57014" ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement")
  ) {
    return "timeout";
  }
  if (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("report_fuel_stats") ||
    msg.includes("could not find the function") ||
    msg.includes("function")
  ) {
    return "missing_function";
  }
  return "error";
}

export async function buildFuelReport(range: DateRange): Promise<FuelReport> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  // test-filtered: dropTestRows — yakıt raporu loadBase'i KULLANMIYOR, kendi
  // araç/şoför evrenini kuruyor. Analiz kapısını filtrelemek buraya yetmez.
  const scope = await getTestScope();
  const [{ data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin
      .from("vehicles")
      .select("id, plate, assigned_worker_id, tank_capacity_l"),
    // is_active FİLTRESİ YOK (Modül 2): geçmiş yakıt raporu ayrılan personelin
    // adını göstermeye devam etmeli — isim evreni TÜM personel olmalı, yoksa
    // terminated şoförün adı "—"e döner (7 yıl arşiv zorunluluğu).
    //
    // driver-scoped: KAPSAM BİLEREK UYGULANMADI. Bu bir İSİM ETİKETİ sözlüğü,
    // şoför evreni değil: yakıt raporunun satırları ARAÇ eksenlidir (vehicleCount,
    // measured, l100VehicleCount hepsi araç sayar) ve buradaki ad yalnız "bu aracı
    // kim kullanıyor" etiketidir. Kapsamı uygulamak hiçbir SAYIYI değiştirmez,
    // yalnız bir yöneticiye araç atanmışsa etiketi "—"e çevirir — bilgi kaybı,
    // düzeltme değil. Şoför SAYAN yüzey buranın üstünde: buildPerformanceReport.
    supabaseAdmin.from("workers").select("id, name"),
  ]);
  const vehicles = dropTestRows(
    (vData ?? []) as {
      id: string;
      plate: string;
      assigned_worker_id: string | null;
      tank_capacity_l: number | null;
    }[],
    (v) => ({ vehicle: v.id }),
    scope
  );
  const workerName = new Map(
    dropTestRows(
      (wData ?? []) as { id: string; name: string }[],
      (w) => ({ worker: w.id }),
      scope
    ).map((w) => [w.id, w.name])
  );

  // L/100km KOLON KAPISI (22.07.2026): tam sayı yüzde sensörüyle günlük araç
  // bazlı tüketim ölçülemez. Aralık eşiğin altındaysa kolon HİÇ çıkmaz.
  const days = rangeDays(range);
  const l100Available = days >= FUEL_L100_MIN_DAYS;

  const empty = (reason: FuelUnavailableReason): FuelReport => ({
    available: false,
    unavailableReason: reason,
    rows: [],
    vehicleCount: vehicles.length,
    measured: 0,
    totalConsumedLiters: 0,
    fleetLPer100Km: null,
    l100Available,
    rangeDays: days,
    l100VehicleCount: 0,
    totalCostEur: 0,
    fuelPriceEurPerL: FUEL_PRICE_EUR_PER_L,
    fuelPriceIsCustom: FUEL_PRICE_IS_CUSTOM,
    fuelPriceSource: FUEL_PRICE_SOURCE,
    fuelPriceAsOf: FUEL_PRICE_AS_OF,
    refillTotalCount: 0,
    refillTotalLiters: 0,
    suspiciousVehicles: 0,
    unreliableVehicles: 0,
    capacityMissing: 0,
    partialVehicles: [],
    partialReason: null,
  });

  /**
   * ══ BAĞIMSIZ AŞAMALAR ERKEN BAŞLAR (16c adım 2, 17.09.2026) ═════════
   *
   * `buildFuelReport` beş aşama koşuyordu ve BEŞİ DE ARDIŞIKTI. Gerçek çağrının
   * fetch izi ölçüldü (galzura-demo, 30 gün, 29 araç, 121 istek, toplam 16.518 ms):
   *
   *     0 araç/personel     242 ms
   *     1 yüzde RPC ×29   4.783 ms   ← stats üretir
   *     2 litre RPC ×10   1.242 ms   ← stats'e BAĞLI (yalnız yüzdesi olmayan araç)
   *     3 filo span       4.955 ms   ← BAĞIMSIZ (yalnız vehicles)
   *     4 yakıt penceresi   446 ms   ← BAĞIMSIZ (yalnız vehicles)
   *     5 sıfır sayımı     4.839 ms   ← stats'e BAĞLI (yalnız yüzdesi olan araç)
   *
   * 3 ve 4 hiçbir aramasını beklemiyordu; 2 ve 5 birbirini beklemiyordu.
   * Sıralama ölçüldü (demo, 30 gün, 3 tur medyan):
   *     A · bugünkü (tamamen ardışık)   16.635 ms
   *     C · bağımsızlar örtüşür        10.783 ms   → −%35
   *
   * ⚠️ FORMÜL DEĞİŞMİYOR. Sadece bekleme sırası değişti; her aşamanın kendi
   * `mapBounded` tavanı (6) ve kendi geri düşüşü aynen duruyor.
   *
   * ⚠️ ÖRTÜŞME TAVANI KIŞKIRTIR — ve bu ÖLÇÜLDÜ, varsayılmadı.
   * `lib/db-fanout.ts` şunu söylüyor: statement timeout İFADEYE uygulanır, yani
   * eşzamanlılık her ifadenin KENDİ süresini uzatır. Filo span'i tek başına
   * ~5 sn olan bir ifade; 12 sorgu daha eşlik ederse 8 sn'yi aşıyor ve `null`
   * dönüyor. Bu yüzden YAKIT PENCERESİ ERKEN BAŞLATILMIYOR (aşağıda) — tepe
   * eşzamanlılık 7'de kalıyor: 6 yüzde RPC + 1 span.
   */
  const filoSpanP = okuFiloSpan(startISO, endISO).catch(() => null);

  // 280 bin satır Postgres'te toplulaştırılır. Hata hâlinde rapor çökmez ama
  // SEBEBİ ayırt edilir — "fonksiyon yok" ile "zaman aşımı" farklı sorunlardır
  // ve yöneticiye farklı şey yaptırırlar (migration çalıştır / aralığı daralt).
  // ── ARAÇ BAZINDA PARÇALAMA (migration 050, 09.08.2026) ────────────────────
  //
  // Tek çağrılı `report_fuel_stats` 30 günlük aralıkta 8,3 sn'de 57014
  // (statement timeout) veriyordu ve rapor HİÇ açılmıyordu (ölçüldü canlıda).
  // Sebep indeks değil (049 devreye girdi, süre artık aralıkla ölçekleniyor):
  // ~690 bin satır üstünde iki pencere fonksiyonu + lag + iki array_agg.
  //
  // `report_fuel_stats_vehicle` aynı gövdenin araç-filtreli hâli: her çağrı
  // verinin ~1/29'unu görür, pencere fonksiyonları küçük kümede koşar ve 29
  // çağrı PARALEL gider. ÖLÇÜLDÜ (30 gün, 29 araç): 6.005 ms, 29/29 başarılı.
  //
  // GERİYE DÖNÜK: 050 uygulanmamış ortamda ilk araç PGRST202 döner ve tek
  // çağrılı eski yola düşeriz — Sendigo/demo kurulumları migration sırası
  // yüzünden raporsuz kalmaz.
  //
  //
  // ── DE-GLITCH GEVŞETİLMEZ (09.08.2026, ölçümle kapandı) ───────────────────
  //
  // "Sistem %0'dan başlayan dolumları kaçırıyor, 7 günde ~98 L" iddiası
  // ÖLÇÜLDÜ VE ÇÜRÜTÜLDÜ. İddia, HAM telemetri üzerinde koşan bir denetimden
  // doğmuştu; o denetim de-glitch'in TEMİZLEDİĞİ çukurları "dolum" sanıyordu.
  //
  // Gerçek (7 gün, 189.517 okuma, tüm filo): de-glitch YALNIZCA 3 SATIR siliyor
  // (%0,0016) ve üçü de TEK SATIRLIK. Sözde kayıp dolumların ham hâli:
  //     DO-818HF 06.08 08:04 %67 → 08:27 %0 → 08:32 %67   odometre 45846 → 45846
  //     DO-282HF 06.08 12:01 %34 → 12:19 %0 → 12:20 %34   odometre 39833 → 39833
  //     DO-282HF 08.08 aynı desen
  // Depo dolumdan ÖNCE de sonra da aynı seviyede ve araç hiç yol almamış. 23
  // dakikada %67 tüketip tam aynı seviyeye dönmek fiziksel olarak imkânsız —
  // bunlar dolum değil, tek örneklik sensör sıçraması. De-glitch'in var olma
  // sebebi tam olarak budur ve işini cerrahi kesinlikte yapıyor.
  //
  // "%0'dan yükselişi dolum say" kuralı eklenseydi bu üç sıçrama YANLIŞ POZİTİF
  // olur, rapora ~98 L hayalet yakıt girerdi. Eklenmedi ve eklenmemeli.
  //
  // 5 PUANLIK EŞİK de doğru yerde: temizlenmiş seride eşiğin altında kalan 848
  // seri var (7 gün, toplam 708 L) ama ortalaması 0,8 L — sensör salınımı.
  // ≥3 puana ulaşan yalnız 6 tanesi var (17,6 L) ve ALTISINDA DA odometre 0 km,
  // ikişerli çiftler hâlinde ve depo neredeyse doluyken (%93-100): yakıt
  // çalkalanması/oturması. Onları saymak da hayalet litre üretirdi.
  //
  // ── EŞZAMANLILIK TAVANI (09.08.2026) ──────────────────────────────────────
  // "29 çağrı PARALEL gider" cümlesi doğruydu ama eksikti: 30 çağrı aynı anda
  // gidince her ifadenin KENDİ süresi uzuyor ve statement timeout duvar saatine
  // değil ifadeye uygulanıyor. Ölçüldü: 30 eşzamanlıda en kötü ifade 7.683 ms,
  // tavan 8.000 ms — pay %4. Soğuk turda 12/30 araç 57014 aldı. mapBounded(6)
  // ile en kötü ifade 1.443 ms (pay 5,5×) VE duvar saati %33 daha kısa.
  // Gerekçenin tam ölçüm tablosu lib/db-fanout.ts'te.
  /**
   * ── ÖN-ETİKETLİ YOL (migration 101, 16.09.2026) ─────────────────────────
   *
   * `report_fuel_stats_vehicle_v2` AYNI ÇIKTIYI üretir; farkı, 31 satırlık
   * iki kayan maksimumu okuma anında hesaplamak yerine `fuel_seri`den
   * okumasıdır. Ölçülen maliyet (en yoğun araç, 30 gün): eski yol
   * HAK61 969 ms · demo 1.466 ms; marjinal ~12,8 µs/satır ve bu tamamen
   * o iki pencere fonksiyonunun CPU'su (soğuk ≈ sıcak).
   *
   * ⚠️ MELEZ OKUMA v2'NİN İÇİNDE. Gecelik cron'dan sonra gelen telemetri
   * (bugünün kısmi günü) etiketsizdir; v2 o kuyruğu CANLI hesaplar. Yani
   * "hafta"/"ay" gibi ŞİMDİ biten pencereler bayat kalmaz ve bölme
   * noktasında 090'ın ölçtüğü parçalama sapması doğmaz (etiket satır
   * başına komşuluk değeridir, gün özeti değil).
   *
   * ⚠️ GERİ DÜŞÜŞ TAM: v2 yoksa (101 uygulanmamış) rapor KOMPLE eski yola
   * döner — yarısı yeni yarısı eski bir sonuç ÜRETİLMEZ.
   */
  const yuzdeRpc = YAKIT_OZET_ENABLED
    ? "report_fuel_stats_vehicle_v2"
    : "report_fuel_stats_vehicle";
  const yuzdeCagir = (rpc: string) =>
    mapBounded(vehicles, (v) =>
      supabaseAdmin.rpc(rpc, {
        p_from: startISO,
        p_to: endISO,
        p_vehicle_id: v.id,
      })
    );
  let perVehicle = await yuzdeCagir(yuzdeRpc);
  if (
    yuzdeRpc !== "report_fuel_stats_vehicle" &&
    perVehicle.some((r) => r.error && classifyRpcError(r.error) === "missing_function")
  ) {
    // 101 bu kiracıda çalışmamış. Tek tur bedel, sonra bugünkü yol.
    perVehicle = await yuzdeCagir("report_fuel_stats_vehicle");
  }
  const missingFn = perVehicle.find(
    (r) => r.error && classifyRpcError(r.error) === "missing_function"
  );
  let statRows: FuelStatRow[];
  /**
   * Hesaplanamayan araçlar. Rapor bunları SESSİZCE atlamaz — eksik rakam
   * göstermek, hata göstermekten kötüdür (Volkan, 09.08.2026).
   */
  let failedPlates: string[] = [];
  let failedReason: FuelUnavailableReason = null;
  if (missingFn) {
    const { data: statData, error } = await supabaseAdmin.rpc("report_fuel_stats", {
      p_from: startISO,
      p_to: endISO,
    });
    if (error) return empty(classifyRpcError(error));
    statRows = (statData ?? []) as FuelStatRow[];
  } else {
    // Araç başına hata TÜM raporu düşürmez: bir aracın zaman aşımı yalnız o
    // aracı "Veri yok" yapar. Ama HEPSİ hata verdiyse gerçek bir arıza var —
    // sessizce boş rapor basmak, 057014'ü "yakıt verisi yok" gibi gösterirdi.
    const failed = perVehicle.filter((r) => r.error);
    if (failed.length === perVehicle.length && perVehicle.length > 0) {
      return empty(classifyRpcError(failed[0].error!));
    }
    // TEK SEFERLİK TEKRAR: zaman aşımı YÜKE bağlıdır, veriye değil. Yeniden
    // deneme SIRAYLA gider (eşzamanlılık 1) — ilk turda ifadeyi tavana iten
    // şeyin ta kendisi rekabetti, tekrar turunda rakip yok. Ölçüm: tek başına
    // en pahalı araç 873 ms, tavanın 1/9'u.
    // YALNIZ zaman aşımı tekrarlanır: başka hata tekrarla düzelmez, denemek
    // yalnız sayfayı bekletir (aynı gerekçe lib/db-fanout.ts'te).
    const retryIdx = perVehicle
      .map((r, i) => (isTimeoutError(r.error) ? i : -1))
      .filter((i) => i >= 0);
    for (const i of retryIdx) {
      // ⚠️ Tekrar AYNI sürümle yapılır: ilk tur v2 ile koştuysa tekrar da
      // v2 olmalı, yoksa tek araç sessizce başka bir yoldan hesaplanırdı.
      perVehicle[i] = await supabaseAdmin.rpc(yuzdeRpc, {
        p_from: startISO,
        p_to: endISO,
        p_vehicle_id: vehicles[i].id,
      });
    }
    const stillFailed = perVehicle
      .map((r, i) => (r.error ? i : -1))
      .filter((i) => i >= 0);
    if (stillFailed.length > 0) {
      failedPlates = stillFailed.map((i) => vehicles[i].plate);
      failedReason = classifyRpcError(perVehicle[stillFailed[0]].error!);
    }
    statRows = perVehicle.flatMap((r) => ((r.data ?? []) as FuelStatRow[]));
  }

  const stats = new Map(statRows.map((s) => [s.vehicle_id, s]));

  // LİTRE YOLU (039). Yüzdenin YERİNE değil, YOKLUĞUNDA devreye girer — hem
  // yüzde hem hacim gönderen araçlarda hacim çöp olduğu için (bkz. migration
  // 039 başlığı). RPC yoksa (039 uygulanmamış) sessizce boş: yüzde yolu
  // etkilenmez, litre araçları eskisi gibi "Veri yok" kalır.
  const volStats = new Map<string, FuelVolumeStatRow>();
  /**
   * ⚠️ Bu blok artık HEMEN BEKLENMİYOR: sıfır sayımıyla birlikte tek dalgada
   * beklenecek (aşağıdaki `Promise.all`). İçerik birebir aynı.
   */
  const volStatsP = (async () => {
    /**
     * ── ARAÇ EKSENİ (094) — 052'nin YÜZDE için yaptığının LİTRE ikizi ──────
     *
     * Bu blok 28.08.2026'ya kadar `report_fuel_volume_stats`i KAPSAMSIZ tek
     * gövde olarak, her rapor render'ında koşulsuz çağırıyordu. Ölçüldü
     * (HAK61 canlı): **5.086 / 4.582 ms**, ve `co2Panosu()` bu raporu tek
     * açılışta 7 kez koşturuyor (1 aralık + 6 aylık seri) — yani ~35 sn'nin
     * kaynağı buydu. Yüzde ikizi 46 günlük pencerede zaten `57014` alıyor;
     * kapsamsız litre gövdesi aynı duvara koşuyordu.
     *
     * Sıra ve gerekçe yüzde yolunun AYNISI (yukarısı): `mapBounded(6)` —
     * statement timeout ÇAĞRIYA değil İFADEYE uygulanır, sınırsız fan-out
     * her ifadenin kendi süresini uzatır.
     *
     * ── GERİ DÜŞÜŞ KORUNDU ────────────────────────────────────────────────
     * 094 uygulanmamış kiracıda RPC yok → `missing_function` → KAPSAMSIZ
     * 039 yoluna düşülür ve davranış birebir eskisi olur. Yani bu deploy
     * migration'dan ÖNCE de güvenlidir.
     *
     * ── SESSİZ BOŞ, SESSİZ YANLIŞ DEĞİL ───────────────────────────────────
     * Litre yolu yüzdenin YOKLUĞUNDA devreye giren ikincil hattır; bir
     * aracın sorgusu düşerse o araç eskisi gibi "Veri yok" kalır (yüzde
     * yolundaki `failedPlates` muhasebesi burada YOK — davranış değişmesin
     * diye bilerek eklenmedi). Zaman aşımı bir kez, SIRAYLA tekrarlanır:
     * tekrar turunda rakip ifade yoktur.
     */
    /**
     * ── YALNIZ GEREKEN ARACA SORULUR (16. madde, 16.09.2026) ──────────
     *
     * Litre yolu aşağıda `(!s || sample_count === 0)` koşuluyla, yani
     * YÜZDE OKUMASI OLMAYAN araçta devreye giriyor. Buna rağmen RPC
     * 28.08–16.09 arası TÜM araçlar için çağrılıyordu ve yüzde okuması
     * olan araçların sonucu hiç okunmadan atılıyordu.
     *
     * ÖLÇÜLDÜ ("ay" penceresi, 29 araç): yüzde okuması olan 19, litre
     * yolunun gerçekten gerektiği 10 araç.
     *     galzura-demo  29 çağrı 10.672 ms → 10 çağrı 5.602 ms
     *     HAK61         29 çağrı  4.331 ms → 10 çağrı 1.583 ms
     * Çıktı BİREBİR aynı: atılan sonuçlar zaten hiçbir satıra girmiyordu.
     *
     * Liste BOŞSA hiç çağrı yapılmaz; `volStats` boş kalır ve o da eski
     * davranışın aynısıdır (her araçta yüzde varsa litre yolu zaten hiç
     * okunmuyordu). 039/094 geri düşüşü yalnız gerçekten litreye ihtiyaç
     * duyulduğunda aranır — olmayan bir ihtiyaç için geri düşüş aramak
     * turun en pahalı sorgusunu bedavaya koşturmaktı.
     */
    const litreGerekenler = vehicles.filter((v) => {
      const s = stats.get(v.id);
      return !s || Number(s.sample_count) === 0;
    });
    /**
     * ── ÖN-ETİKETLİ LİTRE YOLU (migration 103, 17.09.2026) ────────────
     *
     * 101+102 yüzde hattını %40 hızlandırınca aşama ölçümü (galzura-demo,
     * "ay") en pahalı kalemin ARTIK LİTRE olduğunu gösterdi:
     *     yüzde ×29  7.151 → 4.296 ms   ·   LİTRE ×10  5.171 ms
     * 103, 101'in birebir ikizi (`fuel_volume_seri` + v2). Aynı melez
     * okuma, aynı geri düşüş, AYNI BAYRAK.
     *
     * ⚠️ v2 yoksa (103 uygulanmamış) LİTRE HATTI KOMPLE eskiye döner —
     * yarısı yeni yarısı eski bir sonuç ÜRETİLMEZ. Yüzde hattı bundan
     * bağımsız: 101 var 103 yok olabilir ve her iki hat da doğru çalışır.
     */
    const litreRpc = YAKIT_OZET_ENABLED
      ? "report_fuel_volume_stats_vehicle_v2"
      : "report_fuel_volume_stats_vehicle";
    const litreCagir = (rpc: string) =>
      mapBounded(litreGerekenler, (v) =>
        supabaseAdmin.rpc(rpc, {
          p_from: startISO,
          p_to: endISO,
          p_vehicle_id: v.id,
        })
      );
    let volPer = await litreCagir(litreRpc);
    if (
      litreRpc !== "report_fuel_volume_stats_vehicle" &&
      volPer.some((r) => r.error && classifyRpcError(r.error) === "missing_function")
    ) {
      volPer = await litreCagir("report_fuel_volume_stats_vehicle");
    }
    const volMissing = volPer.find(
      (r) => r.error && classifyRpcError(r.error) === "missing_function"
    );
    let volRows: FuelVolumeStatRow[];
    if (volMissing) {
      const { data: volData, error: volErr } = await supabaseAdmin.rpc(
        "report_fuel_volume_stats",
        { p_from: startISO, p_to: endISO }
      );
      volRows = volErr ? [] : ((volData ?? []) as FuelVolumeStatRow[]);
    } else {
      const volRetry = volPer
        .map((r, i) => (isTimeoutError(r.error) ? i : -1))
        .filter((i) => i >= 0);
      for (const i of volRetry) {
        // ⚠️ Tekrar AYNI sürümle (yüzde hattındaki kuralın aynısı).
        volPer[i] = await supabaseAdmin.rpc(litreRpc, {
          p_from: startISO,
          p_to: endISO,
          // ⚠️ İNDİS `litreGerekenler`e ait, `vehicles`e DEĞİL.
          p_vehicle_id: litreGerekenler[i].id,
        });
      }
      volRows = volPer.flatMap((r) => (r.data ?? []) as FuelVolumeStatRow[]);
    }
    for (const s of volRows) {
      // GÜRÜLTÜ MUHAFIZI: sıçraması eşiği aşan seri hiç kabul edilmez.
      if (Number(s.max_step_l) > FUEL_VOLUME_MAX_STEP_L) continue;
      if (Number(s.sample_count) === 0) continue;
      volStats.set(s.vehicle_id, s);
    }
  })();

  // L/100km için mesafe — mesafe raporuyla AYNI kaynak (odometre uç-noktaları +
  // km-guard). Araç başına iki indeksli sorgu, telemetri satırı taşımaz.
  // 22.07.2026: artık ölçüm PENCERESİ de geliyor (aşağıdaki 3. kapı için).
  // Eşzamanlılık tavanı: bu fan-out araç başına İKİ sorgu açıyor, yani sınırsız
  // hâlinde 60 ifade. Yakıt RPC'siyle aynı gerekçe (bkz. lib/db-fanout.ts).
  /**
   * ⚠️ Sıfır sayımı `stats`e bağlı (yalnız yüzde okuması OLAN araçta sorulur),
   * litre yolu da öyle — ama BİRBİRİNE bağlı değiller. İkisi birlikte, erken
   * başlatılan span ve yakıt penceresiyle AYNI DALGADA beklenir.
   */
  /**
   * ══ ARIZALI SENSÖR SAYIMI: ÖNCE YANITTAN (107), YOKSA 19 SORGU ════════
   *
   * Ölçüldü (galzura-demo, 30 gün, 29 araç, gerçek çağrının fetch izi):
   *     19 istek · Σ 27.974 ms · duvar saati 4.839 ms
   * Tek başına 179 ms olan sorgu, rekabet altında ~1,4 sn'ye çıkıyordu —
   * yüzde RPC'leri kadar pahalıydi. Sayı zaten o RPC'nin taradığı satırlardan
   * geliyor; 107 onu yanıta `zero_count` olarak ekliyor.
   *
   * ⚠️ KOLON YOKSA DAVRANIS BİREBİR ESKİSİ. 107 uygulanmamış kiracıda (ya da
   * 2 argümanlı `report_fuel_stats` geri düşüşünde) hiçbir satır bu kolonu
   * taşımaz ve eski fan-out aynen koşar. Karar SATIRLARA bakılarak veriliyor,
   * bayrağa değil: kiracı migration'ı ne zaman uygularsa o zaman geçer.
   */
  const sifirKolonuVar = statRows.some((r) => r.zero_count !== undefined);
  const zeroP: Promise<(readonly [string, number])[]> = sifirKolonuVar
    ? Promise.resolve(
        vehicles.map((v) => {
          const s = stats.get(v.id);
          // Satır yoksa (temiz seri boş) eski yol da 0 veriyordu — aynı sonuç.
          return [v.id, s ? Number(s.zero_count ?? 0) : 0] as const;
        })
      )
    : mapBounded(vehicles, async (v) => {
        const s = stats.get(v.id);
        if (!s || Number(s.sample_count) === 0) return [v.id, 0] as const;
        const { count } = await supabaseAdmin
          .from("device_telemetry")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", v.id)
          .eq("fuel_level_pct", 0)
          .gte("recorded_at", startISO)
          .lte("recorded_at", endISO);
        return [v.id, count ?? 0] as const;
      });

  /**
   * ⚠️ YAKIT PENCERESİ BURADA BAŞLAR, DAHA ERKEN DEĞİL — ölçümle seçildi.
   * Erken başlatan varyant tepe eşzamanlılığı 19'a çıkarıyor ve galzura-demo'da
   * filo span'ini 8 sn'lik ifade tavanının üstüne itiyordu: span `null` dönüyor,
   * araç-araç yedek yol devreye giriyor (105 sayesinde AYNI SAYI, ama +2,5 sn).
   * Ölçüldü: `karsilastir?donem=ay` demo'da 14,3 → 16,8 sn ile GERİLEMİŞTİ.
   */
  const fuelSpanP = mapBounded(vehicles, async (v) => {
    return [v.id, await getVehicleFuelSpan(v.id, startISO, endISO)] as const;
  });

  const [filoSpan, fuelSpanEntries, zeroEntries] = await Promise.all([
    filoSpanP,
    fuelSpanP,
    zeroP,
    volStatsP,
  ]);

  const distEntries = filoSpan
    ? vehicles.map((v) => [v.id, filoSpan.get(v.id) ?? BOS_SPAN] as const)
    : // 105 uygulanmamış kiracı: araç-araç yol. AYNI ÇEKİRDEK, yalnız yavaş.
      await mapBounded(
        vehicles,
        async (v) => [v.id, await okuAracSpan(v.id, startISO, endISO)] as const
      );
  const distByVehicle = new Map(distEntries);
  const fuelSpanByVehicle = new Map(fuelSpanEntries);
  const zeroByVehicle = new Map(zeroEntries);

  /**
   * ARIZALI SENSÖR TESPİTİ (22.07.2026) — `zeroP` yukarıda, tek dalgada.
   * Canlı örnek DO-687GX: 18.07'de 7.801 okumanın 1.729'u (%22) %0. Bu bir CAN
   * dropout çukuru DEĞİL — yarı ölü sensörün sürekli sıfırı; de-glitch onu elemez
   * ve ELEMEMELİ (sürekli sıfır gerçek bir sinyal olabilir). Ama böyle bir seriden
   * hesaplanan tüketim ve dolum sayıları anlamsızdır: sıfır serisinin bitişi
   * "dolum" gibi görünür.
   *
   * Ölçüm HAM veri üzerinden yapılır (de-glitch öncesi), çünkü soru "sensör
   * sağlıklı mı" — "temizlikten sonra ne kaldı" değil. Yalnız başlık sayısı
   * çekilir (head:true), satır taşınmaz.
   *
   * 🔴 ÖLÇÜLDÜ (17.09.2026): bu 19 sayım sorgusu tek başına 4.839 ms duvar
   * saati (Σ 27.974 ms) tutuyordu — yüzde RPC'leri kadar pahalı. Tek başına
   * çalışınca 179 ms; fark tamamen eşzamanlılık rekabeti.
   *
   * ✅ 107 bunu ÇÖZDÜ: sayı artık yüzde RPC'sinin yanıtından geliyor
   * (`zero_count`), ayrı sorgu yok. Yukarıdaki fan-out YALNIZ 107
   * uygulanmamış kiracıda koşuyor.
   *
   * ⚠️ DÜZELTME: "093 `fuel_level_pct = 0` indeksini düşürdü" diye bir not
   * düşülmüştü — YANLIŞTI. 093'ün düşürdüğü `idx_device_telemetry_fuel`,
   * 053'ün `idx_device_telemetry_vehicle_fuel_pct` indeksinin BİREBİR
   * KOPYASIYDI ve yüklemi `fuel_level_pct IS NOT NULL`dı, `= 0` değil.
   * Kalan indeks yerinde. `= 0` için ayrı bir kısmi indekse de gerek yok:
   * 107'nin planında `device_telemetry`ye İKİNCİ BİR ERİŞİM YOK (ölçüldü,
   * `verify:yakit-son-toplama` § 3).
   */

  /**
   * ÜÇ KAPI (22.07.2026 veri bütünlüğü denetimi).
   * Canlıda "80,0 L/100km" ve "4,0 L/100km" gösterildi; ikisi de gerçek değildi.
   *   1. PAYDA  : mesafe ≥ FUEL_MIN_KM            (80,0 vakası — payda 2,5 km'ydi)
   *   2. PAY    : tüketim ≥ FUEL_MIN_CONSUMED_PCT (4,0 vakası — sensör gürültüsü)
   *   3. PENCERE: odometre penceresi, yakıt penceresinin ≥%80'ini kapsamalı
   *               (en sinsi olan: pay 3 günü, payda 2,5 km'yi ölçüyordu)
   * Kapılardan biri kapalıysa SAYI GÖSTERİLMEZ ve sebebi ekrana taşınır.
   */
  const l100Gate = (
    km: number | null,
    kmReason: DistanceUnavailableReason,
    consumedPct: number,
    unreliable: boolean,
    hasCapacity: boolean,
    fuelSpan: { firstAt: string | null; lastAt: string | null },
    odoSpan: { firstAt: string | null; lastAt: string | null }
  ): FuelRatioReason => {
    if (unreliable) return "unreliable_sensor";
    // Depo hacmi girilmemişse yüzdeyi litreye çeviremeyiz → oran YOK. Bu bir
    // ölçüm sorunu değil, EKSİK KAYIT: sebebi ayrı yazılır ki yönetici cihazı
    // değil FORMU kontrol etsin (canlı vaka DO-671GY, 22.07.2026 doğrulaması —
    // sebep null kalınca ekranda yanlışlıkla "Odometre verisi yok" yazıyordu).
    if (!hasCapacity) return "no_capacity";
    const kmReasonOrNull = checkKmDenominator(km, kmReason, FUEL_MIN_KM);
    if (kmReasonOrNull !== null) return kmReasonOrNull;
    if (consumedPct < FUEL_MIN_CONSUMED_PCT) return "too_little_fuel";

    // 3. kapı: iki pencerenin ÖRTÜŞMESİ. Yakıt penceresi tek noktaysa (süre 0)
    // örtüşme doğrulanamaz → temkinli davran, gösterme.
    const fA = fuelSpan.firstAt ? Date.parse(fuelSpan.firstAt) : NaN;
    const fB = fuelSpan.lastAt ? Date.parse(fuelSpan.lastAt) : NaN;
    const oA = odoSpan.firstAt ? Date.parse(odoSpan.firstAt) : NaN;
    const oB = odoSpan.lastAt ? Date.parse(odoSpan.lastAt) : NaN;
    if (!Number.isFinite(fA) || !Number.isFinite(fB) || !Number.isFinite(oA) || !Number.isFinite(oB)) {
      return "window_mismatch";
    }
    const fuelMs = fB - fA;
    if (fuelMs <= 0) return "window_mismatch";
    const overlapMs = Math.max(0, Math.min(fB, oB) - Math.max(fA, oA));
    if (overlapMs / fuelMs < FUEL_MIN_WINDOW_OVERLAP_RATIO) return "window_mismatch";
    return null;
  };

  const rows: FuelRow[] = vehicles.map((v) => {
    const cap = v.tank_capacity_l != null ? Number(v.tank_capacity_l) : null;
    const span = distByVehicle.get(v.id) ?? { km: null, reason: null, firstAt: null, lastAt: null };
    const km = span.km;
    const driverName = v.assigned_worker_id
      ? workerName.get(v.assigned_worker_id) ?? null
      : null;
    const s = stats.get(v.id);

    // ── LİTRE YOLU (039) ── yüzde okuması YOKSA devreye girer.
    // Depo kapasitesine İHTİYAÇ YOK: litre zaten litre. %15 tüketim eşiğinin
    // yerini FUEL_MIN_CONSUMED_L alır. Gürültülü seriler volStats'a hiç
    // girmediği için burada ayrıca elemeye gerek yok.
    const vol = (!s || Number(s.sample_count) === 0) ? volStats.get(v.id) : undefined;
    if (vol) {
      const first = vol.first_l != null ? Number(vol.first_l) : 0;
      const last = vol.last_l != null ? Number(vol.last_l) : 0;
      const refillL = Number(vol.refill_l) || 0;
      const consumedLiters = Math.max(0, refillL + (first - last));
      const dropL = Number(vol.drop_l) || 0;
      const gate = l100Gate(
        km,
        span.reason,
        // Yüzde kapısı yerine litre kapısı: eşiği geçmişse "yeterli tüketim"
        // say (kapı yüzde üzerinden bakıyor, litreyi oraya çeviremeyiz).
        consumedLiters >= FUEL_MIN_CONSUMED_L ? FUEL_MIN_CONSUMED_PCT : 0,
        false,
        true, // kapasite ŞARTI YOK — litre yolunda gerekmiyor
        fuelSpanByVehicle.get(v.id) ?? { firstAt: null, lastAt: null },
        { firstAt: span.firstAt, lastAt: span.lastAt }
      );
      return {
        vehicleId: v.id,
        plate: v.plate,
        driverName,
        tankCapacityL: cap,
        hasData: true,
        sampleCount: Number(vol.sample_count),
        // Ortalama SEVİYE yüzdesi litre yolunda bilinmiyor (depo hacmi
        // olmadan yüzdeye çevrilemez) — uydurmak yerine null.
        avgPct: null,
        minPct: null,
        maxPct: null,
        refillCount: Number(vol.refill_count) || 0,
        refillPct: 0,
        refillLiters: refillL,
        consumedPct: 0,
        consumedLiters,
        km,
        lPer100Km: gate === null && km ? (consumedLiters / km) * 100 : null,
        lPer100Reason: gate,
        suspiciousDropCount: Number(vol.drop_count) || 0,
        suspiciousDropPct: 0,
        suspiciousDropLiters: dropL,
        zeroCount: 0,
        zeroRatio: 0,
        dataUnreliable: false,
      };
    }

    if (!s || Number(s.sample_count) === 0) {
      return {
        vehicleId: v.id,
        plate: v.plate,
        driverName,
        tankCapacityL: cap,
        hasData: false,
        sampleCount: 0,
        avgPct: null,
        minPct: null,
        maxPct: null,
        refillCount: 0,
        refillPct: 0,
        refillLiters: null,
        consumedPct: 0,
        consumedLiters: null,
        km,
        lPer100Km: null,
        // Aralıkta hiç yakıt okuması yok: L/100km'nin PAYI ölçülemedi.
        lPer100Reason: "too_little_fuel",
        suspiciousDropCount: 0,
        suspiciousDropPct: 0,
        suspiciousDropLiters: null,
        zeroCount: 0,
        zeroRatio: 0,
        dataUnreliable: false,
      };
    }
    const zeroCount = zeroByVehicle.get(v.id) ?? 0;
    // Payda de-glitch SONRASI örnek sayısı; de-glitch yalnız birkaç V-çukurunu
    // atar (canlı: 277 → 276), yani oran pratikte ham orana eşit. 1'e kırpılır.
    const zeroRatio = Math.min(1, zeroCount / Math.max(1, Number(s.sample_count)));
    const first = s.first_pct != null ? Number(s.first_pct) : 0;
    const last = s.last_pct != null ? Number(s.last_pct) : 0;
    const refillPct = Number(s.refill_pct) || 0;
    const dropPct = Number(s.drop_pct) || 0;
    // Yakıt dengesi kimliği — tek kaynak lib/fuel-math.ts (mobil vardiya
    // detayı da aynı fonksiyonu çağırır).
    const consumedPct = fuelConsumedPct(first, last, refillPct);
    const consumedLiters = pctToLiters(consumedPct, cap);
    const unreliable = zeroRatio > UNRELIABLE_ZERO_RATIO;

    // ÜÇ KAPI. Kapasitesi girilmemiş araçta litre yok → oran zaten hesaplanamaz;
    // sebebi "yeterli tüketim yok" değil, kapasite eksikliğidir ve ayrı bir not
    // olarak zaten gösteriliyor (fuel_capacity_note).
    const gateReason = l100Gate(
      km,
      span.reason,
      consumedPct,
      unreliable,
      cap != null,
      fuelSpanByVehicle.get(v.id) ?? { firstAt: null, lastAt: null },
      { firstAt: span.firstAt, lastAt: span.lastAt }
    );
    // gateReason null ⇒ kapasite de var (no_capacity kapısından geçti), yani
    // consumedLiters kesinlikle dolu. Sebepsiz null oran ARTIK ÜRETİLEMEZ.
    const lPer100Km =
      gateReason === null ? ((consumedLiters as number) / (km as number)) * 100 : null;
    return {
      vehicleId: v.id,
      plate: v.plate,
      driverName,
      tankCapacityL: cap,
      hasData: true,
      sampleCount: Number(s.sample_count),
      avgPct: s.avg_pct != null ? Number(s.avg_pct) : null,
      minPct: s.min_pct != null ? Number(s.min_pct) : null,
      maxPct: s.max_pct != null ? Number(s.max_pct) : null,
      refillCount: Number(s.refill_count) || 0,
      refillPct,
      refillLiters: cap != null ? (refillPct / 100) * cap : null,
      consumedPct,
      consumedLiters,
      km,
      lPer100Km,
      lPer100Reason: gateReason,
      suspiciousDropCount: Number(s.drop_count) || 0,
      suspiciousDropPct: dropPct,
      suspiciousDropLiters: cap != null ? (dropPct / 100) * cap : null,
      zeroCount,
      zeroRatio,
      dataUnreliable: unreliable,
    };
  });

  // En çok yakan önce (litre biliniyorsa litreye, yoksa yüzdeye göre).
  // Sıra: güvenilir veri → güvenilmez sensör → verisi olmayan. Güvenilmez satır
  // listenin başında durursa "en çok yakan" izlenimi verir, oysa sayısı
  // gösterilmiyor bile.
  const tier = (r: FuelRow) => (!r.hasData ? 2 : r.dataUnreliable ? 1 : 0);
  rows.sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const av = a.consumedLiters ?? a.consumedPct;
    const bv = b.consumedLiters ?? b.consumedPct;
    return bv - av || a.plate.localeCompare(b.plate);
  });

  let totalConsumedLiters = 0;
  let refillTotalLiters = 0;
  let refillTotalCount = 0;
  let suspiciousVehicles = 0;
  let unreliableVehicles = 0;
  let measured = 0;
  let capacityMissing = 0;
  // Filo ortalaması AYRI biriktirilir: yalnız üç kapıyı da geçen araçlar
  // (22.07.2026). Eskiden satırda gizlenen bir aracın km'si ve litresi yine de
  // filo ortalamasına giriyordu — yani gizlediğimiz saçma değer, toplamın içinde
  // görünmeden yaşamaya devam ediyordu.
  let l100Liters = 0;
  let l100Km = 0;
  let l100VehicleCount = 0;
  for (const r of rows) {
    if (r.hasData) measured++;
    if (r.hasData && r.tankCapacityL == null) capacityMissing++;
    if (r.dataUnreliable) {
      // Güvenilmez sensör filo toplamlarına GİRMEZ: satırda gizlediğimiz bir
      // sayıyı toplamda saymak, gizlemeyi anlamsız kılar ve L/100km'yi bozar.
      unreliableVehicles++;
      continue;
    }
    if (r.consumedLiters != null) totalConsumedLiters += r.consumedLiters;
    if (r.lPer100Km !== null && r.consumedLiters != null && r.km != null) {
      l100Liters += r.consumedLiters;
      l100Km += r.km;
      l100VehicleCount++;
    }
    if (r.refillLiters != null) refillTotalLiters += r.refillLiters;
    refillTotalCount += r.refillCount;
    if (r.suspiciousDropCount > 0) suspiciousVehicles++;
  }
  const fleetLPer100Km =
    l100Available && l100Km > 0 ? (l100Liters / l100Km) * 100 : null;

  return {
    available: true,
    unavailableReason: null,
    rows,
    vehicleCount: vehicles.length,
    measured,
    totalConsumedLiters,
    fleetLPer100Km,
    l100Available,
    rangeDays: days,
    l100VehicleCount,
    totalCostEur: totalConsumedLiters * FUEL_PRICE_EUR_PER_L,
    fuelPriceEurPerL: FUEL_PRICE_EUR_PER_L,
    fuelPriceIsCustom: FUEL_PRICE_IS_CUSTOM,
    fuelPriceSource: FUEL_PRICE_SOURCE,
    fuelPriceAsOf: FUEL_PRICE_AS_OF,
    refillTotalCount,
    refillTotalLiters,
    suspiciousVehicles,
    unreliableVehicles,
    capacityMissing,
    partialVehicles: failedPlates,
    partialReason: failedReason,
  };
}

// ═══════════════════ MALİYET RAPORU — €/km ve €/paket ═══════════════════════

export type CostReport = {
  basis: CostBasis;
  rates: CostRates;
  origin: CostRateOrigin;
  /**
   * migration 076 uygulanmamış → oranlar panelden girilemiyor, zincir env'den
   * başlıyor. Rapor yine çalışır; ayarlar ekranı bunu söyler.
   */
  ratesTableMissing: boolean;
  totals: CostBreakdown;
  /** Araç ekseninde satırlar — plakayla eşlenmiş, €/km'ye göre azalan. */
  vehicles: (CostVehicleRow & { plate: string; driverName: string | null })[];
  /**
   * Telemetriden ÖLÇÜLEN litre (yakıt raporundan gelir) — modelin gerçeklik
   * denetimi. null: yakıt raporu kullanılamadı.
   */
  measuredLiters: number | null;
  /** model litre ÷ ölçülen litre. 1'e yakınsa L/100km varsayımı tutuyor. */
  fuelReality: number | null;
};

/**
 * MALİYET RAPORU — dört kiracı oranını canlı vardiya paydalarıyla çarpar.
 *
 * ⚠️ PAYDA VARDİYA EKSENİNDEN (Volkan kararı, 23.08.2026). Gerekçe ve ölçüm:
 * bkz. lib/cost-model.ts başlık bloğu. Aynı `time_entries` okuması hem km hem
 * saat hem paket hem araç-gün üretir — dördü AYNI satırlardan gelmek zorunda,
 * yoksa dört payda zamanla ayrışır (15.08.2026'da skor ekseninde yaşandı).
 *
 * `fleetLPer100KmMeasured` DIŞARIDAN gelir: `buildFuelReport` canlıda 30 günlük
 * aralıkta ~60 sn sürüyor ve sayfa onu ZATEN çağırıyor. İkinci kez çağırmak
 * rapor süresini ikiye katlardı.
 *
 * ⚠️ Yeni bir migration ya da yeni kolon GEREKTİRMEZ — tamamı mevcut şemadan.
 */
export async function buildCostReport(
  range: DateRange,
  fuelInput: {
    /** buildFuelReport().fleetLPer100Km — null: ölçülemedi. */
    fleetLPer100Km: number | null;
    /** buildFuelReport().totalConsumedLiters — rapor kullanılamıyorsa null. */
    measuredLiters: number | null;
  }
): Promise<CostReport> {
  const fleetLPer100KmMeasured = fuelInput.fleetLPer100Km;
  const scope = await getTestScope();
  const driverScope = await getDriverScope();

  const [{ data: entryData }, { data: vData }, { data: wData }] =
    await Promise.all([
      fetchAllRows<TimeEntry>(
        (from, to) =>
          // test-filtered + driver-scoped: yönetici hesabından açılmış demo
          // vardiyalar km'yi ve saati doğrudan şişirir (20.100 km'lik vaka,
          // bkz. lib/driver-scope.ts). Payda kirlenirse €/km sessizce düşer.
          onlyDrivers(
            withoutTestRows(
              supabaseAdmin
                .from("time_entries")
                .select(
                  "id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km, break_minutes, cargo_count, undelivered_count"
                )
                .gte("started_at", range.start.toISOString())
                .lte("started_at", range.end.toISOString())
                .order("started_at", { ascending: true })
                .order("id")
                .range(from, to),
              "worker_id",
              scope.workerIds
            ),
            "worker_id",
            driverScope
          ),
        "buildCostReport/time_entries"
      ),
      supabaseAdmin.from("vehicles").select("id, plate, assigned_worker_id"),
      // test-visible: yalnız İSİM ETİKETİ sözlüğü — hiçbir SAYIYI etkilemez.
      // Maliyet satırları ARAÇ eksenlidir (km/saat/paket/araç-gün hepsi araca
      // toplanır); buradaki ad "bu aracı kim kullanıyor" etiketinden ibaret.
      // Ayrılan personelin adı da görünmeli (7 yıl arşiv) → is_active filtresi
      // de yok.
      //
      // driver-scoped: KAPSAM BİLEREK UYGULANMADI — aynı gerekçe, aynı dosyada
      // buildFuelReport'ta da yazılı. Kapsamı uygulamak tek bir sayıyı bile
      // değiştirmez; yalnız aracı olan bir yöneticinin etiketini "—"e çevirir,
      // yani bilgi kaybı olur, düzeltme değil. ŞOFÖR SAYAN yüzey bu değil:
      // paydaların şoför kapsamı yukarıdaki time_entries sorgusunda
      // onlyDrivers ile ZATEN uygulanıyor — €/km'yi kirletebilecek tek yol o.
      supabaseAdmin.from("workers").select("id, name"),
    ]);

  const vehicles = dropTestRows(
    (vData ?? []) as {
      id: string;
      plate: string;
      assigned_worker_id: string | null;
    }[],
    (v) => ({ vehicle: v.id }),
    scope
  );
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const workerName = new Map(
    ((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name])
  );
  const driverByVehicle = new Map(
    vehicles.map((v) => [
      v.id,
      v.assigned_worker_id ? (workerName.get(v.assigned_worker_id) ?? null) : null,
    ])
  );

  // km_measured: cihazı sessiz vardiyanın 0 km'si ÖLÇÜM DEĞİL → kmDiff null
  // döner ve paydaya girmez. Bu kapı olmasaydı 18.307 km'lik payda, hiç
  // ölçülmemiş vardiyaların 0'larıyla birlikte aynı € toplamını daha büyük bir
  // km'ye bölerdi (bkz. lib/km-quality.ts).
  const entries = await markKmMeasured((entryData ?? []) as TimeEntry[]);

  // AÇIK VARDİYA TAVANI: workedMs açık vardiyayı `now`a kadar sayar. Kapanmış
  // bir dönem raporunda bu, iki gün önce açık kalmış bir satırı 40 saatlik
  // işçiliğe çevirirdi. 052'nin `coalesce(ended_at, p_to)` kuralını uyguluyoruz.
  const clampNow = Math.min(Date.now(), range.end.getTime());
  // GÜNLÜK TAVAN: 12 sa (§ 9 Abs. 1 AZG). Gerekçe ve canlı ölçüm
  // lib/cost-model.ts → CostBasis.hourCapShifts başlığında.
  const hourCapMs = AZG_DAILY_MAX_MS;

  const perVehicle = new Map<
    string,
    { km: number; hours: number; parcels: number; days: Set<string> }
  >();
  const basis: CostBasis = {
    km: 0,
    kmShifts: 0,
    hours: 0,
    hourShifts: 0,
    hourCapShifts: 0,
    parcels: 0,
    parcelShifts: 0,
    vehicleDays: 0,
    vehicles: 0,
    totalShifts: entries.length,
  };
  const vehicleDayKeys = new Set<string>();

  for (const e of entries) {
    const vid = e.vehicle_id;
    const acc = vid
      ? (perVehicle.get(vid) ??
        (() => {
          const fresh = { km: 0, hours: 0, parcels: 0, days: new Set<string>() };
          perVehicle.set(vid, fresh);
          return fresh;
        })())
      : null;

    const d = kmDiff(e);
    // NEGATİF fark paydaya girmez: odometre geri sarması bir ölçüm değil.
    if (d !== null && d > 0) {
      basis.km += d;
      basis.kmShifts++;
      if (acc) acc.km += d;
    }

    const rawMs = workedMs(e, clampNow);
    if (rawMs > 0) {
      const capped = rawMs > hourCapMs;
      if (capped) basis.hourCapShifts++;
      const h = (capped ? hourCapMs : rawMs) / 3_600_000;
      basis.hours += h;
      basis.hourShifts++;
      if (acc) acc.hours += h;
    }

    if (e.cargo_count !== null && e.cargo_count !== undefined) {
      basis.parcels += e.cargo_count;
      basis.parcelShifts++;
      if (acc) acc.parcels += e.cargo_count;
    }

    if (vid) {
      const dayKey = `${vid}|${viennaDayKey(e.started_at)}`;
      vehicleDayKeys.add(dayKey);
      acc!.days.add(dayKey);
    }
  }
  basis.vehicleDays = vehicleDayKeys.size;
  basis.vehicles = perVehicle.size;

  // ── ORANLAR ────────────────────────────────────────────────────────────
  // Zincir TEK YERDE çözülür: panel satırı (076) > env > kod varsayılanı.
  // L/100km bu zincirin DIŞINDA — telemetriden ölçülür, panelde karşılığı yok.
  // Ayrıntı ve gerekçe: lib/cost-rates-db.ts.
  const cozum = await resolveCostRates(fleetLPer100KmMeasured);
  const rates = cozum.rates;
  const origin = cozum.origin;

  const totals = computeCost(basis, rates);

  const vehicleRows = [...perVehicle.entries()]
    .map(([vid, a]) => ({
      ...computeVehicleCost(vid, a.km, a.hours, a.days.size, a.parcels, rates),
      plate: plateById.get(vid) ?? "—",
      driverName: driverByVehicle.get(vid) ?? null,
    }))
    // €/km'si olmayan araç (km ölçülemedi) EN SONA — "0" gibi sıralanıp ucuz
    // görünmesin. Aynı üç-durum ayrımı skor tablosunda da uygulanıyor.
    .sort((a, b) => {
      const av = a.eurPerKm ?? -1;
      const bv = b.eurPerKm ?? -1;
      return bv - av || a.plate.localeCompare(b.plate);
    });

  return {
    basis,
    rates,
    origin,
    ratesTableMissing: cozum.tabloYok,
    totals,
    vehicles: vehicleRows,
    measuredLiters: fuelInput.measuredLiters,
    fuelReality: fuelRealityCheck(totals.modelLiters, fuelInput.measuredLiters),
  };
}

/** Rapor başlığında gösterilecek dönem etiketi (gün sayısı + tarih aralığı). */
export function rangeLabel(range: DateRange): { from: string; to: string; days: number } {
  return {
    from: viennaDayKey(range.start),
    to: viennaDayKey(range.end),
    days: rangeDays(range),
  };
}
