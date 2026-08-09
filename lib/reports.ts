import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import {
  computeSafetyScores,
  drivenVehiclesFromEntries,
  getVehicleDistanceSpan,
  getVehicleFuelSpan,
  listVehiclesAndWorkers,
  scoreMinKmForSpan,
  type DistanceUnavailableReason,
} from "@/lib/analytics";
import type { DateRange, SafetyScoreRow } from "@/lib/analytics-shared";
import {
  FUEL_L100_MIN_DAYS,
  FUEL_MIN_CONSUMED_PCT,
  FUEL_MIN_KM,
  FUEL_MIN_WINDOW_OVERLAP_RATIO,
  SPEED_MIN_KM,
} from "@/lib/metric-thresholds";
import { getTestScope, dropTestRows, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import {
  FUEL_PRICE_EUR_PER_L,
  FUEL_PRICE_SOURCE,
  FUEL_PRICE_AS_OF,
  FUEL_PRICE_IS_CUSTOM,
} from "@/lib/tenant";
import { workedMs, kmDiff, viennaDayKey } from "@/lib/format";
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
 */
export type RatioUnavailableReason = "no_odometer" | "inconsistent" | "too_short" | null;

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
  km: number | null;
  delivered: number;
  undelivered: number;
  /** Analiz'deki güvenlik skorunun AYNISI (null = yeterli km yok). */
  safetyScore: number | null;
  events: number;
  harshBraking: number;
  harshAcceleration: number;
  overspeeding: number;
};

export type PerformanceReport = {
  rows: PerformanceRow[];
  /** Skoru hesaplanabilen şoförlerin ortalaması (null'lar sayılmaz). */
  avgScore: number | null;
  totalShifts: number;
  totalWorkedMs: number;
  totalKm: number;
  scoredCount: number;
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
  const { vehicles, workers, workerNames } = await listVehiclesAndWorkers();
  const [events, idleEpisodes, spanEntries] = await Promise.all([
    listEventsInRange(startISO, endISO),
    listIdleEpisodesInRange(startISO, endISO),
    Promise.all(
      vehicles.map(
        async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)] as const
      )
    ),
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

  // Aralıktaki vardiyalar — admin panosuyla aynı alanlar, aynı türetmeler.
  const scope = await getTestScope();
  // SAYFALI (25.07.2026): PostgREST 1000 satırda kesiyor ve `.limit()` bunu
  // aşamıyor. ~29 şoför × 1 vardiya/gün ile tavan ~34 günde doluyordu; "son 3 ay"
  // ya da yıllık performans raporu sessizce eksik satırla hesaplanırdı.
  const driverScope = await getDriverScope();
  const { data: entryData } = await fetchAllRows<TimeEntry>(
    (from, to) =>
      // driver-scoped: yönetici hesabından açılmış vardiyalar bu rapora
      // GERÇEK vardiya gibi giriyordu. Canlıda iki demo satır vardı ve
      // toplam 20.100 km taşıyorlardı (biri 2 dakikada 20.000 km) — filo
      // km'sini, çalışma süresini ve teslimat sayısını doğrudan şişiriyordu.
      // Ayrılan şoförlerin vardiyaları KALIR: onlar şoför, arşiv 7 yıl.
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select(
              "id, worker_id, started_at, ended_at, start_km, end_km, break_minutes, cargo_count, undelivered_count"
            )
            .gte("started_at", base.startISO)
            .lte("started_at", base.endISO)
            .order("started_at", { ascending: true })
            .order("id")
            .range(from, to),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        driverScope
      ),
    "buildPerformanceReport/time_entries"
  );
  const entries = (entryData ?? []) as TimeEntry[];

  const safety = new Map<string, SafetyScoreRow>(
    computeSafetyScores(
      base.events,
      base.idleEpisodes,
      new Map(base.vehicles.map((v) => [v.id, v])),
      new Map(base.workers.map((w) => [w.id, w])),
      base.distanceByVehicle,
      // ANALİZ SAYFASIYLA AYNI KAPI (B, 27.07.2026): eşik aralık uzunluğuna
      // değil, şoförün araçlarının odometre penceresine göre ölçeklenir. İki
      // ekran aynı şoför için farklı karar veremez.
      (vehicleIds: string[]) =>
        scoreMinKmForSpan(
          range,
          vehicleIds.map(
            (id) => base.spanByVehicle.get(id) ?? { firstAt: null, lastAt: null }
          )
        ),
      // FİİLEN SÜRÜLEN ARAÇ (09.08.2026): `entries` zaten bu aralığın
      // vardiyaları — ikinci bir sorgu gerekmiyor.
      drivenVehiclesFromEntries(entries)
    ).map((r) => [r.workerId, r])
  );

  // Olay sayıları şoföre ARAÇ ÜZERİNDEN bağlanır — güvenlik skorunun kullandığı
  // eşlemenin aynısı (atanmamış araç şoför istatistiğine girmez).
  const vehicleWorker = new Map(
    base.vehicles.map((v) => [v.id, v.assigned_worker_id ?? null])
  );
  type EvAcc = { total: number; braking: number; accel: number; speeding: number };
  const evByWorker = new Map<string, EvAcc>();
  for (const e of base.events) {
    const wid = vehicleWorker.get(e.vehicle_id);
    if (!wid) continue;
    const a =
      evByWorker.get(wid) ?? { total: 0, braking: 0, accel: 0, speeding: 0 };
    a.total += 1;
    if (e.event_type === "harsh_braking") a.braking += 1;
    else if (e.event_type === "harsh_acceleration") a.accel += 1;
    else if (e.event_type === "overspeeding") a.speeding += 1;
    evByWorker.set(wid, a);
  }

  type ShiftAcc = { shifts: number; ms: number; km: number; hasKm: boolean; delivered: number; undelivered: number };
  const shiftByWorker = new Map<string, ShiftAcc>();
  for (const e of entries) {
    if (!e.worker_id) continue;
    const a =
      shiftByWorker.get(e.worker_id) ??
      { shifts: 0, ms: 0, km: 0, hasKm: false, delivered: 0, undelivered: 0 };
    a.shifts += 1;
    a.ms += workedMs(e);
    const km = kmDiff(e);
    if (km !== null) {
      a.km += km;
      a.hasKm = true;
    }
    // Teslim edilen yalnız KAPANMIŞ vardiyada gerçektir (açık vardiyada
    // cargo_count hâlâ gün başı yer tutucusu) — panoyla aynı kural.
    if (e.ended_at !== null && e.cargo_count !== null) a.delivered += e.cargo_count;
    if (e.undelivered_count !== null) a.undelivered += e.undelivered_count;
    shiftByWorker.set(e.worker_id, a);
  }

  const rows: PerformanceRow[] = [];
  for (const w of base.workers) {
    const s = shiftByWorker.get(w.id);
    const ev = evByWorker.get(w.id);
    const sc = safety.get(w.id);
    // Aralıkta ne vardiyası ne olayı olan şoför rapora girmez — 0'larla dolu
    // satır, "çalışmadı" ile "veri yok"u karıştırır.
    if (!s && !ev) continue;
    rows.push({
      workerId: w.id,
      name: w.name,
      shifts: s?.shifts ?? 0,
      workedMs: s?.ms ?? 0,
      km: s?.hasKm ? s.km : null,
      delivered: s?.delivered ?? 0,
      undelivered: s?.undelivered ?? 0,
      safetyScore: sc?.score ?? null,
      events: ev?.total ?? 0,
      harshBraking: ev?.braking ?? 0,
      harshAcceleration: ev?.accel ?? 0,
      overspeeding: ev?.speeding ?? 0,
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
    scoredCount: scored.length,
  };
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
function classifyRpcError(error: {
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
  });

  // 280 bin satır Postgres'te toplulaştırılır. Hata hâlinde rapor çökmez ama
  // SEBEBİ ayırt edilir — "fonksiyon yok" ile "zaman aşımı" farklı sorunlardır
  // ve yöneticiye farklı şey yaptırırlar (migration çalıştır / aralığı daralt).
  const { data: statData, error } = await supabaseAdmin.rpc("report_fuel_stats", {
    p_from: startISO,
    p_to: endISO,
  });
  if (error) return empty(classifyRpcError(error));

  const stats = new Map(
    ((statData ?? []) as FuelStatRow[]).map((s) => [s.vehicle_id, s])
  );

  // LİTRE YOLU (039). Yüzdenin YERİNE değil, YOKLUĞUNDA devreye girer — hem
  // yüzde hem hacim gönderen araçlarda hacim çöp olduğu için (bkz. migration
  // 039 başlığı). RPC yoksa (039 uygulanmamış) sessizce boş: yüzde yolu
  // etkilenmez, litre araçları eskisi gibi "Veri yok" kalır.
  const volStats = new Map<string, FuelVolumeStatRow>();
  {
    const { data: volData, error: volErr } = await supabaseAdmin.rpc(
      "report_fuel_volume_stats",
      { p_from: startISO, p_to: endISO }
    );
    if (!volErr) {
      for (const s of (volData ?? []) as FuelVolumeStatRow[]) {
        // GÜRÜLTÜ MUHAFIZI: sıçraması eşiği aşan seri hiç kabul edilmez.
        if (Number(s.max_step_l) > FUEL_VOLUME_MAX_STEP_L) continue;
        if (Number(s.sample_count) === 0) continue;
        volStats.set(s.vehicle_id, s);
      }
    }
  }

  // L/100km için mesafe — mesafe raporuyla AYNI kaynak (odometre uç-noktaları +
  // km-guard). Araç başına iki indeksli sorgu, telemetri satırı taşımaz.
  // 22.07.2026: artık ölçüm PENCERESİ de geliyor (aşağıdaki 3. kapı için).
  const distEntries = await Promise.all(
    vehicles.map(
      async (v) => [v.id, await getVehicleDistanceSpan(v.id, startISO, endISO)] as const
    )
  );
  const distByVehicle = new Map(distEntries);

  // Yakıt okumalarının ölçüm penceresi — odometre penceresiyle kıyaslanacak.
  // Aynı desen: araç başına iki indeksli limit-1 sorgusu, satır taşımaz.
  const fuelSpanEntries = await Promise.all(
    vehicles.map(
      async (v) => [v.id, await getVehicleFuelSpan(v.id, startISO, endISO)] as const
    )
  );
  const fuelSpanByVehicle = new Map(fuelSpanEntries);

  // ARIZALI SENSÖR TESPİTİ (22.07.2026). Canlı örnek DO-687GX: 18.07'de 7.801
  // okumanın 1.729'u (%22) %0. Bu bir CAN dropout çukuru DEĞİL — yarı ölü
  // sensörün sürekli sıfırı; de-glitch onu elemez ve ELEMEMELİ (sürekli sıfır
  // gerçek bir sinyal olabilir). Ama böyle bir seriden hesaplanan tüketim ve
  // dolum sayıları anlamsızdır: sıfır serisinin bitişi "dolum" gibi görünür.
  //
  // Ölçüm HAM veri üzerinden yapılır (de-glitch öncesi), çünkü soru "sensör
  // sağlıklı mı" — "temizlikten sonra ne kaldı" değil. Yalnız başlık sayısı
  // çekilir (head:true), satır taşınmaz.
  const zeroEntries = await Promise.all(
    vehicles.map(async (v) => {
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
    })
  );
  const zeroByVehicle = new Map(zeroEntries);

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
    // Yakıt dengesi kimliği: yakılan = alınan (dolum) + net düşüş (ilk − son).
    // Küçük gürültüde negatife düşerse 0'a kırpılır (net dolu bitti demektir).
    const consumedPct = Math.max(0, refillPct + (first - last));
    const consumedLiters = cap != null ? (consumedPct / 100) * cap : null;
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
