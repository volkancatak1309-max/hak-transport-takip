import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { turMemo } from "@/lib/query-counter";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { markKmMeasured } from "@/lib/km-quality";
import { markKmKarar, type WithKmKarar } from "@/lib/km-axis";
import type { ShiftWindow } from "@/lib/analytics";
import type { DateRange } from "@/lib/analytics-shared";
import type { TimeEntry } from "@/lib/types";

/**
 * ŞOFÖR PUANININ TEK ÇEKİRDEĞİ (18.09.2026).
 *
 * ═══ NEDEN BU DOSYA VAR: BİR EKRAN, İKİ GERÇEK ═════════════════════════════
 *
 * 18.09.2026'da HAK61 canlısında ölçülen tablo:
 *
 *     Cumhur Karataş   26 vardiya   ekranda 1.133 km   →  "Yeterli mesafe yok"
 *     Sinan Bayrak     11 vardiya   ekranda   452 km   →  "Yeterli mesafe yok"
 *
 * Sebep bir eşik hatası DEĞİLDİ: ekran ile puan AYNI ŞOFÖR İÇİN AYRI KM
 * OKUYORDU. Ekran `lib/km-axis.ts` çekirdeğini (cihaz → sayaç → null)
 * kullanıyordu; puan ise 052'nin (`shift_odometer_spans`) HAM şoför toplamını.
 * Cumhur'un aracı (DO-512GT) odometreyi yalnız kontak açıldıktan sonraki ilk
 * ~5 dakika gönderiyor — ölçüldü: 9 saatlik vardiyada 2.444 telemetri satırı,
 * odometreli olan 31'i ve hepsi ilk 6 dakikada, hepsi aynı değer. 052 o
 * vardiyayı "ölçüldü, 0 km" sayıyor. 26 vardiyanın 21'i böyle: ham toplam
 * 11 km, sayaç ekseni 1.133 km.
 *
 * İki eksen iki ayrı soru cevaplayamaz. Ekranda bir insanın yanında yazan km
 * ile onun puanını üreten km AYNI SAYI olmak zorundadır.
 *
 * ═══ NE KALDIRILDI ═════════════════════════════════════════════════════════
 *
 *  1. 052'nin ham şoför toplamı (`getWorkerShiftDistance().km`) puan paydası
 *     olmaktan çıktı. 052 ölmedi — `lib/km-axis.ts` çekirdeği onu ZATEN
 *     çağırıyor, ama üç kapıdan geçirerek (kapsama · negatif · makul km) ve
 *     geçemezse sayaç eksenine düşerek. Yani cihaz tercih edilmeye devam
 *     ediyor, körü körüne değil.
 *  2. AYRI %80 KAPSAMA KAPISI (`SCORE_MIN_KM_COVERAGE`). İki kapı aynı işi
 *     iki farklı tanımla yapıyordu ve ölçümde YANLIŞ tarafa düşüyordu:
 *     Cumhur %81 ile kapıyı GEÇİYOR (21/26 vardiya "ölçüldü") ama geçtiği 21
 *     vardiyanın toplamı 11 km. Kapsama artık çekirdeğin kararından türer —
 *     "ölçüldü" demek çekirdeğin bir km ürettiği demektir, 052'nin boş bir
 *     okuma döndürdüğü değil.
 *  3. Kişiye göre ölçeklenen eşik (bkz. lib/metric-thresholds.ts).
 *
 * ═══ VARDİYA TANIMI: BAŞLANGIÇ TARİHİ — TEK TANIM ══════════════════════════
 *
 * 18.09.2026'da ölçülen ikinci kusur: iki kapı iki farklı vardiya tanımı
 * kullanıyordu.
 *   · vardiya sayısı / ekran km'si → `started_at` pencerenin İÇİNDE
 *   · puan km'si + olay atfı       → 052'nin KESİŞEN vardiya kümesi
 * Canlı sonuç (HAK61, hafta penceresi 12→18.09): Mustafa Demirsöz'ün
 * 11.09 05:03 → 13.09 17:02 vardiyası pencerenin İÇİNDE BAŞLAMIYOR ama
 * pencereyle KESİŞİYOR. Satır ekranda "0 vardiya · km —" diyor, yanında
 * 51 PUAN taşıyor ve listede 3. sırada duruyordu. Aynı haftada dört şoförde
 * bu taşma vardı.
 *
 * SEÇİM: BAŞLANGIÇ TARİHİ. Üç gerekçe, hepsi ölçülebilir:
 *
 *   a) Panelin geri kalanının tanımı bu. Vardiya sayısı, çalışma süresi, km,
 *      teslimat, gün kırılımı ve Günün Panosu vardiyayı BAŞLADIĞI güne yazar
 *      (lib/reports.ts `dailyAcc`, `viennaDayKey(e.started_at)`). Kesişim
 *      tanımını seçmek bu altı sayının hepsini değiştirmek demekti.
 *   b) § 26 AZG RAPORU AYNI TANIMI KULLANIYOR ve kendi sorgusu var
 *      (lib/azg-report.ts: `started_at >= start`, `< end`, `ended_at not
 *      null`). Kesişimi seçseydik puan ile resmî çalışma-süresi belgesi
 *      farklı vardiya kümesi sayardı; belge denetimde savunulamazdı.
 *      Başlangıç tanımıyla AZG'ye HİÇ DOKUNULMUYOR — bu dosya onun sorgusunu
 *      ne okur ne değiştirir.
 *   c) Bir vardiya iki döneme birden yazılamaz. Kesişim tanımında 11→13.09
 *      vardiyası hem 05–11.09 hem 12–18.09 haftasına giriyordu, yani aynı
 *      156 km iki kez sıralama üretiyordu.
 *
 * BEDELİ AÇIK: pencereden önce başlayıp içinde biten bir vardiyanın km'si ve
 * olayları o pencerede HİÇ KİMSEYE yazılmaz (bir önceki pencereye yazılır).
 * Bu, "sahipsiz olay" kovasının zaten ölçtüğü ve ekranda gösterdiği bir
 * eksiklik türüdür (bkz. computeOwnerlessEvents) — uydurma atıftan iyidir.
 */

/** Puan çekirdeğinin okuduğu vardiya alanları. */
export type ScoreShiftRow = Pick<
  TimeEntry,
  | "id"
  | "worker_id"
  | "vehicle_id"
  | "started_at"
  | "ended_at"
  | "start_km"
  | "end_km"
  | "break_minutes"
  | "cargo_count"
  | "undelivered_count"
  /**
   * ⚠️ PUAN İÇİN GEREKMEZ (18.09.2026). Araç detayının dönem özeti "alınan
   * paket"i buradan okuyor ve AYNI vardiya satırlarından okumak zorunda —
   * ikinci bir `time_entries` sorgusu açsaydı iki yüzey iki farklı vardiya
   * kümesi sayardı. Kolon eklemek ek gidiş-geliş DEĞİL, aynı select'te bir
   * alan daha.
   */
  | "start_package_count"
>;

/** Km kararı iliştirilmiş vardiya — ekranın ve puanın ORTAK satırı. */
export type ScoreShift = WithKmKarar<ScoreShiftRow & { km_measured: boolean }>;

export type ScoreInput = {
  /**
   * Şoför → puanın paydası (km). Çekirdeğin ölçebildiği vardiyaların toplamı.
   * Şoför HARİTADA YOKSA payda yok demektir → skor null. "0 km sürdü" ile
   * "ölçemedik" bu yüzden ayrı: ilki haritada 0 olarak durur.
   */
  kmByWorker: Map<string, number>;
  /**
   * Şoför → { ölçülen, toplam } vardiya. SALT RAPORLAMA: hiçbir kapı bu orana
   * bakmaz (eski %80 kapısı kalktı). Ekranda "10 vardiyanın 4'ü ölçülemedi"
   * diyebilmek için taşınıyor.
   */
  coverageByWorker: Map<string, { olculen: number; toplam: number }>;
  /** Araç → vardiya pencereleri. Olay atfı ("o an direksiyonda kimdi") buradan. */
  windowsByVehicle: Map<string, ShiftWindow[]>;
};

/**
 * PUANIN VARDİYA SATIRLARI — Analiz sayfası ve Performans raporu AYNI çağrı.
 *
 * ⚠️ İKİ ELEME BURADA, TEK YERDE. Öncesinde Analiz sayfası kendi
 * `time_entries` sorgusunu yazıyordu ve YALNIZ test elemesi taşıyordu; şoför
 * kapsamı (lib/driver-scope.ts) yoktu. Yani yönetici hesabından açılmış bir
 * vardiya Analiz'in km atfına girip Performans raporuna girmiyordu. İki ekran
 * aynı soruya iki cevap veremez.
 *
 * KM KARARI DA BURADA İLİŞTİRİLİR (`markKmKarar`): satırın km'si sunucuda bir
 * kez kararlaştırılır, her çağıran onu okur. Tek RPC — vardiya başına çağrı
 * yok (bkz. lib/km-axis.ts).
 */
export function loadScoreShifts(
  range: DateRange,
  /**
   * ⚠️ YALNIZ SQL DARALTMASI — KM KARARI DEĞİŞMEZ (18.09.2026).
   *
   * Araç detayının dönem özeti tek aracın vardiyalarını istiyor. Filo genelini
   * okuyup JS'te süzmek ÖLÇÜLDÜ: "ay" penceresinde 1.545 ms (416 satır +
   * 416 satırlık `markKmMeasured` + 052). Araç daraltmasıyla aynı boru hattı
   * 27 satır üstünde koşuyor.
   *
   * Daraltma bir FORK DEĞİL: aynı sorgu, aynı iki eleme, aynı
   * `markKmMeasured` → `markKmKarar` sırası; yalnız `where`e bir eşitlik
   * eklenir. `kmKarariVer` satır satır karar verdiği için sonuç birebir aynı —
   * kanıt betiği bunu filo geneli çekirdekle karşılaştırarak ölçüyor.
   */
  vehicleId?: string
): Promise<ScoreShift[]> {
  /**
   * TUR İÇİ PAYLAŞIM (lib/report-reads.ts ile aynı kalıp ve aynı gerekçe).
   * Bir turda iki toplayıcı da (ör. filo karşılaştırma → Performans + kendi
   * sahipsiz sayacı) aynı aralığı isteyebiliyor; ikinci okuma birincisiyle
   * BİREBİR aynı sonucu döndürür. Kap yoksa (panel, cron) davranış eskisi:
   * `turMemo` doğrudan üreticiyi çağırır.
   */
  return turMemo(
    `skorVardiya:${range.start.toISOString()}:${range.end.toISOString()}:${vehicleId ?? "*"}`,
    () => okuScoreShifts(range, vehicleId)
  );
}

async function okuScoreShifts(range: DateRange, vehicleId?: string): Promise<ScoreShift[]> {
  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // SAYFALI: PostgREST 1000 satırda kesiyor ve `.limit()` bunu aşamıyor
  // (25.07.2026 ölçümü). ~29 şoför × 1 vardiya/gün ile tavan ~34 günde dolar.
  const { data } = await fetchAllRows<ScoreShiftRow>(
    (from, to) => {
      // test-filtered: `withoutTestRows(...)` aşağıda, aynı ifadenin dönüşünde.
      // driver-scoped: `onlyDrivers(...)` aynı dönüşte — kalıcı test şoförü ve
      // yönetici hesapları ikisinde de eleniyor. Sorgu burada parçalı kuruluyor
      // çünkü araç kapsamı (`.eq("vehicle_id", …)`) yalnız `where`e eklenmeli.
      const temel = supabaseAdmin
        .from("time_entries")
        .select(
          "id, worker_id, vehicle_id, started_at, ended_at, start_km, end_km, break_minutes, cargo_count, undelivered_count, start_package_count"
        )
        // VARDİYA TANIMI: başlangıç anı pencerenin içinde (dosya başlığı).
        .gte("started_at", range.start.toISOString())
        .lte("started_at", range.end.toISOString());
      // Araç kapsamı YALNIZ `where`e eklenir; eleme ve sıra aşağıda, tek yerde.
      const kapsamli = vehicleId ? temel.eq("vehicle_id", vehicleId) : temel;
      // driver-scoped: yönetici hesabından açılmış vardiyalar puana da, ekrana
      // da girmez (canlıda iki demo satır 20.100 km taşıyordu). Ayrılan
      // şoförlerin vardiyaları KALIR — onlar şoför, arşiv 7 yıl.
      return onlyDrivers(
        // test-filtered: kalıcı test şoförü (028) puan üretmemeli.
        withoutTestRows(
          kapsamli.order("started_at", { ascending: true }).order("id").range(from, to),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        driverScope
      );
    },
    "loadScoreShifts/time_entries"
  );
  // km_measured: cihazı sessiz vardiyanın 0 km'si ölçüm DEĞİLDİR; km_karar:
  // cihaz → sayaç → null ekseni. İkisi de satıra yazılır, hesap tek yerde.
  return markKmKarar(await markKmMeasured((data ?? []) as ScoreShiftRow[]));
}

/**
 * VARDİYA SATIRLARINDAN PUAN GİRDİSİ — ağ yok, yan etki yok.
 *
 * Saf durmasının sebebi ölçülebilirlik: canlı ölçüm betikleri ve muhafız BU
 * fonksiyonu çağırır, kuralın kopyasını yazmaz.
 *
 * `rangeEnd` açık vardiyanın pencere sonunu kapatır — 052'nin
 * `coalesce(ended_at, p_to)` kuralının ta kendisi, başka bir yerde değil.
 */
export function scoreInputFromShifts(
  shifts: ScoreShift[],
  range: DateRange
): ScoreInput {
  const kmByWorker = new Map<string, number>();
  const coverageByWorker = new Map<string, { olculen: number; toplam: number }>();
  const windowsByVehicle = new Map<string, ShiftWindow[]>();
  const rangeEndMs = range.end.getTime();

  for (const e of shifts) {
    if (!e.worker_id) continue;
    const km = e.km_karar.km;

    const c = coverageByWorker.get(e.worker_id) ?? { olculen: 0, toplam: 0 };
    c.toplam++;
    if (km !== null) c.olculen++;
    coverageByWorker.set(e.worker_id, c);

    /**
     * ÖLÇÜLEBİLEN VARDİYASI OLAN ŞOFÖR HARİTAYA GİRER — 0 km ile de.
     * `km !== null` kapısı "ölçtük" demektir; değerin 0 olması "park etti"
     * demektir ve bu bir ölçümdür (bkz. lib/km-quality.ts). Haritada hiç
     * olmamak ise "ölçemedik" demek ve skoru null yapan tek şey odur.
     */
    if (km !== null) {
      kmByWorker.set(e.worker_id, (kmByWorker.get(e.worker_id) ?? 0) + km);
    }

    if (!e.vehicle_id) continue;
    const arr = windowsByVehicle.get(e.vehicle_id) ?? [];
    arr.push({
      workerId: e.worker_id,
      vehicleId: e.vehicle_id,
      startMs: Date.parse(e.started_at),
      endMs: e.ended_at ? Date.parse(e.ended_at) : rangeEndMs,
      km,
    });
    windowsByVehicle.set(e.vehicle_id, arr);
  }

  // Deterministik sıra: `workerDrivingAt`in "en geç başlayan kazanır" kuralı
  // ancak sıra sabitse tekrarlanabilir olur (lib/analytics.ts).
  for (const arr of windowsByVehicle.values()) {
    arr.sort(
      (a, b) =>
        a.startMs - b.startMs ||
        a.endMs - b.endMs ||
        a.workerId.localeCompare(b.workerId)
    );
  }

  return { kmByWorker, coverageByWorker, windowsByVehicle };
}

/** Tek çağrıda satırlar + girdi — iki çağıranın da yaptığı şey. */
export async function loadScoreInput(
  range: DateRange
): Promise<{ shifts: ScoreShift[]; input: ScoreInput }> {
  const shifts = await loadScoreShifts(range);
  return { shifts, input: scoreInputFromShifts(shifts, range) };
}

/**
 * ARAÇ EKSENİNDE ÇEKİRDEK km — SAF, TEK TANIM (19.09.2026).
 *
 * `lib/km-axis.ts` kararı (cihaz → sayaç → null) vardiya vardiya verilir;
 * bu fonksiyon onu ARAÇ ekseninde toplar. Üç rapor (mesafe · hız · yakıt) ve
 * araç detayı özeti aynı fonksiyondan okur — uygulamada ikinci bir km ekseni
 * kalmasın diye.
 *
 * ⚠️ DÖNÜŞ `null` İKİ DURUMU DA KAPSAR: aracın hiç vardiyası yok, ya da
 * vardiyası var ama çekirdek hiçbirinde ölçemedi. İkisi de "km yok" demek ve
 * ikisinde de 0 YAZILMAZ — 0 bir ölçümdür (araç kıpırdamadı), yokluk değil.
 * Ayrımı gereken tek yer araç detayı özeti ve orada vardiya sayısı zaten var.
 */
export function aracCekirdekKm(shifts: ScoreShift[]): Map<string, number | null> {
  const toplam = new Map<string, number>();
  const olculen = new Map<string, number>();
  const gorulen = new Set<string>();
  for (const e of shifts) {
    if (!e.vehicle_id) continue;
    gorulen.add(e.vehicle_id);
    const d = e.km_karar.km;
    if (d === null) continue;
    toplam.set(e.vehicle_id, (toplam.get(e.vehicle_id) ?? 0) + d);
    olculen.set(e.vehicle_id, (olculen.get(e.vehicle_id) ?? 0) + 1);
  }
  const out = new Map<string, number | null>();
  for (const id of gorulen) {
    out.set(id, (olculen.get(id) ?? 0) > 0 ? (toplam.get(id) as number) : null);
  }
  return out;
}
