import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import {
  startOfTodayVienna,
  workedMs,
  kmDiff,
} from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { listFleetActiveDtc, listLatestVehiclePositions } from "@/lib/telemetry";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers, type DriverScope } from "@/lib/driver-scope";
import {
  UNRESTRICTED,
  onlyFleet,
  type FleetScope,
} from "@/lib/fleet-scope";
import {
  BREAK45_THRESHOLD_MS,
  requiredBreakMin,
  touchesNightWindow,
  dailyCapMs,
  workerDayBuckets,
} from "@/lib/azg-rules";
import type { TimeEntry, Worker, VehicleLiveStatus } from "@/lib/types";
import { LEAVES_ENABLED } from "@/lib/features";
import { todayYmdVienna } from "@/lib/leaves";

/**
 * 9 SAAT ARTIK "İHLAL" DEĞİL (22.07.2026). Eşikler lib/azg-rules.ts'te:
 *   • OVER_LIMIT_MS        = 12 sa → § 9 Abs. 1, gerçek yasal ihlal (bordo)
 *   • BREAK45_THRESHOLD_MS =  9 sa → § 13c Abs. 1, mola 45 dk'ya çıkar (gold)
 * Panel bu ikisini AYRI gösteriyor; eskiden 9 saat ihlal gibi işaretlendiği
 * için 20 şoför kırmızı görünüyordu.
 */
/** A shift with this many undelivered packages is surfaced as an action item. */
const UNDELIVERED_THRESHOLD = 5;
/** Inspection/insurance within this many days (or already overdue) is flagged. */
const DOC_DUE_WINDOW_DAYS = 30;
/** Ehliyet bu kadar gün içinde doluyorsa aksiyon listesine düşer. */
const LICENSE_DUE_WINDOW_DAYS = 30;
/**
 * Cihazlı bir araç bu kadar saattir HİÇ telemetri göndermediyse "konum
 * göndermiyor" uyarısı çıkar. Eşik gerçek kadanstan türetildi: park hâlindeki
 * araç kontak KAPALIYKEN bile saatlik heartbeat gönderiyor (canlı örnek:
 * 12:18 · 13:18 · 14:18 · 15:18), yani 24 saat sessizlik "araç duruyor" değil,
 * cihaz/bağlantı arızasıdır. (Volkan onayı, 21.07.2026.)
 */
const TELEMETRY_SILENT_HOURS = 24;
/** Araç bu tazelikte kontak-açık telemetriyle "hareket halinde" sayılır
 *  (movingNoShift Dikkat kalemi). Bayat fix "şu an sürüyor" demek değildir. */
const MOVING_FRESH_MS = 15 * 60 * 1000;

/** Live snapshot of "where are we right now / today" — independent of the
 *  range/worker/status filters that drive the shift table below. */
export type TodayOps = {
  driversInField: number; // active shifts (ended_at IS NULL)
  vehiclesDelivering: number; // vehicles whose live status is "sevkiyatta"
  onBreak: number; // active shifts currently on break
  totalKmToday: number | null; // sum of km on shifts started today (null = no data)
  loaded: number | null; // sum of start_package_count today (packages LOADED at start)
  delivered: number | null; // sum of cargo_count on ENDED shifts today (actually delivered)
  undelivered: number | null; // sum of undelivered_count today
  /** § 9 Abs. 1 — günlük tavanı (gece vardiyasında 10 sa) aşan vardiya sayısı. */
  overLimit: number;
  /** § 13c Abs. 1 — 9 saati aşıp 45 dk mola gerektiren vardiya sayısı. */
  needsBreak45: number;
  shiftsToday: number; // total shifts started today (for "no data" states)
};

export type FleetStatus = {
  total: number;
  counts: Record<VehicleLiveStatus, number>;
};

export type AttentionItem =
  /** § 9 Abs. 1 / § 14 Abs. 2 — günlük tavan aşıldı. Gerçek ihlal. */
  | {
      kind: "overLimit";
      id: string;
      worker_name: string;
      ms: number;
      /** Bu vardiyaya uygulanan tavan (gece ise 10 sa, değilse 12 sa). */
      capMs: number;
      night: boolean;
      /** Vardiyanın başlangıç anı (time_entries.started_at) — mobil sıralama. */
      started_at: string;
    }
  /** § 13c Abs. 1 — 9 saati aştı, molası 45 dakikanın altında kaldı. */
  | {
      kind: "break45";
      id: string;
      worker_name: string;
      ms: number;
      breakMin: number;
      requiredMin: number;
      /** Vardiyanın başlangıç anı (time_entries.started_at) — mobil sıralama. */
      started_at: string;
    }
  /**
   * Aynı şoför aynı Viyana gününde İKİNCİ (ya da sonraki) vardiyayı açtı
   * (14.08.2026, SHIFT_PER_DAY='many'). İHLAL DEĞİL — Sendigo'nun iş modeli
   * bu (gece vardiyası + gündüz çağrı işi). Kalem, "günde tek vardiya"
   * kilidi kalkan kiracıda günün gerçekten çift olduğunu yöneticiye GÖRÜNÜR
   * kılar. DIŞ BİLDİRİM YOK: uyarı yalnız panelde (Volkan kararı, 037'deki
   * şef-manuel-başlatma kalemiyle aynı desen).
   */
  | {
      kind: "secondShift";
      id: string;
      worker_name: string;
      /** Günün kaçıncı vardiyası (2, 3, …). */
      count: number;
      /** Günün TÜM vardiyalarının toplam çalışma süresi. */
      totalMs: number;
      /** Son vardiyanın başlangıcı — mobil sıralama + "ne zaman" sorusu. */
      started_at: string;
    }
  | {
      kind: "inspection" | "insurance";
      id: string;
      plate: string;
      due: string;
      days: number; // days until due (negative = overdue)
    }
  | {
      kind: "undelivered";
      id: string;
      /** Düzeltme kısayolu için vardiya kaydının kendi id'si (22.07.2026). */
      entry_id: string;
      worker_name: string;
      count: number;
      date: string;
    }
  | {
      kind: "penalty"; // unpaid vehicle penalties, aggregated per vehicle
      id: string;
      plate: string;
      count: number;
      amount: number | null; // total amount of the unpaid penalties (null if none priced)
      /** EN YENİ ödenmemiş cezanın tarihi (vehicle_penalties.penalty_date).
       *  Kalem araç başına TOPLANDIĞI için tek tarih taşınır: en yenisi —
       *  "en yeni üstte" sıralamasında kalemin yeri onu belirler. */
      latest_date: string | null;
    }
  | {
      kind: "license"; // şoför ehliyeti doldu / dolmak üzere (workers.license_expiry)
      id: string;
      worker_name: string;
      due: string;
      days: number; // dolmasına kaç gün (negatif = doldu)
    }
  | {
      // KM ÖLÇÜLEMİYOR (15.08.2026): BUGÜN açılmış vardiya, cihazı sessiz bir
      // araçla. Vardiya boyunca araçtan hiç telemetri gelmediği için km bir
      // ölçüm değil — bayat odometre iki uca da yazılınca fark 0 çıkıyor ve
      // rapor "0 km" diyordu. Kalem "veri yok" der, sayı uydurmaz.
      kind: "kmUnmeasured";
      id: string;
      worker_name: string;
      plate: string;
      /** Aracın son telemetri anı — null ise cihaz HİÇ konuşmamış. */
      last_seen: string | null;
      /** Son telemetriden bu yana geçen saat; last_seen null ise null. */
      hours: number | null;
    }
  | {
      kind: "silent"; // cihazlı aktif araç uzun süredir hiç telemetri göndermiyor
      id: string;
      plate: string;
      hours: number; // son kayıttan bu yana geçen saat
      /** Son telemetri anı (positions.recorded_at) — `hours` zaten ondan türür. */
      at: string;
    }
  | {
      // Araç ŞU AN kontak açık/taze ama o araçta AÇIK vardiya YOK (Modül 1).
      // İzinli/ayrılan şoförün aracını başkası kullanınca auto-shift bilinçli
      // olarak vardiya AÇMAZ (yanlış isme yazmamak için); bu boşluğu yönetici
      // görsün ki gerçek sürücü kendi adına vardiya başlatsın.
      kind: "movingNoShift";
      id: string;
      plate: string;
      /** Uyarıyı tetikleyen taze fix'in anı (positions.recorded_at). */
      at: string;
    }
  | {
      // ATAMASIZ ARAÇ SAHADA (27.07.2026): assigned_worker_id NULL olduğu hâlde
      // araç kontak açık ve taze telemetriyle yolda. `driverless` bunu YAKALAMAZ
      // — o kalem "atanmış şoför işten ayrıldı" (alan DOLU, kişi pasif) demek.
      // Alanın hiç doldurulmadığı araç panoda tamamen görünmezdi: 27.07'de
      // DO-671GY bütün gün yol yaptı, depoya girdi, hiçbir kaleme düşmedi.
      kind: "unassignedMoving";
      id: string;
      plate: string;
      /** Uyarıyı tetikleyen taze fix'in anı (positions.recorded_at). */
      at: string;
    }
  | {
      // AKTİF aracın atanmış şoförü İŞTEN AYRILDI (is_active=false/terminated)
      // → araç şoförsüz kaldı; patron yeniden atamalı (Modül 2). assigned_worker_id
      // bilinçli boşaltılmadığı için bu kalem "atama bekliyor" sinyalidir.
      kind: "driverless";
      id: string;
      plate: string;
      worker_name: string;
      /** Ayrılan şoförün son çalışma günü (workers.terminated_at, 032).
       *  Kolon yoksa ya da tarih girilmemişse null — an uydurulmaz. */
      terminated_at: string | null;
    }
  | {
      // ARAÇTAN SİNYAL YOK: vardiya açılırken depo kapısı konumu doğrulayamadı
      // (cihaz sessiz/ölü ya da yönetici muafiyeti) — Modül 6, bayrak 038'de
      // ikiye ayrıldı. Artık YALNIZ gerçek doğrulanamama; "saat tahmini" ayrı
      // kalem (startEstimated), yoksa bu satır her sabah yanlış alarm veriyordu.
      kind: "locationUnverified";
      id: string;
      worker_name: string;
      /** Üretici vardiyanın başlangıç anı (time_entries.started_at). */
      started_at: string;
    }
  | {
      // SAAT TAHMİNİ: araç depodaydı (konum doğrulandı) ama started_at depo
      // girişinden türetilemedi — 14 gün ortalaması ya da "şimdi" kullanıldı
      // (038). Konum sorunu DEĞİL; yönetici yalnız saati gözden geçirsin.
      kind: "startEstimated";
      id: string;
      worker_name: string;
      /** Üretici vardiyanın başlangıç anı (time_entries.started_at). */
      started_at: string;
    }
  | {
      // Auto vardiya ≥3h açık ama ARAÇ hiç hareket etmemiş (kontak kapalı, hız
      // yok, odometre sabit) ve paket de girilmemiş → vardiya boşuna açılmış
      // olabilir. (Modül 7 — 25.07.2026'da "panele girmedi" kuralının yerine.)
      kind: "vehicleIdle";
      id: string;
      worker_name: string;
      /** Üretici (auto) vardiyanın başlangıç anı (time_entries.started_at). */
      started_at: string;
    }
  | {
      // Filo şefi bir personelin mesaisini ELLE başlattı (037) → panelde bildirim.
      // YALNIZ start_source='chief'; patron kendi başlattığını zaten bilir.
      kind: "manualStart";
      id: string;
      worker_name: string;
      by_name: string;
      started_at: string;
    };

/** Filo geneli arıza (DTC) özeti — plaka + aktif kod sayısı + en uzun süredir
 *  açık kod. Şiddet alanı YOK: ne `vehicle_dtc`'de ne de kod sözlüğünde
 *  karşılaştırılabilir bir severity verisi var (bkz. listFleetActiveDtc). */
export type FleetDtcRow = {
  vehicle_id: string;
  plate: string;
  count: number;
  oldest_code: string | null;
  oldest_since: string | null;
  /** Araçtaki aktif kodların kendisi (first_seen ARTAN — en eski önce).
   *  listFleetActiveDtc zaten satır satır okuyordu, artık atmıyor (10.08.2026). */
  codes: { code: string; first_seen: string }[];
};

/**
 * GÜNÜN PANOSU — yönetici sabah açtığında sorduğu tek soru: "bugün kim, hangi
 * araçla, ne durumda?" (Volkan, 22.07.2026).
 *
 * Satır sayısı vardiya sayısı DEĞİL, AKTİF ŞOFÖR sayısıdır: vardiya açmamış
 * şoför de bir satırdır — panonun asıl varlık sebebi odur. Eski panoda 12 kutu
 * vardı ama "kim işe çıkmadı" sorusu hiçbir yerde cevaplanmıyordu.
 *
 * Araç eşleşmesinin tek kaynağı `vehicles.assigned_worker_id`. Şoför o gün
 * BAŞKA bir araçla vardiya açtıysa (`usedPlate`) bu ayrıca gösterilir — sessiz
 * düzeltmek yerine farkı görünür kılıyoruz.
 */
export type RosterStatus =
  | "not_started"
  | "in_field"
  | "on_break"
  | "closed"
  | "on_leave";

export type TodayRosterRow = {
  workerId: string;
  name: string;
  /**
   * Satırın dayandığı BUGÜNKÜ vardiya kaydının id'si (time_entries.id) —
   * mobilde satırdan `/shift/[id]` detayına gitmek için. Vardiya açmamış
   * (not_started) ve izinli (on_leave) satırlarda null. Hangi vardiya
   * seçildiği entryByWorker kuralına bağlıdır: açık olan, yoksa en geç
   * başlayan.
   */
  entryId: string | null;
  /** vehicles.assigned_worker_id ile eşleşen araç; yoksa null. */
  plate: string | null;
  vehicleStatus: string | null;
  /** Vardiyada GERÇEKTEN kullanılan plaka — atanmışdan farklıysa doludur. */
  usedPlate: string | null;
  status: RosterStatus;
  startedAt: string | null;
  endedAt: string | null;
  /** Gün başında alınan paket (start_package_count). */
  loadedPackages: number | null;
  /** Atanmış aracın son telemetrisinin yaşı (ms); cihaz/veri yoksa null. */
  telemetryAgeMs: number | null;
  /** Son veri 24 saatten eskiyse true — araç "kör" demektir. */
  telemetryStale: boolean;
  /** Atanmış aracın modeli (vehicles.model) — mobil "plaka · model" satırı. */
  model: string | null;
  /**
   * Bu şoförün bugün kullandığı aracı BAŞKA bir şoför de kullandı mı?
   * (22.07.2026) Geçici araç seçimi serbest bırakıldı; aynı araca iki kişi
   * binebiliyor. Bitiş km'si İKİ vardiyada da AYNI odometreden türediği için
   * mesafe çift sayılır. Sayıyı BOZMUYORUZ (Volkan kararı) — rozetle görünür
   * kılıyoruz ki yönetici gerekirse elle düzeltsin.
   */
  sharedVehicle: boolean;
};

export type DashboardData = {
  todayOps: TodayOps;
  fleet: FleetStatus;
  dtc: FleetDtcRow[];
  attention: AttentionItem[];
  /** Günün panosu — her aktif şoför için bir satır. */
  roster: TodayRosterRow[];
  /**
   * ŞU AN açık vardiyası olan ARAÇ sayısı (openVehicleIds.size) — mobil
   * "SAHADA n/N" halkasının payı. `todayOps.driversInField` (açık VARDİYA,
   * aynı araca iki vardiya açılabilir) ve `fleet.counts.sevkiyatta` (canlı
   * kontak/hız durumu) İKİSİ DE bu sayı değildir; üçü bilinçli ayrı.
   */
  openVehicleCount: number;
  /**
   * BUGÜNKÜ ham vardiya satırları. /admin "Kapanmamış Vardiyalar" kartı, açık
   * vardiyanın AZG gün tavanını hesaplarken şoförün bugün ZATEN kapattığı
   * süreyi eklemek zorunda (şoför-gün ekseni, 14.08.2026); ikinci bir sorgu
   * aynı pencereyi iki kez okumak olurdu.
   */
  todayEntries: LiteEntry[];
};

type LiteEntry = Pick<
  TimeEntry,
  | "id"
  | "worker_id"
  | "started_at"
  | "ended_at"
  | "start_km"
  | "end_km"
  | "break_minutes"
  | "break_started_at"
  | "start_package_count"
  | "cargo_count"
  | "undelivered_count"
  | "vehicle_id"
  | "plate"
>;

const ENTRY_COLS =
  "id, worker_id, started_at, ended_at, start_km, end_km, break_minutes, break_started_at, start_package_count, cargo_count, undelivered_count, vehicle_id, plate";

/**
 * Everything the redesigned admin command panel needs, derived purely from the
 * existing tables (time_entries, vehicles, workers). All sections degrade to
 * empty/"no data" states rather than throwing when a table is empty.
 *
 * Two shift reads run in parallel: today's shifts (live ops) and the selected
 * range's shifts (action items), alongside the fleet status snapshot.
 */
export async function getDashboardData(
  rangeStart: string,
  rangeEnd: string,
  /**
   * Filo kapsami (migration 029). Patronda UNRESTRICTED -> hicbir sorgu
   * daraltilmaz; filo sefinde yalniz kendi filosunun arac/soforleri.
   * Panonun HER bolumu (Gunun Panosu, Dikkat/Aksiyon, Kapanmamis
   * Vardiyalar, Ops Ozeti, 5'li serit) asagidaki dizilerden turedigi
   * icin eleme burada bir kez yapilir.
   */
  fleetScope: FleetScope = UNRESTRICTED
): Promise<DashboardData> {
  const todayStart = startOfTodayVienna();

  // Test kayıtları (migration 028) panonun HİÇBİR bölümünde görünmez: roster,
  // Operasyon Özeti, Dikkat/Aksiyon ve Kapanmamış Vardiyalar hepsi aşağıdaki
  // dizilerden türediği için eleme burada bir kez yapılır.
  const scope = await getTestScope();
  // Şoför kapsamı: yönetici hesapları roster'a ve ehliyet uyarılarına girmez
  // (lib/driver-scope.ts). İkisi de aşağıdaki dizilerden türer.
  const driverScope = await getDriverScope();

  const [
    todayRes,
    rangeRes,
    activeRes,
    vehicles,
    workersRes,
    licenseRes,
    penaltyRes,
    positions,
    dtcRows,
    leavesRes,
    unverifiedRes,
    estimatedRes,
    manualStartRes,
  ] = await Promise.all([
    // driver-scoped: yönetici hesabından açılmış vardiyalar panonun HİÇBİR
    // sayısına girmemeli. Roster zaten eleniyordu ama vardiya VERİSİ elenmiyordu:
    // Operasyon Özeti, Toplam KM ve canlı durum kartı üçü de bu dizilerden
    // türüyor. Canlıda iki demo satır 20.100 km taşıyordu.
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select(ENTRY_COLS)
            .gte("started_at", todayStart.toISOString()),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
    // Uzun aralıklar 1000 satır tavanını aşabilir → performans sıralaması ve
    // aksiyon kalemleri eksik hesaplanmasın diye sonuna kadar sayfalanır.
    fetchAllRows<LiteEntry>((from, to) =>
      // driver-scoped: yukarıdakiyle aynı gerekçe (aralık verisi).
      onlyDrivers(
        onlyFleet(
          withoutTestRows(
            supabaseAdmin
              .from("time_entries")
              .select(ENTRY_COLS)
              .gte("started_at", rangeStart)
              .lte("started_at", rangeEnd)
              .order("id"),
            "worker_id",
            scope.workerIds
          ),
          "worker_id",
          fleetScope.workerIds,
          fleetScope
        ),
        "worker_id",
        driverScope
      ).range(from, to)
    ),
    // Single source of truth for live status: EVERY open shift (ended_at IS
    // NULL), independent of the today/range window. The top summary, the
    // active-shift card and the table all derive their "active / on break /
    // in field" numbers from this one set so they can never disagree.
    // driver-scoped: harita aynı soruya ("kim şu an açık vardiyada") artık
    // kapsamlı cevap veriyor — burası kapsamsız kalırsa iki ekran birbirini
    // tutmaz. Otomatik kapanış kaldırıldığı için yöneticinin kapanmamış bir
    // vardiyası burada süresiz "sahada" görünürdü.
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select("id, worker_id, vehicle_id, started_at, break_started_at, auto_started")
            .is("ended_at", null),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
    listVehiclesWithStatus(fleetScope),
    // is_active/is_admin de okunur: Günün Panosu satırları AKTİF ŞOFÖRLERDEN
    // kurulur (yönetici hesapları ve ayrılmış personel panoyu şişirmemeli).
    // test-filtered: withoutTestRows — Günün Panosu roster'ının kaynağı.
    // Filo sefinde YALNIZ kendi filosunun soforleri; araci olmayan
    // personel hicbir sefin kapsaminda degildir (bkz. lib/fleet-scope.ts).
    onlyFleet(
      withoutTestRows(
        supabaseAdmin.from("workers").select("id, name, is_active, is_admin"),
        "id",
        scope.workerIds
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Ehliyet uyarısı (migration 025). İsim haritasından AYRI sorgu: migration
    // uygulanmamış bir ortamda license_expiry kolonu yoktur → sorgu error döner,
    // data null → yalnız ehliyet uyarıları boş kalır, dashboard'ın geri kalanı
    // (isimler dahil) etkilenmez. Yalnız çalışan personel uyarı üretir.
    onlyFleet(
      // driver-scoped: ehliyet uyarısı bir ŞOFÖR uyarısıdır. Yöneticinin
      // ehliyet tarihi doluysa "Dikkat/Aksiyon" panosuna şoför kalemi olarak
      // düşüyordu. Şefler is_admin=false olduğu için uyarı ALMAYA DEVAM eder —
      // onlar direksiyona geçiyor. is_active=true ise ayrı bir soru ("hâlâ
      // çalışıyor mu") ve KALIR: ayrılmış personelin ehliyeti kimseyi
      // ilgilendirmez.
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("workers")
            .select("id, name, license_expiry")
            .eq("is_active", true)
            .not("license_expiry", "is", null),
          "id",
          scope.workerIds
        ),
        "id",
        driverScope
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Unpaid vehicle penalties (Strafe) → surfaced as action items.
    // penalty_date 10.08.2026'da eklendi (mobil "an" alanı): kolon tablonun
    // KENDİ migration'ında (014) tanımlı, üç kurulumda da tablo onsuz var olamaz.
    onlyFleet(
      supabaseAdmin
        .from("vehicle_penalties")
        .select("vehicle_id, amount, penalty_date")
        .eq("paid", false),
      // ARAÇ verisi → araç ekseniyle daraltılır (vardiya verisi gibi şoför
      // ekseniyle DEĞİL). Ceza aracın borcudur, şoförün değil.
      "vehicle_id",
      fleetScope.vehicleIds,
      fleetScope
    ),
    // Cihazlı araçların SON telemetri kaydı → "konum göndermiyor" uyarısı.
    // Haritanın kullandığı sorgunun aynısı (araç başına indexli limit-1).
    listLatestVehiclePositions(fleetScope),
    // Filo geneli aktif arıza kodları (migration 021 yoksa boş liste).
    listFleetActiveDtc(),
    // BUGÜN ONAYLI izinli şoförler (Modül 1) → Günün Panosu "İzinli" durumu.
    // Roster ile AYNI eksende (test + filo) daraltılır. Tablo yoksa error →
    // data null → boş Set → özellik sessizce devre dışı, pano bozulmaz.
    // PENDING talepler DAHİL DEĞİL — yalnız 'approved' gerçek izindir.
    LEAVES_ENABLED
      ? onlyFleet(
          withoutTestRows(
            supabaseAdmin
              .from("worker_leaves")
              .select("worker_id")
              .eq("status", "approved")
              .lte("start_date", todayYmdVienna())
              .gte("end_date", todayYmdVienna()),
            "worker_id",
            scope.workerIds
          ),
          "worker_id",
          fleetScope.workerIds,
          fleetScope
        )
      : Promise.resolve({ data: [] as { worker_id: string }[] }),
    // Bugün ARAÇTAN SİNYAL ALINAMADAN açılmış vardiyalar (Modül 6). Kolon yoksa
    // (migration 035 öncesi) error → data null → boş → kalem çıkmaz (best-effort).
    // driver-scoped: Dikkat kalemi bir ŞOFÖR uyarısıdır.
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select("id, worker_id, started_at")
            .eq("location_unverified", true)
            .gte("started_at", todayStart.toISOString()),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
    // Bugün başlangıç anı KESTİRİMLE yazılmış vardiyalar (038). Araç depodaydı,
    // yalnız saat depo girişinden türetilemedi — konum sorunu değil. Kolon yoksa
    // (038 öncesi) error → data null → boş → kalem çıkmaz (best-effort).
    // driver-scoped: Dikkat kalemi bir ŞOFÖR uyarısıdır.
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select("id, worker_id, started_at")
            .eq("start_time_estimated", true)
            .gte("started_at", todayStart.toISOString()),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
    // Bugün FİLO ŞEFİNİN elle başlattığı vardiyalar (037) → panelde Dikkat
    // bildirimi. start_source kolonu yoksa (037 öncesi) error → data null → boş
    // → kalem çıkmaz (best-effort). Patron başlatmaları ('admin') gösterilmez.
    // driver-scoped: Dikkat kalemi bir ŞOFÖR uyarısıdır. (Şefin KENDİSİ şoför
    // kalır — burada elenen, adına vardiya açılan kişi yönetici ise o satır.)
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select("id, worker_id, started_by, started_at")
            .eq("start_source", "chief")
            .gte("started_at", todayStart.toISOString()),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
  ]);

  // km_measured: cihazı sessiz vardiyanın 0 km'si ölçüm DEĞİL — Operasyon
  // Özeti'ndeki "Toplam KM" bu 0'ları sessizce topluyordu (bkz. lib/km-quality.ts).
  const [todayEntries, rangeEntries] = await Promise.all([
    markKmMeasured((todayRes.data ?? []) as LiteEntry[]),
    markKmMeasured((rangeRes.data ?? []) as LiteEntry[]),
  ]);
  const activeShifts = (activeRes.data ?? []) as {
    id: string;
    worker_id: string | null;
    vehicle_id: string | null;
    started_at: string;
    break_started_at: string | null;
    auto_started: boolean;
  }[];
  const workerRows = (workersRes.data ?? []) as (Pick<Worker, "id" | "name"> & {
    is_active?: boolean | null;
    is_admin?: boolean | null;
  })[];
  const names = new Map(workerRows.map((w) => [w.id, w.name]));
  const unpaidPenalties = (penaltyRes.data ?? []) as {
    vehicle_id: string;
    amount: number | null;
    penalty_date: string | null;
  }[];
  const licenses = (licenseRes.data ?? []) as {
    id: string;
    name: string;
    license_expiry: string;
  }[];
  // Bugün ONAYLI izinli şoförler → roster "İzinli" durumu (Modül 1).
  const leaveWorkerIds = new Set(
    ((leavesRes.data ?? []) as { worker_id: string }[]).map((r) => r.worker_id)
  );
  // Şu an AÇIK vardiyası olan araçlar → movingNoShift Dikkat kalemi için.
  const openVehicleIds = new Set(
    activeShifts.map((s) => s.vehicle_id).filter(Boolean) as string[]
  );
  // İşten ayrılan/pasif personel → "şoförsüz araç" Dikkat kalemi için (Modül 2).
  // workerRows is_active taşır (filtresiz sorgu, roster in-memory eler).
  const inactiveWorkerIds = new Set(
    workerRows.filter((w) => w.is_active === false).map((w) => w.id)
  );
  // Şoförsüz araç kalemine "an" (workers.terminated_at, 032) — AYRI, best-effort
  // sorgu: kolonu ana workers select'ine eklemek, 032 uygulanmamış bir kurulumda
  // sorguyu error'a düşürüp TÜM panoyu (isim sözlüğü dahil) boşaltırdı. Burada
  // anahtarlı (.in("id")) küçük bir okuma: kolon yok / hata → boş harita →
  // kalem yalnız `terminated_at`siz çıkar, pano bozulmaz.
  const driverlessCandidateIds = [
    ...new Set(
      vehicles
        .filter(
          (v) =>
            v.status !== "inactive" &&
            v.assigned_worker_id &&
            inactiveWorkerIds.has(v.assigned_worker_id)
        )
        .map((v) => v.assigned_worker_id as string)
    ),
  ];
  let terminatedAtByWorker = new Map<string, string | null>();
  if (driverlessCandidateIds.length > 0) {
    try {
      const { data: tRows } = await supabaseAdmin
        .from("workers")
        .select("id, terminated_at")
        .in("id", driverlessCandidateIds);
      terminatedAtByWorker = new Map(
        ((tRows ?? []) as { id: string; terminated_at: string | null }[]).map(
          (w) => [w.id, w.terminated_at]
        )
      );
    } catch {
      // an'sız kalem, panosuz kalemden iyidir — sessizce boş bırak.
    }
  }
  // Bugün ARAÇTAN SİNYAL ALINAMADAN açılmış vardiyalar (Modül 6) → Dikkat kalemi.
  const locationUnverified = (
    (unverifiedRes.data ?? []) as {
      id: string;
      worker_id: string | null;
      started_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    worker_name: r.worker_id ? names.get(r.worker_id) ?? "—" : "—",
    started_at: r.started_at,
  }));
  // Bugün başlangıç anı KESTİRİMLE yazılmış vardiyalar (038) → ayrı Dikkat kalemi.
  // Sinyalsiz kayıt ikisine birden düşebilir; bu bilinçli — iki farklı eylem
  // gerektirir (cihazı onart / saati gözden geçir).
  const startEstimated = (
    (estimatedRes.data ?? []) as {
      id: string;
      worker_id: string | null;
      started_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    worker_name: r.worker_id ? names.get(r.worker_id) ?? "—" : "—",
    started_at: r.started_at,
  }));
  // HAREKETSİZ ARAÇ (Modül 7 — 25.07.2026, eski "2h-soğuk panel" kuralının yerine).
  //
  // ESKİ KURAL KALDIRILDI: "auto vardiya ≥2h açık + şoför panele girmemiş →
  // araçta olmayabilir". Panel dokunuşu bu filoda varlık sinyali DEĞİL: şoförler
  // paneli sabah paket girmek, akşam kapatmak için açıyor, aradaki 8-10 saat
  // boyunca hiç dokunmuyorlar. 25.07'de kural üç vardiyanın ÜÇÜNDE de yanlış
  // alarm verdi; oysa araçlar 20-43 km yol yapmış, iki şoför 358 ve 230 paket
  // teslim edip vardiyayı kendi eliyle kapatmıştı.
  //
  // YENİ KURAL — soru "şoför panele dokundu mu" değil, "ARAÇ çalıştı mı":
  // auto vardiya ≥3 saattir açık AMA araçtan hiçbir hareket kanıtı yok → vardiya
  // boşuna açılmış olabilir. Kanıtlardan HERHANGİ biri varsa uyarı çıkmaz.
  //
  // 3 saat: depoda yükleme 1-2 saati bulabiliyor (25.07'de bir şoförün molası
  // 259 dk), 2 saatlik eşik yükleme yapan aracı "ölü" sayardı.
  //
  // FAIL-QUIET: telemetri hiç yoksa ya da sorgu hata verirse uyarı ÇIKMAZ.
  // Sessiz cihazın kendi kalemi zaten var ("24 saattir konum göndermiyor");
  // aynı araç için iki alarm basmayız.
  const IDLE_VEHICLE_MS = 3 * 60 * 60 * 1000;
  const idleNowMs = Date.now();
  const idleCandidates = activeShifts.filter(
    (s) =>
      s.auto_started &&
      s.worker_id &&
      s.vehicle_id &&
      idleNowMs - new Date(s.started_at).getTime() >= IDLE_VEHICLE_MS
  );
  const vehicleIdle = (
    await Promise.all(
      idleCandidates.map(async (s) => {
        try {
          // ④ Paket girildiyse şoför araçtadır — telemetriye bakmaya gerek yok.
          if (await shiftHasPackages(s.id)) return null;
          const moved = await vehicleMovedSince(
            s.vehicle_id as string,
            s.started_at
          );
          // true = hareket var, null = bilinmiyor (fail-quiet) → uyarı yok.
          if (moved !== false) return null;
          return {
            id: s.id,
            worker_name: names.get(s.worker_id as string) ?? "—",
            started_at: s.started_at,
          };
        } catch {
          return null;
        }
      })
    )
  ).filter(
    (r): r is { id: string; worker_name: string; started_at: string } =>
      r !== null
  );

  // FİLO ŞEFİ MANUEL BAŞLATMALARI (037) → Dikkat panosu bildirimi. started_by
  // (şef) çoğu zaman kendi filo aracına atanmış değildir, dolayısıyla `names`
  // haritasında olmayabilir; eksik isimler ayrı bir sorguyla çözülür (best-effort:
  // isim çözülemezse '—'). worker_name hedef şoför (kapsamda → names'te vardır).
  let manualStarts: {
    id: string;
    worker_name: string;
    by_name: string;
    started_at: string;
  }[] = [];
  const msRows = (manualStartRes.data ?? []) as {
    id: string;
    worker_id: string | null;
    started_by: string | null;
    started_at: string;
  }[];
  if (msRows.length > 0) {
    const byName = new Map<string, string>();
    const missing = [
      ...new Set(msRows.map((r) => r.started_by).filter(Boolean) as string[]),
    ].filter((id) => !names.has(id));
    if (missing.length > 0) {
      try {
        const { data: bw } = await supabaseAdmin
          .from("workers")
          .select("id, name")
          .in("id", missing);
        for (const w of (bw ?? []) as { id: string; name: string }[]) {
          byName.set(w.id, w.name);
        }
      } catch {
        // isim çözülemezse '—' basılır — bildirimi düşürmeyiz.
      }
    }
    manualStarts = msRows.map((r) => ({
      id: r.id,
      worker_name: r.worker_id ? names.get(r.worker_id) ?? "—" : "—",
      by_name: r.started_by
        ? names.get(r.started_by) ?? byName.get(r.started_by) ?? "—"
        : "—",
      started_at: r.started_at,
    }));
  }

  const fleet = buildFleet(vehicles);
  const todayOps = buildTodayOps(todayEntries);
  // Live status counts come from the global active-shift set, NOT today's
  // window: a shift left open overnight is still "in field" right now.
  //   "Sahadaki şoför" = every open shift (drivers on break are still in field)
  //   "Molada"         = open shifts whose break_started_at is set
  // (so driversInField >= onBreak always holds).
  todayOps.driversInField = activeShifts.length;
  todayOps.onBreak = activeShifts.filter((s) => s.break_started_at).length;
  // "Vehicles delivering" is the live fleet count, not derived from shifts.
  todayOps.vehiclesDelivering = fleet.counts.sevkiyatta;

  // Arıza satırlarına plaka iliştirilir; plakası bulunamayan (silinmiş araç)
  // satır düşürülür — "—" plakalı hayalet satır göstermeyiz.
  const dtc = attachPlatesToDtc(dtcRows, vehicles);

  return {
    todayOps,
    fleet,
    dtc,
    roster: buildTodayRoster(
      workerRows,
      vehicles,
      todayEntries,
      positions,
      leaveWorkerIds,
      driverScope
    ),
    attention: buildAttention(
      rangeEntries,
      todayEntries,
      vehicles,
      names,
      todayStart,
      unpaidPenalties,
      licenses,
      positions,
      openVehicleIds,
      inactiveWorkerIds,
      terminatedAtByWorker,
      locationUnverified,
      startEstimated,
      vehicleIdle,
      manualStarts
    ),
    openVehicleCount: openVehicleIds.size,
    // BUGÜNKÜ ham vardiya satırları. /admin "Kapanmamış Vardiyalar" kartı açık
    // vardiyanın gün tavanını hesaplarken şoförün bugün ZATEN kapattığı süreyi
    // eklemek zorunda (şoför-gün ekseni, 14.08.2026) ve bunun için ikinci bir
    // sorgu açmak aynı pencereyi iki kez okumak olurdu.
    todayEntries,
  };
}

/**
 * Bu hızın üstü "hareket" sayılır (GPS jitter'ı elemek için) — auto-shift
 * motorundaki MOVE_SPEED_KMH ile aynı eşik, bilinçli olarak aynı sayı.
 */
const IDLE_MOVE_SPEED_KMH = 5;
/** Odometrenin bu kadar artması "araç yol yaptı" demektir (yuvarlama payı). */
const IDLE_MIN_ODOMETER_DELTA_KM = 1;

/** O vardiyada paket girilmiş mi (şoförün araçta olduğunun en sağlam kanıtı). */
async function shiftHasPackages(timeEntryId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("shift_packages")
      .select("id")
      .eq("time_entry_id", timeEntryId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Verilen andan bu yana araçtan HAREKET kanıtı var mı?
 *
 *   true  → kontak açılmış / hız > 5 km/h / odometre ≥1 km artmış
 *   false → telemetri VAR ama üçü de yok (araç gerçekten kıpırdamamış)
 *   null  → bilinmiyor: hiç fix yok (cihaz sessiz) ya da sorgu hata verdi
 *
 * null ile false'ın ayrılması kritik: "cihaz susuyor" ile "araç durdu" aynı şey
 * değildir ve YALNIZ ikincisi uyarı üretir (fail-quiet).
 *
 * Satır çekmez, VARLIK sorar (.limit(1)) — bu yüzden PostgREST'in 1000 satır
 * tavanına takılmaz; yoğun bir araçta 10 saatlik pencere 1000 fix'i aşıyor.
 */
async function vehicleMovedSince(
  vehicleId: string,
  sinceIso: string
): Promise<boolean | null> {
  try {
    // ①+② Kontak açık ya da hız eşiğin üstünde tek bir fix yeterli.
    const { data: moving, error: movErr } = await supabaseAdmin
      .from("device_telemetry")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", sinceIso)
      .or(`ignition_on.is.true,speed_kmh.gt.${IDLE_MOVE_SPEED_KMH}`)
      .limit(1);
    if (movErr) return null;
    if ((moving ?? []).length > 0) return true;

    // Hareket yok — peki cihaz konuşuyor mu? Hiç fix yoksa "araç durdu"
    // DEMEYİZ (cihaz ölü olabilir), bilinmiyor deriz.
    const { data: any_, error: anyErr } = await supabaseAdmin
      .from("device_telemetry")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", sinceIso)
      .limit(1);
    if (anyErr) return null;
    if ((any_ ?? []).length === 0) return null;

    // ③ Odometre artışı. Kolon yoksa/boşsa bu kanıt sessizce atlanır.
    const odoQuery = (ascending: boolean) =>
      supabaseAdmin
        .from("device_telemetry")
        .select("odometer_km")
        .eq("vehicle_id", vehicleId)
        .gte("recorded_at", sinceIso)
        .not("odometer_km", "is", null)
        .order("recorded_at", { ascending })
        .limit(1)
        .maybeSingle();
    const [first, last] = await Promise.all([odoQuery(true), odoQuery(false)]);
    const a = first.data?.odometer_km as number | null | undefined;
    const b = last.data?.odometer_km as number | null | undefined;
    if (a != null && b != null && b - a >= IDLE_MIN_ODOMETER_DELTA_KM) return true;

    return false;
  } catch {
    return null;
  }
}

function buildTodayOps(entries: LiteEntry[]): TodayOps {
  let overLimit = 0;
  let needsBreak45 = 0;
  let km = 0;
  let hasKm = false;
  let loaded = 0;
  let hasLoaded = false;
  let delivered = 0;
  let hasDelivered = false;
  let undelivered = 0;
  let hasUndelivered = false;

  for (const e of entries) {
    const w = workedMs(e);
    // Tavan gece çalışmasında 10 saate iner (§ 14 Abs. 2).
    if (w > dailyCapMs(touchesNightWindow(e.started_at, e.ended_at))) overLimit++;
    // 45 dk mola gerektiren ama molası eksik kalan vardiyalar.
    if (w > BREAK45_THRESHOLD_MS && (e.break_minutes ?? 0) < requiredBreakMin(w)) {
      needsBreak45++;
    }
    const d = kmDiff(e);
    if (d !== null) {
      km += d;
      hasKm = true;
    }
    // Yüklenen (loaded at start of day) — always the start_package_count.
    if (e.start_package_count !== null) {
      loaded += e.start_package_count;
      hasLoaded = true;
    }
    // Teslim edilen (actually delivered) — cargo_count is only the real
    // delivered figure once the shift has ENDED. On an active shift cargo_count
    // still holds the start-of-day placeholder, so it must NOT be counted here.
    if (e.ended_at !== null && e.cargo_count !== null) {
      delivered += e.cargo_count;
      hasDelivered = true;
    }
    if (e.undelivered_count !== null) {
      undelivered += e.undelivered_count;
      hasUndelivered = true;
    }
  }

  return {
    // driversInField / onBreak / vehiclesDelivering are the live status counts
    // and are filled in by getDashboardData from the global active-shift set.
    driversInField: 0,
    vehiclesDelivering: 0,
    onBreak: 0,
    totalKmToday: hasKm ? km : null,
    loaded: hasLoaded ? loaded : null,
    delivered: hasDelivered ? delivered : null,
    undelivered: hasUndelivered ? undelivered : null,
    overLimit,
    needsBreak45,
    shiftsToday: entries.length,
  };
}

/** Per-driver / per-vehicle breakdown for the click-to-expand tile dialogs.
 *  Derived from the same data as buildTodayOps — purely read-only. */
/**
 * Arıza satırlarına plaka iliştirir; plakası bulunamayan (silinmiş araç) satır
 * düşürülür — "—" plakalı hayalet satır göstermeyiz.
 */
function attachPlatesToDtc(
  dtcRows: {
    vehicle_id: string;
    count: number;
    oldest?: { code: string; first_seen: string } | null;
    codes?: { code: string; first_seen: string }[];
  }[],
  vehicles: { id: string; plate: string }[]
): FleetDtcRow[] {
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  return dtcRows.flatMap((d) => {
    const plate = plateById.get(d.vehicle_id);
    if (!plate) return [];
    return [
      {
        vehicle_id: d.vehicle_id,
        plate,
        count: d.count,
        oldest_code: d.oldest?.code ?? null,
        oldest_since: d.oldest?.first_seen ?? null,
        codes: d.codes ?? [],
      },
    ];
  });
}

/**
 * Filo arıza (DTC) özeti — ARAÇLAR sayfası için tek başına çağrılır.
 * 22.07.2026'da bu kart yönetici panosundan Araçlar'a taşındı: arıza aracın
 * özelliğidir, günün operasyon panosunun konusu değil.
 */
export async function getFleetDtc(): Promise<FleetDtcRow[]> {
  const [dtcRows, vehicles] = await Promise.all([
    listFleetActiveDtc(),
    listVehiclesWithStatus(),
  ]);
  return attachPlatesToDtc(dtcRows, vehicles);
}

/**
 * GÜNÜN PANOSU satırlarını kurar (bkz. TodayRosterRow).
 *
 * Sıralama bilinçli: AÇMADI → SAHADA/MOLADA → KAPANDI. Sabah 07:00'de yöneticinin
 * gözü ilk "açmadı" satırına düşmeli, çünkü tek eylem gerektiren satır odur.
 * Grup içinde: açmayanlar isme göre (hepsi eşdeğer), sahadakiler ve kapananlar
 * giriş saatine göre (erken çıkan üstte — gün akışını okumak kolaylaşsın).
 *
 * Yeni sorgu YOK: dört girdi de getDashboardData'nın zaten çektiği veriler.
 */
function buildTodayRoster(
  workerRows: (Pick<Worker, "id" | "name"> & {
    is_active?: boolean | null;
    is_admin?: boolean | null;
  })[],
  vehicles: {
    id: string;
    plate: string;
    status: string;
    assigned_worker_id: string | null;
    /** vehicles.model — select("*") zaten taşıyor, satıra 10.08'de eklendi. */
    model?: string | null;
  }[],
  todayEntries: LiteEntry[],
  positions: { vehicle_id: string; recorded_at: string }[],
  /** ONAYLI izni bugünü kapsayan şoförler → "İzinli" durumu (Modül 1). */
  leaveWorkerIds: Set<string>,
  /**
   * ŞOFÖR kapsamı (lib/driver-scope.ts). workerRows BİLEREK geniş gelir —
   * aynı dizi `names` isim sözlüğünü de besliyor ve orada yönetici adı
   * gerekebilir (şoförsüz araç kalemi, vardiya satırı). Daraltma bu yüzden
   * sorguda değil, YALNIZ roster kurulurken yapılır.
   */
  driverScope: DriverScope
): TodayRosterRow[] {
  const nowMs = Date.now();

  // Şoför → atanmış araç. Tek kaynak vehicles.assigned_worker_id.
  const vehicleByWorker = new Map<string, (typeof vehicles)[number]>();
  for (const v of vehicles) {
    if (v.assigned_worker_id && !vehicleByWorker.has(v.assigned_worker_id)) {
      vehicleByWorker.set(v.assigned_worker_id, v);
    }
  }

  const lastSeen = new Map(positions.map((p) => [p.vehicle_id, p.recorded_at]));

  // Şoförün BUGÜNKÜ vardiyası. Birden çok satır varsa (eski veri) açık olan,
  // yoksa en geç başlayan alınır — panoda "şu anki durum" gösterilir.
  const entryByWorker = new Map<string, LiteEntry>();
  for (const e of todayEntries) {
    if (!e.worker_id) continue;
    const cur = entryByWorker.get(e.worker_id);
    if (!cur) {
      entryByWorker.set(e.worker_id, e);
      continue;
    }
    const curOpen = cur.ended_at === null;
    const newOpen = e.ended_at === null;
    if (newOpen && !curOpen) entryByWorker.set(e.worker_id, e);
    else if (newOpen === curOpen && e.started_at > cur.started_at) {
      entryByWorker.set(e.worker_id, e);
    }
  }

  const rows: TodayRosterRow[] = [];
  for (const w of workerRows) {
    // Yönetici/test hesapları ve ayrılmış personel panoda yer almaz.
    // driver-scoped: eleme TEK KAYNAKTAN (lib/driver-scope.ts) — buradaki
    // eski `w.is_admin === true` kontrolü kaldırıldı, aksi hâlde aynı kural
    // iki yerde yaşar ve zamanla ayrışır (Analiz'de unutulmuştu, bu yüzden
    // "ŞOFÖR 33" gösteriyordu). is_active AYRI kalır: o "çalışıyor mu"
    // sorusudur, "şoför mü" sorusu değil.
    if (!driverScope.isDriver(w.id)) continue;
    if (w.is_active === false) continue;

    const veh = vehicleByWorker.get(w.id) ?? null;
    const entry = entryByWorker.get(w.id) ?? null;

    let status: RosterStatus = "not_started";
    if (entry) {
      if (entry.ended_at !== null) status = "closed";
      else if (entry.break_started_at) status = "on_break";
      else status = "in_field";
    } else if (leaveWorkerIds.has(w.id)) {
      // İzin YALNIZ "vardiya açmadı"yı bastırır; vardiya AÇMIŞ izinli
      // (izinliyken çalışan) gerçek durumuyla görünür, maskelenmez.
      status = "on_leave";
    }

    // Telemetri yaşı ATANMIŞ araçtan okunur: "şoförün aracından veri geliyor mu"
    // sorusu, vardiya açılmamış olsa da geçerlidir (sabah kör araç fark edilsin).
    const seen = veh ? lastSeen.get(veh.id) : undefined;
    const ageMs = seen ? Math.max(0, nowMs - new Date(seen).getTime()) : null;

    const usedPlate =
      entry?.plate && veh?.plate && entry.plate !== veh.plate ? entry.plate : null;

    // Aynı araçta bugün başka şoförün de vardiyası var mı?
    const usedVehicleId = entry?.vehicle_id ?? veh?.id ?? null;
    const sharedVehicle =
      !!usedVehicleId &&
      todayEntries.some(
        (e) => e.vehicle_id === usedVehicleId && e.worker_id !== w.id
      );

    rows.push({
      workerId: w.id,
      name: w.name,
      entryId: entry?.id ?? null,
      plate: veh?.plate ?? null,
      vehicleStatus: (veh?.status as string) ?? null,
      usedPlate,
      sharedVehicle,
      status,
      startedAt: entry?.started_at ?? null,
      endedAt: entry?.ended_at ?? null,
      loadedPackages: entry?.start_package_count ?? null,
      telemetryAgeMs: ageMs,
      telemetryStale: ageMs !== null && ageMs >= TELEMETRY_SILENT_HOURS * 3_600_000,
      model: veh?.model ?? null,
    });
  }

  const rank: Record<RosterStatus, number> = {
    not_started: 0,
    in_field: 1,
    on_break: 1, // molada = sahada sayılır, ayrı grup açmaz
    closed: 2,
    on_leave: 3, // izinli = en altta, nötr (eylem gerektirmez)
  };
  rows.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    if (a.status === "not_started") return a.name.localeCompare(b.name);
    const at = a.startedAt ?? "";
    const bt = b.startedAt ?? "";
    return at.localeCompare(bt) || a.name.localeCompare(b.name);
  });
  return rows;
}

function buildFleet(vehicles: { live_status: VehicleLiveStatus }[]): FleetStatus {
  const counts: Record<VehicleLiveStatus, number> = {
    sevkiyatta: 0,
    molada: 0,
    bosta: 0,
    bakimda: 0,
  };
  for (const v of vehicles) counts[v.live_status]++;
  return { total: vehicles.length, counts };
}

function buildAttention(
  rangeEntries: LiteEntry[],
  todayEntries: LiteEntry[],
  vehicles: {
    id: string;
    plate: string;
    status: string;
    assigned_worker_id: string | null;
    inspection_due: string | null;
    insurance_due: string | null;
  }[],
  names: Map<string, string>,
  todayStart: Date,
  unpaidPenalties: {
    vehicle_id: string;
    amount: number | null;
    penalty_date: string | null;
  }[],
  licenses: { id: string; name: string; license_expiry: string }[],
  positions: {
    vehicle_id: string;
    recorded_at: string;
    ignition_on?: boolean | null;
    speed_kmh?: number | null;
  }[],
  /** Şu an AÇIK vardiyası olan araç id'leri (movingNoShift için). */
  openVehicleIds: Set<string>,
  /** İşten ayrılan/pasif personel id'leri → "şoförsüz araç" (Modül 2). */
  inactiveWorkerIds: Set<string>,
  /** Ayrılan şoför → son çalışma günü (best-effort; kolon yoksa boş harita). */
  terminatedAtByWorker: Map<string, string | null>,
  /** Bugün ARAÇTAN SİNYAL ALINAMADAN açılmış vardiyalar (Modül 6). */
  locationUnverified: { id: string; worker_name: string; started_at: string }[],
  /** Bugün başlangıç anı KESTİRİMLE yazılmış vardiyalar (038). */
  startEstimated: { id: string; worker_name: string; started_at: string }[],
  /** ≥3h açık auto vardiya, araçtan hiç hareket yok (Modül 7). */
  vehicleIdle: { id: string; worker_name: string; started_at: string }[],
  /** Filo şefinin bugün elle başlattığı vardiyalar (037) — panel bildirimi. */
  manualStarts: {
    id: string;
    worker_name: string;
    by_name: string;
    started_at: string;
  }[]
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1) AZG çalışma süresi — İKİ AYRI kalem (22.07.2026):
  //      • overLimit → günlük tavan aşıldı (§ 9 Abs. 1: 12 sa; gece çalışması
  //        varsa § 14 Abs. 2: 10 sa). GERÇEK İHLAL.
  //      • break45   → 9 saati aştı ve molası 45 dakikanın altında kaldı
  //        (§ 13c Abs. 1). İhlal değil, mola uyarısı.
  //    Eskiden tek bir "9 saati aştı" kalemi vardı ve 9 saat ihlal gibi
  //    görünüyordu; 20 şoför kırmızıya düşüyordu.
  //
  //    Kapsam aynı: bugün başlayan vardiyalar + hâlâ AÇIK olan her vardiya
  //    (gece boyu unutulmuş olabilir). Tüm aralık taranmaz, yoksa "ay"
  //    seçilince liste geçmiş aşımlarla dolar. Kayıt id'siyle tekilleştirilir.
  const azgEntries = new Map<string, LiteEntry>();
  for (const e of todayEntries) azgEntries.set(e.id, e);
  for (const e of rangeEntries) if (e.ended_at === null) azgEntries.set(e.id, e);

  // ŞOFÖR-GÜN EKSENİ (14.08.2026, lib/azg-rules.ts workerDayBuckets). § 9 Abs. 1
  // tavanı GÜNE aittir. Eskiden burada tavan SATIR başına uygulanıyordu: aynı
  // gün 8 sa + 6 sa çalışan şoför Dikkat listesinde HİÇ çıkmazken AZG PDF'i
  // (azg-report.ts:288-297) o günü ihlal sayıyordu — panel ile yasal belge aynı
  // soruya iki cevap veriyordu. Kalem GÜN başına tekilleştirilir; günün en geç
  // başlayan vardiyası kalemi taşır (listede "en son ne oldu" okunur).
  const azgList = [...azgEntries.values()];
  const buckets = workerDayBuckets(azgList);
  const entryById = new Map(azgList.map((e) => [e.id, e]));

  for (const acc of buckets.values()) {
    // Kalemi taşıyan satır: günün EN GEÇ başlayanı.
    const last = acc.ids
      .map((id) => entryById.get(id)!)
      .reduce((a, b) => (b.started_at > a.started_at ? b : a));
    const cap = dailyCapMs(acc.night);
    const workerName = last.worker_id ? names.get(last.worker_id) ?? "—" : "—";

    if (acc.ms > cap) {
      items.push({
        kind: "overLimit",
        id: last.id,
        worker_name: workerName,
        ms: acc.ms,
        capMs: cap,
        night: acc.night,
        started_at: last.started_at,
      });
      // Tavanı aşan gün zaten en ağır kalem; mola uyarısını üstüne eklemek
      // aynı günü listede iki kez gösterirdi.
      continue;
    }

    // MOLA § 13c Abs. 1 — kademe gün toplamından, mola dakikaları gün
    // toplamından. Tek vardiyalı günde eski davranışın birebir aynısı.
    const needBreak = requiredBreakMin(acc.ms);
    const breakMin = acc.ids.reduce(
      (s, id) => s + (entryById.get(id)!.break_minutes ?? 0),
      0
    );
    if (acc.ms > BREAK45_THRESHOLD_MS && breakMin < needBreak) {
      items.push({
        kind: "break45",
        id: last.id,
        worker_name: workerName,
        ms: acc.ms,
        breakMin,
        requiredMin: needBreak,
        started_at: last.started_at,
      });
    }
  }

  // ── İKİNCİ VARDİYA (14.08.2026) ────────────────────────────────────────────
  // YALNIZ BUGÜN penceresinden türer: rangeEntries'ten türeseydi "ay" seçilince
  // liste geçmiş günlerin ikinci vardiyalarıyla dolardı (aynı tuzak overLimit'te
  // 23.07'de yaşanmıştı). Kilit AÇIK OLMAYAN kiracıda (SHIFT_PER_DAY='one')
  // bu kova zaten hiç dolmaz — kalem kendiliğinden görünmez, bayrak okumaya
  // gerek yok.
  const todayBuckets = workerDayBuckets(todayEntries);
  const todayById = new Map(todayEntries.map((e) => [e.id, e]));
  for (const acc of todayBuckets.values()) {
    if (acc.ids.length < 2) continue;
    const last = acc.ids
      .map((id) => todayById.get(id)!)
      .reduce((a, b) => (b.started_at > a.started_at ? b : a));
    items.push({
      kind: "secondShift",
      id: last.id,
      worker_name: last.worker_id ? names.get(last.worker_id) ?? "—" : "—",
      count: acc.ids.length,
      totalMs: acc.ms,
      started_at: last.started_at,
    });
  }

  // 2) Vehicle documents due soon or overdue (§57a inspection + insurance).
  //    Window is bounded on BOTH sides: a document that expired more than
  //    DOC_DUE_WINDOW_DAYS ago drops off the list instead of sitting at the top
  //    forever (otherwise an old, unmaintained record keeps the panel red).
  const dayMs = 24 * 60 * 60 * 1000;
  const today = todayStart.getTime();
  for (const v of vehicles) {
    for (const kind of ["inspection", "insurance"] as const) {
      const due = kind === "inspection" ? v.inspection_due : v.insurance_due;
      if (!due) continue;
      const days = Math.round((new Date(due).getTime() - today) / dayMs);
      if (days >= -DOC_DUE_WINDOW_DAYS && days <= DOC_DUE_WINDOW_DAYS) {
        items.push({ kind, id: `${v.id}-${kind}`, plate: v.plate, due, days });
      }
    }
  }

  // 3) Shifts with a high undelivered-package count.
  for (const e of rangeEntries) {
    if ((e.undelivered_count ?? 0) >= UNDELIVERED_THRESHOLD) {
      items.push({
        kind: "undelivered",
        id: `${e.id}-undelivered`,
        entry_id: e.id,
        worker_name: e.worker_id ? names.get(e.worker_id) ?? "—" : "—",
        count: e.undelivered_count ?? 0,
        date: e.started_at,
      });
    }
  }

  // 4) Unpaid vehicle penalties (Strafe), aggregated per vehicle.
  const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
  const penByVehicle = new Map<
    string,
    { count: number; amount: number; hasAmount: boolean; latest: string | null }
  >();
  for (const p of unpaidPenalties) {
    const acc =
      penByVehicle.get(p.vehicle_id) ??
      { count: 0, amount: 0, hasAmount: false, latest: null };
    acc.count += 1;
    if (p.amount !== null) {
      acc.amount += p.amount;
      acc.hasAmount = true;
    }
    // Toplanan kalemin anı = EN YENİ ödenmemiş cezanın tarihi (date kolonu,
    // sözlük sırası = kronolojik sıra).
    if (p.penalty_date && (acc.latest === null || p.penalty_date > acc.latest)) {
      acc.latest = p.penalty_date;
    }
    penByVehicle.set(p.vehicle_id, acc);
  }
  for (const [vehicleId, acc] of penByVehicle) {
    items.push({
      kind: "penalty",
      id: `${vehicleId}-penalty`,
      plate: plateById.get(vehicleId) ?? "—",
      count: acc.count,
      amount: acc.hasAmount ? acc.amount : null,
      latest_date: acc.latest,
    });
  }

  // 5) Ehliyeti dolmuş / dolmak üzere olan şoförler (workers.license_expiry).
  //    Araç belgelerinden BİLİNÇLİ farkı: dolmuş ehliyetin alt sınırı yoktur.
  //    Muayene kaydı eskidiğinde listeden düşer (bakımsız kayıt panoyu sürekli
  //    kırmızı tutmasın diye), ama dolmuş ehliyet yasal olarak direksiyona
  //    geçilemez demektir — düzeltilene kadar listede kalmalı.
  for (const w of licenses) {
    const t = new Date(w.license_expiry).getTime();
    if (!Number.isFinite(t)) continue; // bozuk tarih → uyarı uydurma
    const days = Math.round((t - today) / dayMs);
    if (days > LICENSE_DUE_WINDOW_DAYS) continue;
    items.push({
      kind: "license",
      id: `${w.id}-license`,
      worker_name: w.name,
      due: w.license_expiry,
      days,
    });
  }

  // 6) Cihazlı ama uzun süredir hiç telemetri göndermeyen AKTİF araçlar.
  //    Hiç veri göndermemiş araç burada yoktur (listLatestVehiclePositions onu
  //    zaten döndürmez) — "cihaz hiç kurulmamış" ile "cihaz sustu" ayrı şeyler,
  //    ikincisini uydurmayız.
  // Aracın kendisi tutulur (yalnız plaka değil): "atamasız araç sahada" kalemi
  // assigned_worker_id'ye de bakar.
  const activeVehicle = new Map(
    vehicles.filter((v) => v.status !== "inactive").map((v) => [v.id, v])
  );
  const activePlate = new Map(
    [...activeVehicle].map(([id, v]) => [id, v.plate] as const)
  );
  const nowMs = Date.now();
  for (const p of positions) {
    const plate = activePlate.get(p.vehicle_id);
    if (!plate) continue;
    const hours = Math.floor((nowMs - new Date(p.recorded_at).getTime()) / 3_600_000);
    if (hours < TELEMETRY_SILENT_HOURS) continue;
    items.push({
      kind: "silent",
      id: `${p.vehicle_id}-silent`,
      plate,
      hours,
      at: p.recorded_at,
    });
  }

  // 7) Araç ŞU AN kontak açık + taze telemetri ama o araçta AÇIK vardiya YOK.
  //    Kritik güvenlik ağı (Modül 1): izinli/ayrılan şoförün aracını başkası
  //    kullanınca auto-shift bilinçli olarak vardiya AÇMAZ (yanlış isme
  //    yazmamak için) — bu boşluk yöneticiye görünmeli ki gerçek sürücü kendi
  //    adına vardiya başlatsın. Bayat fix "sürüyor" sayılmaz (MOVING_FRESH_MS).
  //
  //    7b) ATAMASIZ ARAÇ SAHADA (27.07.2026): aynı tarama, ama aracın hiç
  //    atanmış şoförü yoksa kalem "atamasız araç" olarak çıkar — eylem farklı
  //    (vardiya başlatmak değil, ŞOFÖR ATAMAK). Aynı araç için iki uyarı
  //    basmamak adına movingNoShift'in YERİNE geçer. Kör noktaydı: `driverless`
  //    yalnız "atanmış şoför işten ayrıldı" hâlini yakalıyor, alanın hiç
  //    doldurulmadığı aracı hiçbir kalem görmüyordu (27.07: DO-671GY bütün gün
  //    yol yaptı, depoya girdi, panoda hiç görünmedi).
  for (const p of positions) {
    if (openVehicleIds.has(p.vehicle_id)) continue; // açık vardiya var → sorun yok
    const v = activeVehicle.get(p.vehicle_id);
    if (!v) continue; // pasif/silinmiş/cihazsız araç
    if (p.ignition_on !== true) continue; // kontak kapalı → hareket yok
    if (nowMs - new Date(p.recorded_at).getTime() > MOVING_FRESH_MS) continue;
    items.push(
      v.assigned_worker_id === null
        ? {
            kind: "unassignedMoving",
            id: `${p.vehicle_id}-unassigned`,
            plate: v.plate,
            at: p.recorded_at,
          }
        : {
            kind: "movingNoShift",
            id: `${p.vehicle_id}-moving`,
            plate: v.plate,
            at: p.recorded_at,
          }
    );
  }

  // 8) AKTİF aracın atanmış şoförü İŞTEN AYRILDI → araç şoförsüz (Modül 2).
  //    assigned_worker_id bilinçli boşaltılmadığı için bu kalem patronu yeniden
  //    atamaya iter. Pasif araç (status inactive) kapsam dışı.
  for (const v of vehicles) {
    if (v.status === "inactive") continue;
    const wid = v.assigned_worker_id;
    if (!wid || !inactiveWorkerIds.has(wid)) continue;
    items.push({
      kind: "driverless",
      id: `${v.id}-driverless`,
      plate: v.plate,
      worker_name: names.get(wid) ?? "—",
      terminated_at: terminatedAtByWorker.get(wid) ?? null,
    });
  }

  // 9) Araçtan sinyal alınamadan başlatılmış bugünkü vardiyalar (Modül 6) —
  //    cihaz sessiz/ölü ya da muafiyetle açılmış, konum gerçekten bilinmiyor.
  for (const u of locationUnverified) {
    items.push({
      kind: "locationUnverified",
      id: `${u.id}-unverloc`,
      worker_name: u.worker_name,
      started_at: u.started_at,
    });
  }

  // 9b) Başlangıç anı kestirim olan bugünkü vardiyalar (038) — araç depodaydı,
  //     yalnız saat depo girişinden türetilemedi. Ayrı kalem, ayrı eylem.
  for (const s of startEstimated) {
    items.push({
      kind: "startEstimated",
      id: `${s.id}-eststart`,
      worker_name: s.worker_name,
      started_at: s.started_at,
    });
  }

  // 9c) KM ÖLÇÜLEMEYEN BUGÜNKÜ VARDİYALAR (15.08.2026).
  //
  //     Vardiya başladığından beri araçtan TEK bir telemetri satırı bile
  //     gelmemişse o vardiyanın km'si ölçülemez. Eskiden bu durum sessizdi:
  //     cihaz sustuğunda aynı bayat odometre hem start_km hem end_km'e
  //     yazılıyor, fark tam 0 çıkıyor ve rapor "0 km" diyordu — uydurma bir
  //     sayı, "ölçülemedi" değil. Canlıda ölçüldü (60 gün): 28 vardiya böyle.
  //
  //     `silent` kaleminden farkı EKSEN: o kalem ARACI (24 saattir sessiz)
  //     bildirir, bu kalem VARDİYAYI (bugün o araçla çalışan kişinin km'si
  //     kayıp) bildirir. Aynı araç ikisine birden düşebilir; eylem farklı —
  //     biri cihazı tamir ettirmek, diğeri o günün km'sini elle düzeltmek.
  {
    const lastSeenAt = new Map(positions.map((p) => [p.vehicle_id, p.recorded_at]));
    for (const e of todayEntries) {
      if (!e.vehicle_id) continue;
      const seen = lastSeenAt.get(e.vehicle_id) ?? null;
      // Son fix vardiya başlangıcından ÖNCEYSE pencere içinde hiç satır yoktur.
      if (seen !== null && new Date(seen).getTime() >= new Date(e.started_at).getTime()) {
        continue;
      }
      items.push({
        kind: "kmUnmeasured",
        id: `${e.id}-kmunmeasured`,
        worker_name: e.worker_id ? names.get(e.worker_id) ?? "—" : "—",
        plate: e.plate ?? plateById.get(e.vehicle_id) ?? "—",
        last_seen: seen,
        hours:
          seen === null
            ? null
            : Math.floor((Date.now() - new Date(seen).getTime()) / 3_600_000),
      });
    }
  }

  // 10) Hareketsiz araç (Modül 7) — auto vardiya açık ama araç hiç kıpırdamamış.
  for (const c of vehicleIdle) {
    items.push({
      kind: "vehicleIdle",
      id: `${c.id}-idle`,
      worker_name: c.worker_name,
      started_at: c.started_at,
    });
  }

  // 11) Filo şefi manuel başlatması (037) — şef bir personelin mesaisini elle
  //     başlattı. Panelde "bildirim" olarak burada görünür (push yok, karar).
  for (const m of manualStarts) {
    items.push({
      kind: "manualStart",
      id: `${m.id}-manualstart`,
      worker_name: m.worker_name,
      by_name: m.by_name,
      started_at: m.started_at,
    });
  }

  // Most urgent first: overdue/soonest docs, then biggest overruns/backlogs.
  const weight = (i: AttentionItem): number => {
    switch (i.kind) {
      case "license":
        // Ehliyet ve araç belgeleri aynı skalada yarışır (gün cinsinden), ama
        // eşitlikte ehliyet öne geçer: şoför direksiyona geçemez > araç belgesi.
        return i.days - 0.5;
      case "inspection":
      case "insurance":
        return i.days; // overdue (negative) and soonest first
      case "silent":
        return 50 - i.hours / 24; // belgelerden sonra; en uzun sessizlik önce
      case "movingNoShift":
        return 90; // kayıt dışı sürüş uyarısı — cezayla aynı bantta, gold
      case "unassignedMoving":
        return 92; // atamasız araç sahada — kayıt dışı sürüşün hemen ardında
      case "driverless":
        return 95; // şoförsüz araç (atama bekliyor) — movingNoShift'ten hemen sonra
      case "locationUnverified":
        return 85; // araçtan sinyal yok — gerçek doğrulanamama, gold
      case "startEstimated":
        return 86; // saat tahmini — sinyalsizin hemen ardında, daha düşük aciliyet
      case "kmUnmeasured":
        // locationUnverified (85) ile aynı aileden: ikisi de "bu vardiyada
        // cihazdan veri yok" diyor. Hemen ardına konur ki yönetici ikisini
        // birlikte görsün — aynı aracın iki belirtisi olabilir.
        return 85.5;
      case "vehicleIdle":
        return 80; // auto vardiya + araç hiç hareket etmemiş — orta öncelik
      case "manualStart":
        return 78; // şef manuel başlattı — bilgi bildirimi, vehicleIdle'ın hemen ardında
      case "secondShift":
        // İHLAL DEĞİL, bilgi bildirimi: 'many' kiracısında günün ikinci
        // vardiyası normaldir. manualStart ile aynı bantta — ikisi de "bugün
        // olağandışı bir şey oldu, haberin olsun" diyor.
        return 77;
      case "penalty":
        return 100 - i.count; // unpaid fines: after overdue docs, before overruns
      case "overLimit":
        return 1000 - i.ms / 3_600_000; // yasal tavan aşımı — en uzunu önce
      case "break45":
        // Mola uyarısı ihlal DEĞİL: tavan aşımlarının ve teslim edilemeyen
        // paketlerin arasında, ihlallerin ARKASINDA sıralanır.
        return 1500 - i.ms / 3_600_000
      case "undelivered":
        return 2000 - i.count; // biggest backlog first
    }
  };
  return items.sort((a, b) => weight(a) - weight(b));
}
