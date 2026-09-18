import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { FLEET_EPOCH_ISO, FUEL_PRICE_EUR_PER_L } from "@/lib/tenant";
import { getDriverScope, dropNonDrivers } from "@/lib/driver-scope";
import {
  startOfTodayVienna,
  endOfTodayVienna,
  addCalendarDaysVienna,
  startOfDayViennaFromYmd,
  endOfDayViennaFromYmd,
  viennaDayKey,
} from "@/lib/format";
import { IDLE_TRIGGER_S } from "@/lib/telemetry";
import { SCORE_MIN_KM, SAFETY_SCORE_K } from "@/lib/metric-thresholds";
import { retryOnTimeout, isTimeoutError } from "@/lib/db-fanout";
import type { VehicleEventWithPlate, IdleEpisodeWithPlate } from "@/lib/telemetry";
import {
  SAFETY_SCORE_WEIGHTS,
  IDLE_FUEL_L_PER_HOUR,
  TOP10_EVENT_TYPES,
  type AnalyticsRangeKey,
  type DateRange,
  type Top10EventType,
  type VehicleLite,
  type WorkerLite,
  type DriverTally,
  type EventTypeAgg,
  type SafetyScoreRow,
  type IdleWasteRow,
  type IdleWasteSummary,
  type MonthlyPivot,
  type OwnerlessEventsSummary,
  type OwnerlessVehicleRow,
} from "@/lib/analytics-shared";
import { TENANT_TZ } from "@/lib/tz";

// Client-safe sabitler/türler lib/analytics-shared.ts'te yaşar; burada
// yeniden dışa verilir ki mevcut çağıranlar (page.tsx) tek yerden import etsin.
//
// ⚠️ DIESEL_EUR_PER_L 23.08.2026'da SİLİNDİ (ikinci yakıt fiyatıydı, %24 sapma
// üretiyordu). Yakıtın € karşılığı artık tek yerden: FUEL_PRICE_EUR_PER_L.
export {
  SAFETY_SCORE_WEIGHTS,
  IDLE_FUEL_L_PER_HOUR,
  TOP10_EVENT_TYPES,
  type AnalyticsRangeKey,
  type DateRange,
  type Top10EventType,
  type VehicleLite,
  type WorkerLite,
  type DriverTally,
  type EventTypeAgg,
  type SafetyScoreRow,
  type IdleWasteRow,
  type IdleWasteSummary,
};

/**
 * /admin/analiz veri katmanı — FAZ 1: olay-tipi top-10, güvenlik skoru,
 * rölanti israf panosu. Tüm ağır hesap burada (server-only); client yalnız
 * render eder. Tarih aralığı hesapları KİRACI dilimine göre (lib/tz.ts; aynı
 * DST-güvenli desen lib/format.ts'te). İstemci-güvenli türler/sabitler →
 * lib/analytics-shared.ts.
 */

// Filo bu tarihten eskiye gitmiyor — "tüm zamanlar" alt sınırı, sonsuz sorgu
// aralığından kaçınır (fetchAllRows'un tüm tabloyu taramasını sınırlar).
// Müşteriye göre değişir (lib/tenant.ts): HAK61 için 2026-06-01, yeni bir
// kurulum için sistemin canlıya alındığı gün. Yanlış olması veriyi bozmaz,
// yalnız anlamsız boş bir "önceki dönem" üretir.
export const FLEET_EPOCH = new Date(FLEET_EPOCH_ISO);

/**
 * KM EŞİĞİ ARTIK KİŞİYE GÖRE ÖLÇEKLENMİYOR (18.09.2026).
 *
 * Bu noktada üç fonksiyon duruyordu: `scoreMinKmForRange`,
 * `scoreMinKmForSpan`, `scoreMinKmForWorkedDays`. Üçü de aynı soruyu farklı
 * paydayla cevaplıyordu ve hangisinin geçerli olduğu ÇAĞRI SIRASINA bağlıydı —
 * canlıda ölçülen sonuç: çalışılan gün 0 olan bir şoförde `forWorkedDays`
 * atlanıp `forSpan` devreye giriyor ve 300 km'lik MUTLAK TABAN sessizce
 * uygulanmıyordu (HAK61, hafta penceresi: eşik 140 km, Mustafa Demirsöz 156
 * km ile 51 puan aldı — hem de o pencerede hiç vardiyası görünmezken).
 *
 * Tek eşik: `SCORE_MIN_KM` (lib/metric-thresholds.ts). Kişiye göre değişen bir
 * çıta yok, dolayısıyla "hangi kol çalıştı" sorusu da yok.
 *
 * `rangeElapsedDays` KALDI — eşikle ilgisi yok, aralık uzunluğu soran başka
 * yüzeyler kullanıyor.
 */

/**
 * Aralığın ŞİMDİYE KADAR geçen gün sayısı (en az 1).
 *
 * Dönem sonu gelecekteyse (bu hafta/bu ay) şimdiye kadar kırpılır. Mobil Analiz
 * ucu bunu "pencerenin kaç günü doldu" bilgisi olarak döndürüyor; skor eşiğiyle
 * ARTIK İLGİSİ YOK (bkz. yukarıdaki not).
 */
export function rangeElapsedDays(range: DateRange): number {
  const effectiveEnd = Math.min(Date.now(), range.end.getTime());
  const spanMs = Math.max(0, effectiveEnd - range.start.getTime());
  return Math.max(1, Math.round(spanMs / 86_400_000));
}

/** Kayan pencere uzunlukları (gün). Etiketler i18n'de bu sayılarla yazılı. */
export const SLIDING_WEEK_DAYS = 7;
export const SLIDING_MONTH_DAYS = 30;

/** Bugünün sonundan geriye `days` günlük KAYAN pencere (bugün dahil). */
function slidingWindow(days: number): DateRange {
  return {
    start: addCalendarDaysVienna(startOfTodayVienna(), -(days - 1)),
    end: endOfTodayVienna(),
  };
}

/**
 * Seçilen anahtardan tarih aralığı.
 *
 * ═══ KAYAN PENCERE (27.07.2026, Volkan kararı) ═══
 * "hafta" ve "ay" artık TAKVİM haftası/ayı DEĞİL, son 7 / son 30 gün.
 *
 * Neden: takvim penceresi haftanın/ayın başında çöküyordu. Canlı ölçüm
 * (27.07.2026 pazartesi, saat 13:00): takvim haftası = 0,56 gün. Sonuç:
 *   • "Haftalık" ile "Günlük" AYNI sayıyı veriyordu
 *   • Yakıt raporunda 12 araç "Veri yok" düşüyordu (kayan pencerede 6)
 *   • L/100km kolonu HİÇ çıkmıyordu (aralık 1 gün < FUEL_L100_MIN_DAYS=7),
 *     yani araçlar arası tüketim kıyası hiç çalışmıyordu (kayan: 19 araç)
 * Aynı sorun ayın 1'inde "Aylık" için de geçerliydi.
 *
 * Kayan pencere her gün aynı uzunlukta kalır → dönem kıyası (previousPeriod)
 * de anlamlı olur: 7 gün her zaman 7 günle karşılaştırılır.
 *
 * "gun" (bugün) ve "tumzaman" değişmedi; "ozel" kullanıcı tarihlerini kullanır,
 * tarih verilmediğinde artık takvim haftasına değil son 7 güne düşer.
 */
export function computeAnalyticsRange(
  key: AnalyticsRangeKey,
  customFrom?: string | null,
  customTo?: string | null
): DateRange {
  switch (key) {
    case "gun":
      return { start: startOfTodayVienna(), end: endOfTodayVienna() };
    case "ay":
      return slidingWindow(SLIDING_MONTH_DAYS);
    case "ozel": {
      const fallback = slidingWindow(SLIDING_WEEK_DAYS);
      const start = (customFrom && startOfDayViennaFromYmd(customFrom)) || fallback.start;
      const end = (customTo && endOfDayViennaFromYmd(customTo)) || fallback.end;
      return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
    }
    case "tumzaman":
      return { start: FLEET_EPOCH, end: endOfTodayVienna() };
    case "hafta":
    default:
      return slidingWindow(SLIDING_WEEK_DAYS);
  }
}

/**
 * Aynı uzunlukta ÖNCEKİ dönem — trend oku için. "Tüm zamanlar"da veya
 * dönem filo başlangıcına dayanıyorsa önceki dönem anlamsız → null.
 */
export function previousPeriod(range: DateRange): DateRange | null {
  const spanMs = range.end.getTime() - range.start.getTime();
  if (spanMs <= 0) return null;
  if (range.start.getTime() <= FLEET_EPOCH.getTime()) return null;
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  return {
    start: prevStart.getTime() < FLEET_EPOCH.getTime() ? FLEET_EPOCH : prevStart,
    end: prevEnd,
  };
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

/**
 * Analiz + Hız/Mesafe/Performans raporlarının ORTAK evreni.
 *
 * İKİ AYRI LİSTE döner ve ayrım kasıtlıdır:
 *   • `workers`     — ŞOFÖR EVRENİ (yönetici/test elenmiş). "Kaç şoför",
 *                     sıralama, skor, rapor SATIRI hep bunun üzerinde döner.
 *   • `workerNames` — İSİM SÖZLÜĞÜ (yalnız test elenmiş). Bir ARAÇ satırına
 *                     "bu aracı kim kullanıyor" etiketi basmak için.
 *
 * Neden ikisi: sayı ile etiket farklı sorulardır. Tek liste kullanılsaydı ya
 * yönetici şoför sayılırdı (eski hata, "ŞOFÖR 33") ya da araca atanmış birinin
 * adı raporda "—"e dönerdi (bilgi kaybı). Yakıt raporu (buildFuelReport) bu
 * ayrımı kendi içinde zaten yapıyordu; hız/mesafe raporları da aynı sözlüğü
 * kullansın diye buraya taşındı.
 */
export async function listVehiclesAndWorkers(): Promise<{
  vehicles: VehicleLite[];
  workers: WorkerLite[];
  workerNames: WorkerLite[];
}> {
  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // test-filtered: dropTestRows — Analiz sayfasının ve Hız/Mesafe/Performans
  // raporlarının ORTAK araç/şoför evreni (lib/reports.ts loadBase buradan okur).
  const [{ data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate, assigned_worker_id"),
    // is_active FİLTRESİ YOK (Modül 2): Hız/Mesafe/Performans ve Analiz'in ORTAK
    // isim evreni TÜM personel olmalı ki geçmiş raporlarda ayrılan şoförün adı
    // görünsün (aksi halde "—" olur / Performans satırı düşer). Aktif/ayrıldı
    // ayrımı yalnız CANLI yüzeylerde (roster/harita/seçiciler) uygulanır.
    //
    // driver-scoped: yönetici elemesi SORGUDA değil, aşağıdaki dönüşte
    // dropNonDrivers ile yapılıyor — araç sorgusuyla paralel çalışsın diye
    // (iki sorgu tek Promise.all'da, ek gidiş-geliş yok).
    supabaseAdmin.from("workers").select("id, name"),
  ]);
  const workerNames = dropTestRows(
    (wData ?? []) as WorkerLite[],
    (w) => ({ worker: w.id }),
    scope
  );
  return {
    vehicles: dropTestRows(
      (vData ?? []) as VehicleLite[],
      (v) => ({ vehicle: v.id }),
      scope
    ),
    // driver-scoped: ŞOFÖR EVRENİ — computeSafetyScores satır satır bunun
    // üzerinde döner (ŞOFÖR sayacı, skor tablosu, Performans raporu satırları
    // hep buradan çıkar). Yönetici hesapları burada kalırsa sayaç 33 gösterir
    // (canlıda ölçüldü, 28.07.2026).
    //
    // resolveDriver (Top-10 / Rölanti / Aylık Pivot) BİLEREK bu DAR listeyi
    // alır: yöneticiye araç atanmışsa olay "Atanmamış · PLAKA" satırına düşer,
    // şoför ligine girmez. Geniş sözlük oraya GEÇİRİLMEMELİDİR.
    workers: dropNonDrivers(workerNames, (w) => w.id, driverScope),
    workerNames,
  };
}

/**
 * Bir günde bir teslimat aracının makul üst sınırı — bu değeri aşan bir
 * "mesafe" test/demo verisindeki bozuk tek bir odometer okumasının belirtisidir
 * (QA'da görüldü: bir ay filtresinde bir şoför için 124.181 km çıktı — gerçek
 * bir teslimat aracı bunu süremez). Böyle durumlarda km UYDURULMAK yerine
 * güvenilmez sayılır, çağıran gün-bazlı normalizasyona düşer.
 */
export const MAX_PLAUSIBLE_KM_PER_DAY = 800;

/**
 * Bir aracın seçili aralıktaki kat ettiği mesafe (km), device_telemetry'nin
 * odometer_km alanından. Aralıktaki EN ERKEN ve EN GEÇ dolu okumanın farkı —
 * tüm satırları çekmez (28 araçlık filoda ucuz, 2 indeksli sorgu). Yeterli
 * okuma yoksa, fark negatifse (sayaç sıfırlanmışsa) veya günlük makul üst
 * sınırı (bozuk tekil okuma belirtisi) aşıyorsa null döner — çağıran bu
 * durumda km yerine gün-bazlı normalizasyona düşer, UYDURMA km üretilmez.
 */
export async function getVehicleDistanceKm(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<number | null> {
  return (await getVehicleDistanceSpan(vehicleId, startISO, endISO)).km;
}

/**
 * km NEDEN null? — "veri yok" ile "veri tutarsız" aynı şey değildir (22.07.2026).
 * Ekranda tek bir "Veri yok" yazınca yönetici hangi aracı kontrol ettireceğini
 * bilemiyordu. Artık sebep taşınır:
 *  • no_odometer  → aralıkta hiç odometre okuması yok (cihaz göndermiyor)
 *  • inconsistent → sayaç geri saymış (cihaz değişimi/reset) ya da günlük makul
 *                   sınırı aşmış (bozuk tekil okuma)
 *  • olculmedi    → ölçüm YAPILAMADI (RPC geçici hata / ifade tavanı). Veri
 *                   bozuk değil; biz okuyamadık. (105, aşağıda)
 *
 * ⚠️ `olculmedi` 105'te eklendi (16c). ÖNCESİNDE: filo RPC'si ifade tavanını
 * aşınca sessizce araç-araç yedek yola düşülüyordu ve o yol BAŞKA BİR KURAL
 * uyguluyordu (temizlik yok) — aynı araç için farklı km, hatta farklı yön:
 *   demo W-GF-107 : 097 592 km · yedek null   (ham ilk okuma odometre 0)
 *   HAK61 DO-512GT: 097 692 km · yedek 751 km (+%8,5)
 * 105 iki yolu tek çekirdeğe bağladı; ama ÇEKİRDEK DE düşerse artık uydurma
 * bir sayı değil `olculmedi` döner. "Yanlış sayı" ile "ölçemedim" aynı şey
 * değildir ve ekran ikincisini söyleyebilmelidir.
 */
export type DistanceUnavailableReason =
  | "no_odometer"
  | "inconsistent"
  | "olculmedi"
  | null;

export type VehicleDistanceSpan = {
  /** Kat edilen mesafe (km) — güvenilmezse null. */
  km: number | null;
  /** km null ise sebebi; değilse null. */
  reason: DistanceUnavailableReason;
  /** Odometre okumalarının İLK/SON zamanı — ölçüm penceresi karşılaştırması için. */
  firstAt: string | null;
  lastAt: string | null;
};

/**
 * getVehicleDistanceKm'in tam sürümü: mesafeyle birlikte SEBEBİ ve ÖLÇÜM
 * PENCERESİNİ de döndürür.
 *
 * Pencere neden gerekli: yakıt raporu tüketimi yakıt-yüzdesi okumalarından,
 * mesafeyi ise odometre okumalarından alıyor. İkisi AYNI zaman aralığını
 * kapsamazsa L/100km sessizce saçmalar (canlı vaka DO-818HF: günlerce süren
 * yakıt düşüşü, 2,5 km'lik odometre penceresine bölündü → 80 L/100km).
 * Bu yüzden pencere sınırları da taşınır ve yakıt raporunda kıyaslanır.
 */
/**
 * VARDİYA PENCERELİ KM (migration 052) — şoför → o aralıkta gerçekten sürdüğü
 * mesafe. Tek RPC çağrısı; JS'te vardiya başına 2 sorgu 373 vardiyada paralel
 * bile 27-39 sn sürüyordu (ölçüldü).
 *
 * km-guard BURADA uygulanır (tek doğruluk kaynağı): negatif fark elenir,
 * vardiya süresine göre MAX_PLAUSIBLE_KM_PER_DAY aşan fark elenir. Aynı aracı
 * iki şoför paylaşırsa her biri YALNIZ kendi vardiya penceresinin farkını alır.
 *
 * 052 uygulanmamışsa null döner ve çağıran eski (aralık uçlu) yola düşer —
 * kurulum sırası yüzünden hiçbir ekran boş kalmaz.
 *
 * ⚠️ AMA ZAMAN AŞIMI AYNI KAPIDAN GEÇEMEZ (09.08.2026). Eskiden her hata `null`
 * dönüyordu ve `null` "052 yok" demekti — yani zaman aşımında ekran SESSİZCE
 * 052 ÖNCESİNE, düzeltmenin kaldırdığı ŞİŞİRİLMİŞ km'ye dönüyordu. Ölçüldü
 * (HAK61, 30 gün, arka arkaya dört çağrı):
 *     1. 8.133 ms   2. 305 ms   3. 269 ms   4. 263 ms
 * 30 katlık soğuk/sıcak farkı: saf disk. Tavan 8 sn olduğu için ilk çağrı bazen
 * geçiyor bazen 57014 alıyor — yani "günün ilk açılışı" kumar oynuyordu ve
 * kaybettiğinde YANLIŞ SAYI gösteriyordu, hata değil.
 *
 * İKİ SEBEP ARTIK AYRIŞIYOR:
 *   • missing_function → 052 gerçekten yok. Eski yola düşmek DOĞRU (o kurulumda
 *     zaten başka km yok) ve çağıran `undefined` alır.
 *   • timeout/error    → 052 var ama hesaplanamadı. Eski yola düşmek YANLIŞ
 *     olurdu: çağıran BOŞ harita alır, skorlar "Veri yok" olur. Yanlış rakam
 *     göstermek, hata göstermekten kötüdür (Volkan, 09.08.2026).
 *
 * retryOnTimeout ilk çağrının ısıttığı sayfalarla ikinci turu kurtarır — ama
 * kökü kesen şey migration 053'teki kapsayan indekstir (bkz. o dosya).
 */
export type ShiftDistanceUnavailable = "missing_function" | "timeout" | "error";

/**
 * BİR VARDİYANIN ZAMAN PENCERESİ — "bu araçta, bu saatte, direksiyonda kimdi".
 *
 * km ile AYNI SATIRDAN türer (shift_odometer_spans). Ayrı bir sorgu değil,
 * çünkü ayrı olsaydı iki sorgu zamanla ayrışabilirdi — 15.08.2026'da düzeltilen
 * kusurun kökü tam olarak buydu (bkz. computeSafetyScores).
 */
export type ShiftWindow = {
  workerId: string;
  vehicleId: string;
  /** started_at (ms). */
  startMs: number;
  /** ended_at ?? aralık sonu (ms) — 052'nin coalesce(ended_at, p_to) kuralı. */
  endMs: number;
  /**
   * BU VARDİYADA ÖLÇÜLEN km; `null` = ölçülemedi (16.09.2026).
   *
   * `km` haritasıyla AYNI değerden ve AYNI üç kapıdan sonra yazılır (eksik
   * odometre · negatif fark · günlük makul km tavanı). Ayrı bir hesap DEĞİL,
   * aynı hesabın vardiya düzeyinde saklanmış hâli.
   *
   * Neden gerekti: şoför→km haritası bir vardiyanın ARACINI kaybediyor, oysa
   * filo üyeliği araçta yaşıyor (`vehicles.fleet`). Toplamı şoförden filoya
   * bölmek, iki filoda vardiya açmış şoförde ORANLAMA gerektirirdi — yani yeni
   * bir kural. Vardiya düzeyi o kuralı hiç doğurmadan doğru cevabı veriyor.
   *
   * ⚠️ `null` ile `0` FARKLI: ilki ölçülemedi, ikincisi ölçüldü ve sıfır çıktı.
   */
  km: number | null;
};

export type ShiftDistanceResult = {
  /** Şoför → vardiya pencereli km. `unavailable` doluysa null. */
  km: Map<string, number> | null;
  /**
   * Şoför → { ölçülen, toplam } vardiya. Kısmen ölçülen bir şoförde payda
   * eksik kalır; SCORE_MIN_COVERAGE altındaki kapsamada skor üretilmez.
   */
  coverage: Map<string, { olculen: number; toplam: number }> | null;
  /**
   * Aralıkla kesişen TÜM vardiya pencereleri — km'si ölçülemeyenler DAHİL.
   *
   * Neden dahil: pencere "kim direksiyondaydı" sorusunu cevaplar, "km ölçüldü
   * mü" sorusunu değil. Cihazı sessiz bir vardiyada şoför yine de araçtaydı ve
   * yaptığı ihlal ONUN ihlalidir. Km'nin eksik kalmasından doğan orantısızlığı
   * kapatan şey bu listeyi budamak değil, SCORE_MIN_KM_COVERAGE kapısıdır.
   */
  windows: ShiftWindow[] | null;
  /** null = başarılı. */
  unavailable: ShiftDistanceUnavailable | null;
};

export async function getWorkerShiftDistance(
  startISO: string,
  endISO: string
): Promise<ShiftDistanceResult> {
  const { data, error } = await retryOnTimeout(() =>
    supabaseAdmin.rpc("shift_odometer_spans", {
      p_from: startISO,
      p_to: endISO,
    })
  );
  if (error) {
    if (isTimeoutError(error))
      return {
        km: null,
        coverage: null,
        windows: null,
        unavailable: "timeout",
      };
    const code = (error.code ?? "").toUpperCase();
    const msg = (error.message ?? "").toLowerCase();
    const missing =
      code === "PGRST202" ||
      code === "42883" ||
      msg.includes("could not find the function") ||
      msg.includes("does not exist");
    return {
      km: null,
      coverage: null,
      windows: null,
      unavailable: missing ? "missing_function" : "error",
    };
  }
  const rows = (data ?? []) as {
    worker_id: string;
    vehicle_id: string;
    started_at: string;
    ended_at: string | null;
    first_km: number | null;
    last_km: number | null;
  }[];
  const km = new Map<string, number>();
  const windows: ShiftWindow[] = [];
  const rangeEndMs = Date.parse(endISO);
  /**
   * KAPSAMA (15.08.2026): şoför başına "km'si ölçülebilen / toplam" vardiya.
   * Eski hâlde ölçülemeyen satır SESSİZCE atlanıyordu; şoförün 10 vardiyasının
   * 4'ünde cihaz ölüyse ceza 10 vardiyanın OLAYLARINDAN, km ise 6 vardiyadan
   * geliyor ve ceza/1000km yapay olarak şişiyordu. Sayaç olmadan bu fark
   * hiçbir yerde görünmüyordu.
   */
  const kapsam = new Map<string, { olculen: number; toplam: number }>();
  const say = (wid: string, olculdu: boolean) => {
    const c = kapsam.get(wid) ?? { olculen: 0, toplam: 0 };
    c.toplam++;
    if (olculdu) c.olculen++;
    kapsam.set(wid, c);
  };
  for (const r of rows) {
    // PENCERE km'DEN BAĞIMSIZ toplanır — bkz. ShiftWindow notu. Aşağıdaki
    // `continue`ların hiçbiri pencereyi düşürmemeli, o yüzden en başta.
    if (r.worker_id && r.vehicle_id) {
      windows.push({
        workerId: r.worker_id,
        vehicleId: r.vehicle_id,
        startMs: Date.parse(r.started_at),
        endMs: r.ended_at ? Date.parse(r.ended_at) : rangeEndMs,
        // Kapılardan geçerse aşağıda DOLDURULUR; geçemezse null KALIR.
        km: null,
      });
    }
    if (r.first_km == null || r.last_km == null) {
      if (r.worker_id) say(r.worker_id, false);
      continue;
    }
    const diff = r.last_km - r.first_km;
    if (diff < 0) {
      if (r.worker_id) say(r.worker_id, false);
      continue;
    }
    const endMs = r.ended_at ? Date.parse(r.ended_at) : Date.parse(endISO);
    const spanDays = Math.max(
      1 / 24,
      (endMs - Date.parse(r.started_at)) / 86_400_000
    );
    if (diff > spanDays * MAX_PLAUSIBLE_KM_PER_DAY) {
      say(r.worker_id, false);
      continue;
    }
    say(r.worker_id, true);
    km.set(r.worker_id, (km.get(r.worker_id) ?? 0) + diff);
    // AYNI `diff`, vardiya düzeyinde de saklanıyor — ayrı kapı/eşik YOK.
    // Pencere bu satır için az önce (döngünün başında) itildi; başka bir satıra
    // yazmamak için kimlikler doğrulanıyor.
    const pencere = windows[windows.length - 1];
    if (
      pencere &&
      pencere.workerId === r.worker_id &&
      pencere.vehicleId === r.vehicle_id
    ) {
      pencere.km = diff;
    }
  }
  return { km, coverage: kapsam, windows, unavailable: null };
}

/**
 * ═══ KAPSAMA KAPISI KALDIRILDI (18.09.2026) ═══════════════════════════════
 *
 * Burada üç şey duruyordu: `SCORE_MIN_KM_COVERAGE = 0.8`, `shiftKmForScoring`
 * ve `shiftWindowsForScoring`. Üçü birlikte 052'nin HAM çıktısını puan
 * paydasına çeviriyordu. Artık payda `lib/km-axis.ts` çekirdeğinden geliyor ve
 * pencereler vardiya satırlarının kendisinden türüyor — bkz. lib/score-core.ts.
 *
 * NEDEN AYRI KAPI YANLIŞTI (ölçüldü, HAK61 30 gün): kapsama "052 bir okuma
 * döndürdü mü" diye soruyordu, "ölçüm ilerledi mi" diye değil. Cumhur Karataş
 * 21/26 vardiyayla %81 alıp kapıyı GEÇİYOR, ama o 21 vardiyanın toplamı 11 km
 * (aracı odometreyi yalnız kontak sonrası 5 dk gönderiyor). Kapı ısırması
 * gereken yerde ısırmıyor, gerektiğinden fazla ısırdığı yerde ise zaten km'si
 * olmayan şoförü eliyordu — yani hiçbir kişiyi doğru sebeple elemiyordu.
 *
 * ⚠️ `getWorkerShiftDistance` DURUYOR ve KALMALI: filo karşılaştırma ucu
 * (lib/fleet-compare.ts) vardiyaları FİLO ekseninde topluyor ve bunun için
 * pencere başına araç kimliğine ihtiyacı var. O ayrı bir soru; puan yolu artık
 * oradan geçmiyor.
 */

/**
 * "Bu araçta, bu anda direksiyonda kimdi" — pencere yoksa null.
 *
 * ÇAKIŞMADA EN GEÇ BAŞLAYAN KAZANIR. Canlıda ölçüldü (HAK61, 30 gün): 4.892
 * olayın 25'i birden fazla pencereye düşüyor ve HEPSİ aynı şoförün üst üste
 * binmiş iki vardiyası (ör. DO-775GS · Ali Özdemir ×14). Yani kural bugün
 * hiçbir atfı değiştirmiyor; farklı iki şoför çakışırsa devralanı seçer, ki
 * devir sırasında doğru olan odur. Olay ASLA iki şoföre birden yazılmaz.
 */
export function workerDrivingAt(
  windowsByVehicle: Map<string, ShiftWindow[]>,
  vehicleId: string,
  atISO: string
): string | null {
  const arr = windowsByVehicle.get(vehicleId);
  if (!arr) return null;
  const t = Date.parse(atISO);
  if (Number.isNaN(t)) return null;
  let hit: string | null = null;
  for (const w of arr) {
    if (w.startMs > t) break; // sıralı — bundan sonrası da geç başlıyor
    if (t <= w.endMs) hit = w.workerId; // en geç başlayan kazanır
  }
  return hit;
}

/**
 * BİR OLAYIN SAHİBİ — TEK KARAR NOKTASI.
 *
 * `computeSafetyScores` (cezayı kime yazacağını) ve `computeOwnerlessEvents`
 * (kaçının sahipsiz kaldığını) AYNI kuralı kullanmak zorunda; iki kopya bir gün
 * ayrışsaydı ekrandaki "toplam = yazılan + sahipsiz" köprüsü sessizce yalan
 * söylerdi. Bu yüzden kural bir closure'dan buraya çıkarıldı (20.08.2026) —
 * davranış birebir aynı, yalnız artık paylaşılıyor.
 *
 * `shiftWindowsByVehicle` verilmezse ESKİ ATAMA yolu: 052'siz kurulumlarda
 * (Sendigo/Galzura) tek doğru davranış budur.
 */
export function eventOwnerAt(
  vehiclesById: Map<string, VehicleLite>,
  shiftWindowsByVehicle: Map<string, ShiftWindow[]> | undefined,
  vehicleId: string,
  atISO: string
): string | null {
  if (shiftWindowsByVehicle !== undefined) {
    return workerDrivingAt(shiftWindowsByVehicle, vehicleId, atISO);
  }
  // atanmamış araç şoför liginde yer almaz
  return vehiclesById.get(vehicleId)?.assigned_worker_id ?? null;
}

/**
 * SAHİPSİZ OLAY KÖPRÜSÜ — Analiz KPI'ı ile skor tablosu arasındaki farkı sayar.
 *
 * ⚠️ SKOR HESABINA DOKUNMAZ. Burada tek bir ceza puanı hesaplanmaz; bu fonksiyon
 * yalnız SAYAR. `computeSafetyScores` ile aynı iki döngüyü, aynı ağırlık
 * süzgecini ve aynı `eventOwnerAt` kararını kullanır — sayılar bu yüzden
 * birbirini tutar, ikinci bir tanım yazıldığı için değil.
 *
 * ── ÜÇ KOVA, TEK KİMLİK ───────────────────────────────────────────────────
 *   scorable = attributed + ownerless + outOfRoster
 * `outOfRoster` ayrı duruyor çünkü "vardiyası var ama kadroda yok" bambaşka bir
 * sebep (test hesabı, kapsam dışı personel) ve onu `ownerless`a katmak
 * "araç vardiyasız kullanıldı" cümlesini yanlış yapardı. Canlıda 0 ölçüldü.
 *
 * ── NEDEN `idling` events'ten DEĞİL epizodlardan ──────────────────────────
 * `computeSafetyScores` ile birebir: rölanti `idle_episodes`ten gelir. Ağırlık
 * süzgeci (`SAFETY_SCORE_WEIGHTS`) alarmlara uygulanır; epizodun kendisi zaten
 * skorlanabilir bir olaydır.
 */
export function computeOwnerlessEvents(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>,
  shiftWindowsByVehicle?: Map<string, ShiftWindow[]>
): OwnerlessEventsSummary {
  let scorable = 0;
  let attributed = 0;
  let ownerless = 0;
  let outOfRoster = 0;
  const perVehicle = new Map<string, number>();

  const say = (vehicleId: string, atISO: string) => {
    scorable++;
    const wid = eventOwnerAt(vehiclesById, shiftWindowsByVehicle, vehicleId, atISO);
    if (!wid) {
      ownerless++;
      perVehicle.set(vehicleId, (perVehicle.get(vehicleId) ?? 0) + 1);
      return;
    }
    // Kadroda olmayan şoföre yazılan olay skor satırı üretmez; ayrı kovada.
    if (!workersById.has(wid)) {
      outOfRoster++;
      return;
    }
    attributed++;
  };

  for (const e of events) {
    if (SAFETY_SCORE_WEIGHTS[e.event_type] === undefined) continue;
    say(e.vehicle_id, e.occurred_at);
  }
  for (const ep of idleEpisodes) {
    say(ep.vehicle_id, ep.started_at);
  }

  const vehicles: OwnerlessVehicleRow[] = [...perVehicle]
    .map(([vehicleId, count]) => {
      const v = vehiclesById.get(vehicleId);
      const assignedId = v?.assigned_worker_id ?? null;
      return {
        vehicleId,
        plate: v?.plate ?? "—",
        count,
        shifts: shiftWindowsByVehicle?.get(vehicleId)?.length ?? 0,
        assignedName: assignedId ? (workersById.get(assignedId)?.name ?? null) : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.plate.localeCompare(b.plate));

  return { scorable, attributed, ownerless, outOfRoster, vehicles };
}

/** RPC yok = migration 097 çalıştırılmamış. Bir kez öğrenilir, tekrar denenmez. */
const RPC_YOK = new Set(["PGRST202", "42883"]);
let filoSpanRpcVar: boolean | null = null;

/**
 * FİLO GENELİ ODOMETRE AÇIKLIĞI — tek sorgu, bozuk okuma SQL'de elenmiş.
 *
 * ═══ NEDEN TEK ÇAĞRI ══════════════════════════════════════════════════════
 * `getVehicleDistanceSpan` araç başına İKİ sorgu atıyor ve ham ilk/son okumayı
 * alıyor. Cihaz tekil bozuk odometre bildirdiğinde (ölçüldü: 114 sıfır + 123
 * monotonluk ihlali) o uç satır ya açıklığı şişiriyor ya `inconsistent`
 * dedirtip aracı ölçüm dışı bırakıyor.
 *
 * Temizleme SERİ ister. Sorgu maliyeti ölçüldü (HAK61, 2026-07, 30 araç):
 *
 *     bugünkü (araç başına 2 sorgu)        2,85 sn ·  60 sorgu ·       2 satır
 *     tüm seriyi çekip uygulamada temizle 57,87 sn · 605 sorgu · 590.084 satır
 *     SQL RPC (tüm filo tek sorgu)         2,99 sn ·   1 sorgu ·      29 satır
 *
 * Uygulamada temizleme **20,3× yavaş** — kabul edilmedi. Kural SQL'de
 * (migration 097), burası yalnız çağırıyor.
 *
 * ⚠️ FAIL-SAFE: RPC yoksa (097 çalıştırılmamış) `null` döner ve çağıran
 * araç-araç yoluna düşer. 105'ten SONRA o yol aynı çekirdeği çağırdığı için
 * düşüş artık sayıyı DEĞİŞTİRMİYOR — yalnız yavaşlatıyor. 105 öncesinde iki
 * yol farklı km veriyordu; bkz. getVehicleDistanceSpan başlığı.
 */
export async function getFleetDistanceSpans(
  startISO: string,
  endISO: string
): Promise<Map<string, VehicleDistanceSpan> | null> {
  if (filoSpanRpcVar === false) return null;
  const { data, error } = await supabaseAdmin.rpc("fleet_odometer_spans", {
    p_from: startISO,
    p_to: endISO,
  });
  if (error) {
    if (RPC_YOK.has(error.code ?? "") || /could not find the function/i.test(error.message ?? "")) {
      filoSpanRpcVar = false;
      return null;
    }
    // Geçici hata: RPC'yi ölü sayma, bu turda geri düş.
    return null;
  }
  filoSpanRpcVar = true;
  const out = new Map<string, VehicleDistanceSpan>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    /**
     * Makullük kapısı UYGULAMADA kalıyor: SQL fiziksel imkansızlığı eliyor,
     * bu kapı "bu pencerede bu kadar yol mümkün mü" diye soruyor. İkisi ayrı
     * soru; SQL'e taşımak `MAX_PLAUSIBLE_KM_PER_DAY`i iki yerde yaşatırdı.
     * ⚠️ Kapı tek yerde: `uctanSpan`. Araç-araç yol da onu çağırır — 105'ten
     * sonra iki yol hem SQL kuralını hem bu kapıyı paylaşır.
     */
    out.set(
      String(r.vehicle_id),
      uctanSpan(
        r.odometre_ilk === null ? null : Number(r.odometre_ilk),
        r.odometre_son === null ? null : Number(r.odometre_son),
        (r.ilk_an as string | null) ?? null,
        (r.son_an as string | null) ?? null,
        startISO,
        endISO
      )
    );
  }
  return out;
}

/**
 * Filo RPC'sinin araç-araç ikizi — 105'ten sonra AYNI ÇEKİRDEK.
 *
 * ── NEDEN DEĞİŞTİ (16c, 17.09.2026) ───────────────────────────────────────
 * Bu fonksiyon eskiden aralığın HAM ilk ve son odometre okumasını alıyordu;
 * `fleet_odometer_spans` ise monoton filtre + blok başı + kapıdan geçmiş
 * TEMİZ uçları. İki yol aynı araca farklı km veriyordu ve hangisinin koştuğu
 * filo RPC'sinin ifade tavanını aşıp aşmamasına — yani YÜKE — bağlıydı:
 *     demo W-GF-107 : 097 592 km · ham uçlar 0 → 97.296 → makul değil → null
 *     HAK61 DO-512GT: 097 692 km · ham uçlar 101.900 → 102.651 = 751 (+%8,5)
 * 105 kuralı `vehicle_odometer_span`a taşıdı; filo sürümü onu LATERAL ile
 * çağırıyor, bu fonksiyon da doğrudan. Ayrışma kaynağında bitti.
 *
 * ⚠️ MAKULLÜK KAPISI HÂLÂ BURADA (`< 0`, `> gün × MAX_PLAUSIBLE_KM_PER_DAY`)
 * ve filo yolunda da aynısı uygulanıyor — SQL fiziksel imkânsızı eler, bu kapı
 * "bu pencerede bu kadar yol mümkün mü" diye sorar. İkisi ayrı soru.
 *
 * ⚠️ 105 UYGULANMAMIŞ KİRACIDA eski yola düşer (aşağıdaki `hamUclar`) —
 * davranış birebir bugünküdür. Latch: fonksiyon bir kez bulunamazsa bir daha
 * denenmez (filoSpanRpcVar ile aynı kalıp).
 */
let aracSpanRpcVar: boolean | null = null;

async function hamUclar(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<VehicleDistanceSpan> {
  const [{ data: first }, { data: last }] = await Promise.all([
    supabaseAdmin
      .from("device_telemetry")
      .select("odometer_km, recorded_at")
      .eq("vehicle_id", vehicleId)
      .not("odometer_km", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("device_telemetry")
      .select("odometer_km, recorded_at")
      .eq("vehicle_id", vehicleId)
      .not("odometer_km", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return uctanSpan(
    (first?.odometer_km as number | null | undefined) ?? null,
    (last?.odometer_km as number | null | undefined) ?? null,
    (first?.recorded_at as string | undefined) ?? null,
    (last?.recorded_at as string | undefined) ?? null,
    startISO,
    endISO
  );
}

/** İki uçtan km — makullük kapısı TEK YERDE, iki yol da buradan geçer. */
function uctanSpan(
  a: number | null,
  b: number | null,
  firstAt: string | null,
  lastAt: string | null,
  startISO: string,
  endISO: string
): VehicleDistanceSpan {
  if (a == null || b == null) {
    return { km: null, reason: "no_odometer", firstAt, lastAt };
  }
  const diff = b - a;
  if (diff < 0) return { km: null, reason: "inconsistent", firstAt, lastAt };
  const spanDays = Math.max(
    1,
    (new Date(endISO).getTime() - new Date(startISO).getTime()) / 86_400_000
  );
  if (diff > spanDays * MAX_PLAUSIBLE_KM_PER_DAY) {
    return { km: null, reason: "inconsistent", firstAt, lastAt };
  }
  return { km: diff, reason: null, firstAt, lastAt };
}

export async function getVehicleDistanceSpan(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<VehicleDistanceSpan> {
  if (aracSpanRpcVar !== false) {
    const { data, error } = await supabaseAdmin.rpc("vehicle_odometer_span", {
      p_from: startISO,
      p_to: endISO,
      p_vehicle_id: vehicleId,
    });
    if (!error) {
      aracSpanRpcVar = true;
      const r = ((data ?? []) as Record<string, unknown>[])[0];
      if (!r) return { km: null, reason: "no_odometer", firstAt: null, lastAt: null };
      return uctanSpan(
        r.odometre_ilk === null ? null : Number(r.odometre_ilk),
        r.odometre_son === null ? null : Number(r.odometre_son),
        (r.ilk_an as string | null) ?? null,
        (r.son_an as string | null) ?? null,
        startISO,
        endISO
      );
    }
    if (RPC_YOK.has(error.code ?? "") || /could not find the function/i.test(error.message ?? "")) {
      // 105 bu kiracıda yok → eski yol, davranış birebir bugünkü.
      aracSpanRpcVar = false;
      return hamUclar(vehicleId, startISO, endISO);
    }
    /**
     * 🔴 GEÇİCİ HATA (ifade tavanı dâhil) → HAM UÇLARA DÜŞMEYİZ.
     * Ham uçlar BAŞKA BİR KURAL; oraya düşmek "yanlış sayı" üretir. Ölçemediysek
     * onu söyleriz: `olculmedi`. Ekran boşluğu sebebiyle gösterir, uydurma bir
     * km göstermez (16c'nin asıl kazanımı budur).
     */
    return { km: null, reason: "olculmedi", firstAt: null, lastAt: null };
  }
  return hamUclar(vehicleId, startISO, endISO);
}

/**
 * Bir aracın seçili aralıktaki YAKIT okumalarının ölçüm penceresi. Odometre
 * penceresiyle kıyaslanır (bkz. getVehicleDistanceSpan): iki pencere yeterince
 * örtüşmüyorsa L/100km hesaplanmaz. İki indeksli limit-1 sorgusu — satır taşımaz.
 */
export async function getVehicleFuelSpan(
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<{ firstAt: string | null; lastAt: string | null }> {
  const [{ data: first }, { data: last }] = await Promise.all([
    supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", vehicleId)
      .not("fuel_level_pct", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", vehicleId)
      .not("fuel_level_pct", "is", null)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    firstAt: (first?.recorded_at as string | undefined) ?? null,
    lastAt: (last?.recorded_at as string | undefined) ?? null,
  };
}

/**
 * RÖLANTİ EPİZODUNUN SÜRESİ — TEK TANIM.
 *
 * ⚠️ DIŞA AÇILDI (18.09.2026): araç detayının dönem özeti rölantiyi ARAÇ
 * ekseninde topluyor, Rölanti İsrafı panosu ise ŞOFÖR ekseninde. İkisinin
 * AYNI sayıyı vermesi ancak süre tanımı tek olursa mümkün — tetik süresinin
 * (IDLE_TRIGGER_S) eklenmesi dahil.
 */
export function idleEpisodeDurationMs(ep: { started_at: string; ended_at: string | null; last_seen_at: string }): number {
  const startMs = new Date(ep.started_at).getTime();
  const endMs = new Date(ep.ended_at ?? ep.last_seen_at).getTime();
  return Math.max(0, endMs - startMs) + IDLE_TRIGGER_S * 1000;
}

/**
 * Aracın olayını ŞOFÖR EKSENİNE çevirir (Top-10, Rölanti İsraf Panosu, Aylık
 * Pivot Arşivi üçü de bunu kullanır).
 *
 * ŞOFÖR-OLMAYAN SAVUNMASI: `workersById` çağıran tarafta listVehiclesAndWorkers
 * çıktısından kurulur ve o liste ŞOFÖR EVRENİDİR (yönetici/test elenmiş,
 * bkz. lib/driver-scope.ts). Dolayısıyla bir yöneticiye araç atanırsa `get()`
 * undefined döner ve olay "Atanmamış · PLAKA" satırına düşer — yönetici şoför
 * liginde ASLA görünmez. Bu davranış KAZARA DEĞİL, kasıtlıdır: olay yutulmaz
 * (sayım korunur) ama şoför sıralamasına da girmez.
 *
 * Buraya geniş bir isim sözlüğü GEÇİRİLMEMELİDİR — geçirilirse yönetici adı
 * doğrudan şoför etiketi olarak basılır ve savunma sessizce kaybolur.
 */
function resolveDriver(
  vehicleId: string,
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): { key: string; label: string; workerId: string | null } {
  const v = vehiclesById.get(vehicleId);
  const plate = v?.plate ?? "—";
  if (v?.assigned_worker_id) {
    const w = workersById.get(v.assigned_worker_id);
    if (w) return { key: v.assigned_worker_id, label: w.name, workerId: v.assigned_worker_id };
  }
  return { key: `unassigned:${vehicleId}`, label: `Atanmamış · ${plate}`, workerId: null };
}

// ── Bölüm 1: olay tipi bazında top-10 personel ──────────────────────────────

export function computeTopDriversByType(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): Record<Top10EventType, EventTypeAgg> {
  const buckets = new Map<Top10EventType, Map<string, DriverTally>>();
  for (const ty of TOP10_EVENT_TYPES) buckets.set(ty, new Map());
  let idlingTotal = 0;

  for (const e of events) {
    const ty = e.event_type as Top10EventType;
    const map = buckets.get(ty);
    if (!map || ty === "idling") continue; // idling bu listede idle_episodes'tan gelir
    const { key, label } = resolveDriver(e.vehicle_id, vehiclesById, workersById);
    const cur = map.get(key) ?? { key, label, count: 0 };
    cur.count++;
    if (ty === "overspeeding" && e.speed_kmh != null) {
      cur.maxSpeedKmh = Math.max(cur.maxSpeedKmh ?? 0, e.speed_kmh);
    }
    map.set(key, cur);
  }

  const idleMap = buckets.get("idling")!;
  for (const ep of idleEpisodes) {
    idlingTotal++;
    const { key, label } = resolveDriver(ep.vehicle_id, vehiclesById, workersById);
    const durationMs = idleEpisodeDurationMs(ep);
    const cur = idleMap.get(key) ?? { key, label, count: 0, idleMs: 0 };
    cur.count++;
    cur.idleMs = (cur.idleMs ?? 0) + durationMs;
    idleMap.set(key, cur);
  }

  const out = {} as Record<Top10EventType, EventTypeAgg>;
  for (const ty of TOP10_EVENT_TYPES) {
    const map = buckets.get(ty)!;
    const arr = [...map.values()];
    arr.sort((a, b) =>
      ty === "overspeeding"
        ? b.count - a.count || (b.maxSpeedKmh ?? 0) - (a.maxSpeedKmh ?? 0)
        : ty === "idling"
          ? (b.idleMs ?? 0) - (a.idleMs ?? 0)
          : b.count - a.count
    );
    const total = ty === "idling" ? idlingTotal : arr.reduce((s, r) => s + r.count, 0);
    out[ty] = { total, rows: arr.slice(0, 10) };
  }
  return out;
}

// ── Bölüm 2: şoför güvenlik skoru ────────────────────────────────────────────

/**
 * ═══ `drivenVehiclesFromEntries` ve `workedDaysFromEntries` KALDIRILDI ═════
 * (18.09.2026)
 *
 * İkisi de yalnız emekli olan modelin parçalarıydı: birincisi "şoförün km'si
 * hangi ARAÇLARDAN toplansın" sorusunu cevaplıyordu (km artık araçtan değil
 * VARDİYADAN geliyor), ikincisi "eşik kaç gün × kaç km olsun" sorusunu (eşik
 * artık düz 100 km). Cevapladıkları soru kalmadığı için kendileri de kalmadı —
 * dead export bırakmak, bir sonraki turda "bu hâlâ kullanılıyor mu" diye
 * sordurur ve ilk yanlış cevapta iki kaynak geri doğar.
 *
 * Yerlerini alan tek şey: `lib/score-core.ts` → `scoreInputFromShifts`.
 */

/**
 * GÜVENLİK SKORU — TEK KM, TEK VARDİYA TANIMI (18.09.2026'da sadeleşti).
 *
 * ═══ İMZA NEDEN DARALDI ════════════════════════════════════════════════════
 *
 * Önceki hâli dokuz argüman alıyordu ve bunların üçü AYNI SORUNUN farklı
 * cevaplarıydı: `distanceByVehicle` (araç toplamı), `drivenVehiclesByWorker`
 * (hangi araçlar) ve `shiftKmByWorker` (052 toplamı). Hangisinin kazandığı
 * çağrı yerine göre değişiyordu; üstüne `minKm` bir FONKSİYON olabiliyordu ve
 * o fonksiyonun içinde de iki ayrı kol vardı. Yani "bu şoförün puanı hangi
 * km'den ve hangi çıtadan çıktı" sorusunun cevabı beş dallı bir ağaçtı — ve
 * canlıda ölçüldüğünde iki ekran aynı şoför için farklı cevap veriyordu.
 *
 * Artık tek girdi var: `lib/score-core.ts`in ürettiği `ScoreInput`. Payda
 * ekranın gösterdiği km ile AYNI çekirdekten (lib/km-axis.ts), olay atfı da
 * aynı vardiya satırlarından gelir. İkisinin ayrışması artık YAPISAL OLARAK
 * imkânsız — ayrı bir kaynak kalmadığı için.
 *
 * `vehiclesById` de düştü: yalnızca "pencere yoksa ATANMIŞ şoföre yaz" yedek
 * yolu için gerekiyordu. Pencereler artık her zaman var (vardiya satırları
 * her kurulumda var, 052'den bağımsız), dolayısıyla o yedek yol da yok.
 * Kazanç ölçülebilir: bir olay ya gerçekten direksiyonda olan kişiye yazılır
 * ya hiç kimseye — "araç bu kişinin üstüne kayıtlı, öyleyse o sürmüştür"
 * varsayımı hiçbir kiracıda kalmadı.
 *
 * ═══ HİÇBİR VARDİYAYA DÜŞMEYEN OLAY HİÇ KİMSEYE YAZILMAZ ═══════════════════
 * Canlıda %22–39 arası bir pay (pencereye göre). Bu olaylar kaybolmaz: Top-10,
 * Rölanti Panosu ve Aylık Pivot onları ATAMA ekseninde saymaya devam eder,
 * "Sahipsiz olay" kartı da sayısını ekranda gösterir — yalnız KİŞİSEL SKOR'a
 * girmezler, çünkü hangi kişinin olduğu bilinmiyor.
 *
 * ═══ SKOR ══════════════════════════════════════════════════════════════════
 * `100 × K / (K + ceza/1000km)` — hiperbolik, tabana çakılmaz. Ceza ağırlıkları
 * lib/analytics-shared.ts'te, K ve km eşiği lib/metric-thresholds.ts'te.
 */
export function computeSafetyScores(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  workersById: Map<string, WorkerLite>,
  input: {
    kmByWorker: Map<string, number>;
    windowsByVehicle: Map<string, ShiftWindow[]>;
  },
  minKm: number = SCORE_MIN_KM
): SafetyScoreRow[] {
  type Acc = { penalty: number; totalEvents: number; days: Set<string> };
  const acc = new Map<string, Acc>();

  function bump(workerId: string, weight: number, dayKey: string) {
    const cur = acc.get(workerId) ?? { penalty: 0, totalEvents: 0, days: new Set<string>() };
    cur.penalty += weight;
    cur.totalEvents += 1;
    cur.days.add(dayKey);
    acc.set(workerId, cur);
  }

  const sahibi = (vehicleId: string, atISO: string): string | null =>
    workerDrivingAt(input.windowsByVehicle, vehicleId, atISO);

  for (const e of events) {
    const weight = SAFETY_SCORE_WEIGHTS[e.event_type];
    if (weight === undefined) continue;
    const wid = sahibi(e.vehicle_id, e.occurred_at);
    if (!wid) continue;
    bump(wid, weight, viennaDayKey(e.occurred_at));
  }
  for (const ep of idleEpisodes) {
    const wid = sahibi(ep.vehicle_id, ep.started_at);
    if (!wid) continue;
    bump(wid, SAFETY_SCORE_WEIGHTS.idling ?? 0, viennaDayKey(ep.started_at));
  }

  const rows: SafetyScoreRow[] = [];
  for (const w of workersById.values()) {
    const a = acc.get(w.id);
    const penalty = a?.penalty ?? 0;
    const totalEvents = a?.totalEvents ?? 0;
    const activeDays = a?.days.size ?? 0;

    /**
     * PAYDA: çekirdeğin ölçebildiği vardiyaların km toplamı.
     *
     * `has()` ile okunuyor, `?? null` ile DEĞİL — çünkü "haritada yok"
     * (hiçbir vardiyası ölçülemedi) ile "haritada 0" (ölçüldü, araç hiç
     * kıpırdamadı) farklı gerçekler. İkincisi 100 km eşiğini geçemez ve
     * `km_yetersiz` der; birincisi ölçüm yokluğudur ve `kapsama_dusuk` der
     * (bkz. lib/reports.ts kapı sırası).
     */
    const reliableKm = input.kmByWorker.has(w.id)
      ? input.kmByWorker.get(w.id)!
      : null;

    const qualifies = reliableKm !== null && reliableKm >= minKm;
    const penaltyPer1000 = qualifies ? penalty / (reliableKm! / 1000) : 0;
    const score = qualifies
      ? Math.max(
          0,
          Math.min(100, Math.round((100 * SAFETY_SCORE_K) / (SAFETY_SCORE_K + penaltyPer1000)))
        )
      : null;

    rows.push({
      workerId: w.id,
      name: w.name,
      score,
      totalEvents,
      penalty,
      basis: "km",
      distanceKm: reliableKm,
      // Kapının kendisi — artık herkes için aynı sayı, ama satırda taşınmaya
      // devam ediyor: ekran "eşik 100 km" cümlesini sabitten değil KARARDAN
      // okusun (bir gün kiracıya göre değişirse tek dokunulacak yer kalsın).
      minKm,
      activeDays,
      trend: null,
      prevScore: null,
    });
  }

  // Skorlular önce (skora göre azalan, eşitlikte olayı çok olan aşağıda), "veri
  // yok" olanlar en altta ayrı — cezalandırılmış gibi değil, isimle sıralı.
  rows.sort((a, b) => {
    const an = a.score === null;
    const bn = b.score === null;
    if (an !== bn) return an ? 1 : -1;
    if (!an && !bn) return (b.score as number) - (a.score as number) || b.totalEvents - a.totalEvents;
    return a.name.localeCompare(b.name);
  });
  return rows;
}



// ── Bölüm 4: aylık pivot arşivi ──────────────────────────────────────────────

/** Bir ISO anın Viyana AY anahtarı: "2026-07". */
function viennaMonthKey(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", {
    timeZone: TENANT_TZ,
    year: "numeric",
    month: "2-digit",
  }).slice(0, 7);
}

/**
 * AYLIK PİVOT ARŞİVİ — şoför × (ay × alarm tipi) sayım tablosu.
 *
 * Sayfanın aralık seçicisinden BAĞIMSIZ: çağıran TÜM geçmişi verir. Ay listesi
 * veriden türetilir (boş ay hiç sütun açmaz), artan sıralı — soldan sağa
 * kronolojik, en yeni ay en sağda.
 *
 * Şoför ekseni resolveDriver ile: atanmamış aracın olayları "Atanmamış · PLAKA"
 * satırında toplanır, sessizce yutulmaz. İşten ayrılan personel de kalır —
 * arşivin amacı geçmişi korumak (workers sorgusu is_active filtrelemiyor).
 */
export function computeMonthlyPivot(
  events: VehicleEventWithPlate[],
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): MonthlyPivot {
  const TYPES = new Set<string>(TOP10_EVENT_TYPES);
  const months = new Set<string>();
  const byDriver = new Map<
    string,
    { workerId: string | null; name: string; cells: Record<string, number>; total: number }
  >();

  const bump = (vehicleId: string, iso: string, type: string) => {
    if (!TYPES.has(type)) return;
    const month = viennaMonthKey(iso);
    months.add(month);
    const d = resolveDriver(vehicleId, vehiclesById, workersById);
    let row = byDriver.get(d.key);
    if (!row) {
      row = { workerId: d.workerId, name: d.label, cells: {}, total: 0 };
      byDriver.set(d.key, row);
    }
    const cell = `${month}|${type}`;
    row.cells[cell] = (row.cells[cell] ?? 0) + 1;
    row.total++;
  };

  for (const e of events) bump(e.vehicle_id, e.occurred_at, e.event_type);
  // Rölanti EPİZOT olarak sayılır (bir uzun rölanti = 1), süre değil — tablo
  // "kaç kez" sorusunu cevaplar, "ne kadar süre" Rölanti İsraf Panosu'nda.
  for (const ep of idleEpisodes) bump(ep.vehicle_id, ep.started_at, "idling");

  const rows = [...byDriver.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name)
  );
  return { months: [...months].sort(), types: TOP10_EVENT_TYPES, rows };
}

// ── Bölüm 3: rölanti israf panosu ────────────────────────────────────────────

/**
 * RÖLANTİ SATIR TAVANI — bir yanıtta taşınan en fazla şoför satırı.
 *
 * TEK KAYNAK: `/api/mobile/dashboard` ve `/api/mobile/analytics` aynı sayıyı
 * kullanır. İki ayrı sabit, iki farklı "kırpıldı" eşiği demekti ve aynı filo
 * iki ekranda farklı uzunlukta liste gösterirdi.
 *
 * Kırpılan satırların süresi/tutarı TOPLAMLARDA KALIR — liste kısalır, ölçüm
 * kısalmaz.
 */
export const ROLANTI_SATIR_TAVANI = 20;

/**
 * Rölanti satırına PLAKA iliştirici.
 *
 * `IdleWasteRow` plaka taşımaz (panel tablosunda da yok): plaka SUNUM bilgisi,
 * metriğin parçası değil. Anahtar iki biçimde gelir ve ikisi de burada çözülür:
 *   workerId                   → o kişiye ATANMIŞ aracın plakası
 *   "unassigned:<vehicleId>"   → o aracın kendi plakası
 *
 * ⚠️ TEK KAYNAK (18.09.2026): kural `/api/mobile/dashboard` içinde yaşıyordu;
 * ikinci bir yüzey aynı satırları göstermeye başlayınca kopyalanacaktı. Aynı
 * anahtar iki ekranda farklı plakaya çözülürse bunu kimse fark etmez.
 */
export function idlePlateResolver(
  vehicles: VehicleLite[],
  vehiclesById: Map<string, VehicleLite>
): (key: string) => string | null {
  const plateByWorker = new Map<string, string>();
  for (const v of vehicles) {
    if (v.assigned_worker_id && !plateByWorker.has(v.assigned_worker_id)) {
      plateByWorker.set(v.assigned_worker_id, v.plate);
    }
  }
  return (key: string): string | null =>
    key.startsWith("unassigned:")
      ? (vehiclesById.get(key.slice("unassigned:".length))?.plate ?? null)
      : (plateByWorker.get(key) ?? null);
}

export function computeIdleWaste(
  idleEpisodes: IdleEpisodeWithPlate[],
  vehiclesById: Map<string, VehicleLite>,
  workersById: Map<string, WorkerLite>
): IdleWasteSummary {
  const acc = new Map<string, { totalMs: number; episodeCount: number }>();
  let totalMs = 0;

  for (const ep of idleEpisodes) {
    const durationMs = idleEpisodeDurationMs(ep);
    totalMs += durationMs;
    const { key } = resolveDriver(ep.vehicle_id, vehiclesById, workersById);
    const cur = acc.get(key) ?? { totalMs: 0, episodeCount: 0 };
    cur.totalMs += durationMs;
    cur.episodeCount += 1;
    acc.set(key, cur);
  }

  const rows: IdleWasteRow[] = [...acc.entries()].map(([key, a]) => {
    const label = key.startsWith("unassigned:")
      ? resolveDriver(key.slice("unassigned:".length), vehiclesById, workersById).label
      : (workersById.get(key)?.name ?? "—");
    const hours = a.totalMs / 3_600_000;
    const liters = hours * IDLE_FUEL_L_PER_HOUR;
    return { key, name: label, totalMs: a.totalMs, episodeCount: a.episodeCount, liters, euro: liters * FUEL_PRICE_EUR_PER_L };
  });
  rows.sort((a, b) => b.totalMs - a.totalMs);

  const totalHours = totalMs / 3_600_000;
  const totalEuro = totalHours * IDLE_FUEL_L_PER_HOUR * FUEL_PRICE_EUR_PER_L;
  return { rows, totalMs, totalEuro };
}
