import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { latestTelemetryBatch, latestVehicleTelemetry, listVehicleTrack } from "@/lib/telemetry";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { MAX_ODOMETER, MAX_PER_SHIFT_KM } from "@/lib/validation";
import { startOfTodayVienna } from "@/lib/format";
import { workersWithShiftToday } from "@/lib/shift-day";
import { approvedLeaveWorkerIdsForDay } from "@/lib/leaves";
import { activeDepotZones, depotArrivalTrigger, lastFixInDepot } from "@/lib/depot";
import {
  SHIFT_START_TRIGGER,
  SHIFT_AUTO_END,
  SHIFT_AUTO_END_IDLE_MIN,
  SHIFT_AUTO_END_MIDNIGHT_FALLBACK,
} from "@/lib/tenant";

/**
 * Otomatik vardiya motoru (Şoför Paneli v2 — İş 1).
 *
 * Araç telemetrisi (device_telemetry.ignition_on) üzerinden:
 *  - BAŞLAT: tetikleyici MÜŞTERİ AYARI (31.07.2026, SHIFT_START_TRIGGER):
 *    'depot_entry' (HAK61 varsayılanı — depoya giriş) ya da 'first_ignition'
 *    (günün ilk kontak açılışı; geceyi depoda geçiren filo için).
 *    Tarihsel not (24.07.2026): kontak-tetikli açma kaldırılmıştı — her kontak
 *    açılışı yeni vardiya ekliyordu. 'first_ignition' o hata DEĞİLDİR: günün
 *    İLK açılışını alır ve "günde tek vardiya" kilidi (lib/shift-day.ts)
 *    ikincisini zaten engeller.
 *  - BİTİR: MÜŞTERİ AYARI (31.07.2026, SHIFT_AUTO_END). HAK61'de KAPALI
 *    ('off' varsayılanı): vardiyayı yalnızca personel kapatır. 22.07.2026'da
 *    kaldırılmıştı çünkü eşik, depoda yükleme yapan şoförü ölü sayıp vardiyayı
 *    9 dakikada kapatıyordu — 24 şoförün 20'si kilitlendi.
 *    Şoför paneli olmayan müşteride 'depot_idle' ile açılır ve o hatanın
 *    tekrarı DEPO ŞARTIyla önlenir: kapanış için hareketsizlik yetmez, aracın
 *    depoya dönmüş olması da gerekir. Gün içindeki teslimat durakları
 *    (kontak kapalı, araç depo dışında) vardiyayı kapatmaz.
 *
 * /api/flespi/sync (her ~30-60 sn, harici cron) ve /api/flespi/ingest
 * (stream push) çağırır. Eşzamanlı çalışmaya dayanıklıdır: açık vardiya
 * tekilliği migration 020'deki uq_time_entries_one_open partial unique
 * index'iyle, kapanış ise .is("ended_at", null) guard'ıyla korunur.
 *
 * Telefon GPS hattına (driver_locations) hiç dokunmaz: o hat 21.07.2026'da
 * tamamen kaldırıldı, tablo yalnız geçmiş veri olarak duruyor.
 */

const DEFAULT_IDLE_END_MINUTES = 30;

/**
 * OTOMATİK KAPANIŞ ANA ŞALTERİ — artık MÜŞTERİ AYARI (31.07.2026).
 *
 * HAK61'de KAPALI kalır (SHIFT_AUTO_END varsayılanı 'off'): "vardiyayı yalnızca
 * personel kapatır" kuralı 22.07.2026'da 20 şoförü kilitleyen olaydan sonra
 * kondu ve bu turda DEĞİŞMEDİ — env tanımlı değilken bu sabit bugünkü gibi
 * `false`tur.
 *
 * Şoför paneli olmayan müşteride (Sendigo) 'depot_idle' ile açılır: kapatacak
 * bir insan yoktur, açık kalan vardiya gece boyu büyür. lib/tenant.ts'teki
 * assertTenantConfig() iki ayarın tutarsız bileşimini kurulumda patlatır.
 */
const AUTO_END_ENABLED: boolean = SHIFT_AUTO_END !== "off";

/**
 * Kapanış için aracın DEPODA olması şart mı?
 *
 * 'depot_idle' modunun çekirdeği: gün içindeki teslimat duraklarında kontak
 * defalarca kapanır ve araç dakikalarca hareketsiz kalır — bunlar vardiyayı
 * KAPATMAMALIDIR. Vardiyayı bitiren şey "hareketsizlik" değil, "depoya dönmüş
 * ve hareketsiz"dir. Depo şartı olmasaydı eşik ne kadar büyütülse de uzun bir
 * eczane teslimatı vardiyayı yanlışlıkla kapatabilirdi.
 */
const AUTO_END_REQUIRES_DEPOT: boolean = SHIFT_AUTO_END === "depot_idle";

/**
 * OTOMATİK BAŞLATMA ANA ŞALTERİ — DEPO-KAPILI AÇIK (Volkan, 24.07.2026, Modül 7).
 *
 * Motor artık KONTAKTA değil, aracın DEPOYA GİRİŞİNDE vardiya açar: bugünün ilk
 * "depo-içi + kontak açık" fix'i mesai başlangıcıdır (bkz. depotArrivalTrigger).
 * Evde kontak açılınca AÇMAZ — mesai depoda başlar.
 *
 * Geçmiş: 22.07'de otomatik KAPATMA kaldırılırken başlatma yanlışlıkla kontağa
 * bağlı kalmıştı; her kontak açılışı yeni vardiya ekliyor, mesai evde başlamış
 * görünüyordu (24.07 sabahı 12 vardiyanın 9'u). Kill-switch'le kapatıldı, sonra
 * depo-kapılı geri açıldı.
 *
 * 03.08.2026: sabit `true` yerine MÜŞTERİ AYARI. Kaynak SHIFT_START_TRIGGER'ın
 * kendisidir — ayrı bir bayrak eklenmedi, çünkü "hangi tetik" ile "tetik var mı"
 * aynı sorunun iki yüzü ve iki ayrı env sessizce çelişebilirdi. HAK61'de env
 * tanımlı değil → tetik 'depot_entry' → bu sabit bugünkü gibi `true`.
 * Sendigo'da SHIFT_START_TRIGGER='off': şoför paneli açık, vardiyayı insan açar
 * ve motor hiç başlatmaz — panel ile motorun aynı gün için yarışması imkânsız.
 * Tip açıkça `boolean` — literal daraltması engellensin.
 */
const AUTO_START_ENABLED: boolean = SHIFT_START_TRIGGER !== "off";

/**
 * Kontak kapalı + hareketsizlik eşiği (dk).
 *
 * İki env okunur: yeni ad (SHIFT_AUTO_END_IDLE_MIN, lib/tenant.ts) ÖNCE, eski
 * ad (AUTO_SHIFT_IDLE_END_MINUTES) sonra. Eski ad geriye dönük destekleniyor
 * çünkü HAK61 ortamında tanımlı olabilir ve sessizce anlamını yitirmemeli.
 * İkisi de yoksa 30 — bu dosyadaki bugünkü varsayılanın aynısı.
 */
export function autoEndIdleMinutes(): number {
  const tenant = SHIFT_AUTO_END_IDLE_MIN;
  if (process.env.SHIFT_AUTO_END_IDLE_MIN && tenant >= 5 && tenant <= 720) {
    return tenant;
  }
  const raw = Number(process.env.AUTO_SHIFT_IDLE_END_MINUTES);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 720) return Math.floor(raw);
  return DEFAULT_IDLE_END_MINUTES;
}

/** Bu hızın üstü "hareket" sayılır (GPS jitter'ı elemek için). */
const MOVE_SPEED_KMH = 5;
/**
 * Kontak "açık" görünen ama bu süredir susan cihaz artık "çalışıyor"
 * sayılmaz (Teltonika kontak kapanınca raporlamayı kesebilir/seyreltebilir).
 * metrics-engine-hours'daki MAX_ON_GAP_MS ile aynı mantık.
 */
const SILENT_GRACE_MS = 15 * 60 * 1000;

export type AutoShiftSummary = {
  checked: number;
  started: number;
  ended: number;
  errors: string[];
};

type OpenShift = {
  id: string;
  worker_id: string;
  vehicle_id: string | null;
  started_at: string;
  start_km: number;
  break_minutes: number | null;
  break_started_at: string | null;
  auto_started: boolean;
  confirmation_status: string;
  confirmed_at: string | null;
  plate: string | null;
};

type VehicleRow = {
  id: string;
  plate: string;
  status: string;
  assigned_worker_id: string | null;
  flespi_device_id: number | null;
  imei: string | null;
  /** Depo-tetikli otomatik vardiya bu araçta açık mı (Modül 7). null=açık. */
  auto_start_enabled: boolean | null;
};

/**
 * Cihaz odometresini makul bir km değerine indirger. Bazı kurulumlar metre
 * raporlar ([VARSAYIM] lib/flespi.ts) — MAX_ODOMETER'ı aşan değer önce
 * /1000 denenir; hâlâ makul değilse null (kullanma).
 */
function normalizeOdometerKm(o: number | null | undefined): number | null {
  if (o == null || !Number.isFinite(o) || o <= 0) return null;
  let v = o;
  if (v > MAX_ODOMETER) v = v / 1000;
  v = Math.round(v);
  if (v <= 0 || v > MAX_ODOMETER) return null;
  return v;
}

/** En yeni timestamp'i (ms) döner; hepsi null ise fallback. */
function maxTime(fallbackIso: string, ...isoDates: (string | null | undefined)[]): number {
  let max = new Date(fallbackIso).getTime();
  for (const iso of isoDates) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

/**
 * Tek satırlık "en yeni kayıt" sorgusu; tablo henüz yoksa (migration
 * uygulanmadıysa) ya da sorgu hata verirse null'a düşer — akışı düşürmez.
 */
async function newestTime(
  col: string,
  fn: () => PromiseLike<{ data: Record<string, unknown> | null }>
): Promise<string | null> {
  try {
    const { data } = await fn();
    const v = data?.[col];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * ODOMETRE TAZELİK SINIRI (15.08.2026).
 *
 * `latestVehicleTelemetry` yaş sınırı taşımaz; cihaz aylar önce sussa bile son
 * satırı döndürür. O bayat odometre hem açılışta start_km'e hem kapanışta
 * end_km'e yazılınca fark tam 0 çıkıyor ve rapor "0 km" diyor — uydurma bir
 * sayı, "ölçülemedi" değil. 6 saat, en uzun vardiyadan (12 sa tavan) kısa ama
 * cihazın park hâlindeki SAATLİK atımından uzun: sağlıklı bir cihaz bu pencerede
 * en az 5 kez konuşur, ölü cihaz hiç konuşmaz.
 */
export const ODO_MAX_AGE_MS = 6 * 3_600_000;

/** Okuma bu yaştan eskiyse odometre YOK sayılır. */
function odometreTaze(recordedAt: string | null | undefined, now: number): boolean {
  if (!recordedAt) return true; // zaman damgası verilmediyse eski davranış
  const t = new Date(recordedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t <= ODO_MAX_AGE_MS;
}

/**
 * Vardiya başlangıç km'si: TAZE odometre → aracın son biten vardiyası → 0.
 * Manuel başlatma (startShiftManualAction) da bunu kullanır — iki yol arasında
 * km kuralı çatallanmasın diye tek kaynak.
 *
 * `odometerAt` verilirse bayat okuma reddedilir; verilmezse eski davranış sürer.
 */
export async function resolveStartKm(
  vehicleId: string,
  odometerKm: number | null | undefined,
  odometerAt?: string | null,
  now: number = Date.now()
): Promise<number> {
  const norm = odometreTaze(odometerAt, now)
    ? normalizeOdometerKm(odometerKm)
    : null;
  if (norm !== null) return norm;

  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("end_km, start_km")
    .eq("vehicle_id", vehicleId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.end_km != null) return data.end_km as number;
  if (data?.start_km != null) return data.start_km as number;
  return 0;
}

/**
 * Vardiyanın bitiş km'si: geçerli odometre → GPS mesafesi (metrics-distance) →
 * null (rapor "—" gösterir). Şoför bitiş km'si GİRMEZ (21.07.2026) — manuel
 * kapanış da (endShiftAction) bu fonksiyonu çağırır, yani otomatik ve manuel
 * kapanış birebir aynı kaynaktan türetir.
 *
 * Sıra bilinçli: cihaz odometresi aracın GERÇEK sayacıdır, GPS haversine'ı
 * (sinyal boşluklarında eksik sayar) yenemez. GPS yalnız odometre yoksa ya da
 * makul aralık dışındaysa devreye girer.
 *
 * ⚠️ İKİ YENİ KAPI (15.08.2026) — sahte "0 km"nin kaynağı buradaydı:
 *  ① TAZELİK: bayat odometre (bkz. ODO_MAX_AGE_MS) reddedilir. Cihaz ölüyken
 *    dönen eski değer start_km ile ÖZDEŞ olduğu için hem `norm >= start_km` hem
 *    `fark <= MAX_PER_SHIFT_KM` sağlanıyor, guard'a takılmıyor ve GPS yedeğine
 *    HİÇ düşülmüyordu.
 *  ② EŞİTLİK: `>=` yerine `>`. Bitiş okuması başlangıçla birebir aynıysa bu bir
 *    "0 km ölçümü" değil, aynı satırın iki kez okunmasıdır — GPS'e düşülür, o da
 *    boşsa end_km null kalır ve rapor dürüstçe "—" gösterir.
 * Gerçekten hiç hareket etmemiş bir araçta GPS izi vardır (park atımları) ve
 * `computeDistanceKm` 0 km döndürür → end_km = start_km + 0 yazılır. Yani
 * "park etti, 0 km" hâlâ ölçülebiliyor; ayrılan tek şey CİHAZSIZ 0.
 */
export async function resolveEndKm(
  vehicleId: string,
  shift: { started_at: string; start_km: number },
  endedAtIso: string,
  odometerKm: number | null | undefined,
  odometerAt?: string | null,
  now: number = Date.now()
): Promise<number | null> {
  const norm = odometreTaze(odometerAt, now)
    ? normalizeOdometerKm(odometerKm)
    : null;
  if (
    norm !== null &&
    norm > shift.start_km &&
    norm - shift.start_km <= MAX_PER_SHIFT_KM
  ) {
    return norm;
  }
  try {
    const track = await listVehicleTrack(vehicleId, shift.started_at, endedAtIso);
    const dist = computeDistanceKm(track);
    if (dist.points > 1) {
      const km = Math.round(dist.km);
      if (km >= 0 && km <= MAX_PER_SHIFT_KM) return shift.start_km + km;
    }
  } catch {
    // GPS izi okunamadı — end_km null kalır.
  }
  return null;
}

/**
 * Vardiyadaki son "yaşam belirtisi" (ms epoch).
 *
 * Telefon GPS'i (driver_locations) sinyal setinden ÇIKARILDI — 21.07.2026:
 * şoför telefonu artık konum göndermiyor, sinyal her zaman boş dönerdi. Kalan
 * dört sinyal yeterli: kontak açık, araç hareketi, paket, foto. Cihaz kontak
 * kapalıyken bile saatlik heartbeat attığı için hareket sinyali telefon
 * izlerinden zaten daha güvenilirdi.
 */
async function lastActivityMs(vehicleId: string, shift: OpenShift): Promise<number> {
  const [lastIgnOn, lastMove, lastPackage, lastPhoto] =
    await Promise.all([
      newestTime("recorded_at", () =>
        supabaseAdmin
          .from("device_telemetry")
          .select("recorded_at")
          .eq("vehicle_id", vehicleId)
          .eq("ignition_on", true)
          .gte("recorded_at", shift.started_at)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
      newestTime("recorded_at", () =>
        supabaseAdmin
          .from("device_telemetry")
          .select("recorded_at")
          .eq("vehicle_id", vehicleId)
          .gte("speed_kmh", MOVE_SPEED_KMH)
          .gte("recorded_at", shift.started_at)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
      newestTime("recorded_at", () =>
        supabaseAdmin
          .from("shift_packages")
          .select("recorded_at")
          .eq("time_entry_id", shift.id)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
      newestTime("taken_at", () =>
        supabaseAdmin
          .from("shift_photos")
          .select("taken_at")
          .eq("time_entry_id", shift.id)
          .order("taken_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
    ]);
  return maxTime(
    shift.started_at,
    shift.confirmed_at,
    lastIgnOn,
    lastMove,
    lastPackage,
    lastPhoto
  );
}

/** Otomatik vardiya kapısının okuduğu şoför alanları — tekil ve toplu yol AYNI küme. */
type SoforKunyesi = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

/**
 * ŞOFÖR KÜNYELERİ TOPLU — araç başına 1 sorgu yerine TUR BAŞINA 1 (#131a).
 *
 * Otomatik başlatma kapısını geçen her araç için döngü içinde tek bir şoför
 * satırı okunuyordu. Cron'un KENDİ logunda ölçüldü (20.08.2026): gece turunda
 * `workers` 22 sorgu — turun 57 sorgusunun 22'si. El çağrısıyla yapılan
 * ölçümlerde bu yol 8'de kaldığı için #84 boyunca hiç göze batmadı.
 *
 * Döngü zaten şoför bağlamının geri kalanını (`openByWorker`, `startedToday`,
 * `onLeaveToday`) toplu kuruyor; eksik olan tek şey künyeydi. Migration
 * GEREKTİRMEZ — düz bir `.in()` okuması.
 *
 * GERİ DÜŞÜŞ: `null` dönerse döngü araç-araç eski yola döner, davranış birebir
 * aynı kalır (Adım 5 deseni).
 */
async function workersByIdBatch(
  workerIds: string[]
): Promise<Map<string, SoforKunyesi> | null> {
  if (workerIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_active")
    .in("id", workerIds);
  if (error) {
    console.warn(
      `[auto-shift] şoför künyeleri toplu okunamadı (${error.message}) — araç-araç eski yola dönülüyor`
    );
    return null;
  }
  const harita = new Map<string, SoforKunyesi>();
  for (const w of (data ?? []) as SoforKunyesi[]) harita.set(w.id, w);
  return harita;
}


/**
 * Ana giriş noktası. `vehicleIds` verilirse yalnız o araçlar taranır
 * (ingest push'u); verilmezse atanmış şoförü olan tüm aktif araçlar (sync).
 * Asla throw etmez — hatalar summary.errors'a yazılır (GPS akışını düşürmez).
 */
/**
 * BUGÜNÜN İLK KONTAK AÇILIŞI (Viyana günü) — 'first_ignition' tetikleyicisi.
 *
 * Araçların geceyi depoda geçirdiği filoda mesai, sabah aracın çalıştırılmasıyla
 * başlar; depo geofence'ine hiç girilmez (araç zaten oradadır) ve depo tetiği
 * bu yüzden hiç ateşlenmez. Ayrıca depo tetiği teğet-geçme ve telemetri
 * boşluklarına duyarlıdır (25.07.2026 dersi: 29 aracın 9'unda fix seyrek);
 * kontak sinyali o boşluklardan bağımsızdır.
 *
 * Günün İLKİ aranır, son değil: vardiya başlangıcı sabahki ilk çalıştırmadır,
 * gün içindeki her yeniden çalıştırma değil. Kayıt yoksa null → vardiya açılmaz.
 */
async function firstIgnitionToday(vehicleId: string): Promise<string | null> {
  const dayStart = startOfTodayVienna().toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", vehicleId)
      .eq("ignition_on", true)
      .gte("recorded_at", dayStart)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.recorded_at as string;
  } catch {
    return null;
  }
}

export async function processAutoShifts(
  vehicleIds?: string[]
): Promise<AutoShiftSummary> {
  const summary: AutoShiftSummary = { checked: 0, started: 0, ended: 0, errors: [] };
  /**
   * ══ GEÇİCİ TEŞHİS (21.08.2026) — İŞ BİTİNCE KALDIRILACAK ═══════════════
   * galzura-demo iş gününün ortasında SIFIR açık vardiya gösteriyor. Motor
   * koşuyor (sorgu sayacı görüyor) ama hiçbir vardiya açmıyor. "Neden"in
   * cevabı YALNIZ verinin kendisinde: hangi kapı kaç aracı eliyor.
   * Yalnız SAYI basılır — plaka, ad, koordinat YOK.
   */
  const huni = {
    telemetriYok: 0, acikVardiya: 0, atamaYok: 0, pasifArac: 0, otoKapali: 0,
    soforMesgul: 0, bugunBasladi: 0, izinli: 0, depoYok: 0, soforPasif: 0,
    tetikYok: 0, digerGuard: 0,
  };
  let enYeniTelemetriDk: number | null = null;
  let depoBolgeSayisi = -1;
  let acikVardiyaSayisi = -1;
  let bugunBaslayanSayisi = -1;
  let izinliSayisi = -1;
  let enEskiTelemetriDk: number | null = null;
  const now = Date.now();
  const idleMs = autoEndIdleMinutes() * 60 * 1000;

  try {
    // Telemetrisi olabilecek araçlar (auto-end tüm açık oto-vardiyaları kapsar;
    // auto-start ayrıca atanmış şoför + aktif durum ister).
    // test-visible: YAZMA yolu — otomatik vardiya açma/kapama taraması.
    // `.or(flespi_device_id/imei not null)` cihazsız test aracını zaten eler.
    let vq = supabaseAdmin
      .from("vehicles")
      .select(
        "id, plate, status, assigned_worker_id, flespi_device_id, imei, auto_start_enabled"
      )
      .or("flespi_device_id.not.is.null,imei.not.is.null");
    if (vehicleIds && vehicleIds.length > 0) vq = vq.in("id", vehicleIds);
    const { data: vehData, error: vehErr } = await vq;
    if (vehErr) {
      summary.errors.push(`vehicles: ${vehErr.message}`);
      return summary;
    }
    const vehicles = (vehData ?? []) as VehicleRow[];
    if (vehicles.length === 0) return summary;

    // Tüm açık vardiyalar tek sorguda.
    // test-visible: YAZMA yolu. Bu harita "bu araçta/şoförde zaten açık vardiya
    // var mı?" guard'ını besliyor; test satırını elemek motoru İKİNCİ bir
    // vardiya açmaya iter. Test aracının cihazı yok, zaten yukarıdaki araç
    // taramasına hiç girmiyor.
    const { data: openData, error: openErr } = await supabaseAdmin
      .from("time_entries")
      .select(
        "id, worker_id, vehicle_id, started_at, start_km, break_minutes, break_started_at, auto_started, confirmation_status, confirmed_at, plate"
      )
      .is("ended_at", null);
    if (openErr) {
      summary.errors.push(`open shifts: ${openErr.message}`);
      return summary;
    }
    const open = (openData ?? []) as OpenShift[];
    const openByWorker = new Map(open.map((s) => [s.worker_id, s]));
    // GÜNDE TEK VARDİYA (lib/shift-day.ts). Çöp vardiyanın kaynağı tam burasıydı:
    // kontak her açılıp kapandığında bu motor yeni bir vardiya açıyordu. Artık
    // şoför o gün bir kez vardiya açtıysa (manuel ya da otomatik, KAPANMIŞ olsa
    // bile) kontak ikinci vardiyayı açmaz. Otomatik BİTİRME bu kümeden
    // etkilenmez — açık vardiya her hâlükârda kapatılabilmelidir.
    const startedToday = await workersWithShiftToday();
    // İZİNLİ ŞOFÖRE OTOMATİK VARDİYA AÇMA (Modül 1 — kritik). assigned_worker_id
    // izinde olan bir aracın kontağı açılırsa (aracı büyük olasılıkla BAŞKASI
    // kullanıyordur) motor, vardiyayı İZİNLİ şoförün adına açardı → izinli
    // "çalışıyor" görünür ve AZG raporuna yanlış veri girer. Onaylı izni BUGÜNÜ
    // kapsayan şoförleri baştan eler. Tablo yoksa boş küme → davranış değişmez.
    // (İşten ÇIKAN şoför ayrıca aşağıda `w.is_active !== true` ile elenir —
    // termination is_active=false yazar; iki kapı bilinçli olarak üst üste.)
    const onLeaveToday = await approvedLeaveWorkerIdsForDay();
    // Depo bölgeleri (Modül 7). Boşsa depo-tetikli auto devre dışı — hiçbir araç
    // otomatik açılmaz (depo tanımlı değil). Tek sorgu, döngü dışında.
    const depotZones = await activeDepotZones();
    depoBolgeSayisi = depotZones.length;
    acikVardiyaSayisi = open.length;
    bugunBaslayanSayisi = startedToday.size;
    izinliSayisi = onLeaveToday.size;
    const openByVehicle = new Map(
      open.filter((s) => s.vehicle_id).map((s) => [s.vehicle_id as string, s])
    );

    /**
     * CANLI TELEMETRİ — DÖNGÜDEN ÖNCE, PARÇALI TOPLU OKUMA (#116b, migration 065).
     *
     * Aşağıdaki döngünün ilk satırı `latestVehicleTelemetry(v.id)` çağırıyordu:
     * koşulsuz, araç başına 1. Ölçüldü — yoğun turda `device_telemetry` 37
     * sorgunun 29'u buydu, yani #84 Adım 0-4'ten sonra turun en büyük kalemi.
     *
     * Toplu okuma araç listesini PENCEREDEN TÜREYEN parçalara bölüyor
     * (29 araç → 2 çağrı): 29 × 40 satır tek çağrıda istenirse PostgREST
     * 1000'de sessizce keser ve bazı araçların CAN alanları eksik tamamlanır.
     *
     * GERİ DÜŞÜŞ (Adım 5): `null` dönerse döngü aynen eski yola, araç-araç
     * `latestVehicleTelemetry`'ye döner — davranış birebir aynı, yalnız kazanç
     * gerçekleşmez. Migration 065 koşmadan da güvenli.
     */
    const canliTelemetri = await latestTelemetryBatch(vehicles.map((v) => v.id));

    /**
     * ŞOFÖR KÜNYELERİ — DÖNGÜDEN ÖNCE, TEK SORGU (#131a).
     *
     * Aday kümesi döngü içindeki ucuz guard'lardan geçenler; onları burada
     * daraltmıyoruz çünkü guard'lar araç durumuna bakıyor ve toplu okuma zaten
     * araç sayısından bağımsız TEK sorgu. Atanmış şoförü olan tüm araçların
     * künyesi bir kerede okunur, döngü haritadan bakar.
     */
    const soforKunyeleri = await workersByIdBatch([
      ...new Set(
        vehicles
          .map((v) => v.assigned_worker_id)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ]);

    for (const v of vehicles) {
      summary.checked++;
      try {
        // Map'te YOKLUK "bu aracın hiç telemetrisi yok" demektir (tekil yol da
        // null döndürürdü). Map'in KENDİSİ null ise toplu okuma başarısız
        // olmuştur → tekil sorguya düşülür.
        const latest = canliTelemetri
          ? canliTelemetri.get(v.id) ?? null
          : await latestVehicleTelemetry(v.id);
        if (!latest) {
          huni.telemetriYok++;
          continue;
        }

        const latestMs = new Date(latest.recorded_at).getTime();
        {
          const yasDk = Math.round((now - latestMs) / 60000);
          if (enYeniTelemetriDk === null || yasDk < enYeniTelemetriDk) enYeniTelemetriDk = yasDk;
          if (enEskiTelemetriDk === null || yasDk > enEskiTelemetriDk) enEskiTelemetriDk = yasDk;
        }
        const vehicleShift = openByVehicle.get(v.id) ?? null;

        // ── OTOMATİK BAŞLAT — DEPO TETİĞİ (Modül 7) ─────────────────────
        // Kontak değil, DEPOYA GİRİŞ tetikler. Ucuz guard'lar önce (track sorgusu
        // atmadan eleme): atanmış + aktif araç + auto_start_enabled + şoför
        // izinli/ayrılmış/bugün-başlamış DEĞİL. Sonra depotArrivalTrigger.
        if (
          AUTO_START_ENABLED &&
          // Depo bölgesi şartı YALNIZ depo tetiğinde geçerli: 'first_ignition'
          // depo tanımına hiç bakmaz (araç zaten depoda uyanır).
          (SHIFT_START_TRIGGER === "first_ignition" || depotZones.length > 0) &&
          !vehicleShift &&
          v.assigned_worker_id &&
          v.status === "active" &&
          v.auto_start_enabled !== false &&
          !openByWorker.has(v.assigned_worker_id) &&
          !startedToday.has(v.assigned_worker_id) &&
          !onLeaveToday.has(v.assigned_worker_id)
        ) {
          // Haritada YOKLUK "böyle bir şoför kaydı yok" demektir (tekil yol da
          // null döndürürdü). Haritanın KENDİSİ null ise toplu okuma
          // başarısız olmuştur → tekil sorguya düşülür.
          const w = soforKunyeleri
            ? soforKunyeleri.get(v.assigned_worker_id) ?? null
            : (
                await supabaseAdmin
                  .from("workers")
                  .select("id, name, is_active")
                  .eq("id", v.assigned_worker_id)
                  .maybeSingle()
              ).data;
          if (!w || w.is_active !== true) {
            huni.soforPasif++;
            continue;
          }

          // TETİKLEYİCİ MÜŞTERİ AYARI (lib/tenant.ts):
          //  • depot_entry    — bugün depoya girip ≥3dk kaldı mı? Başlangıç =
          //                     VARIŞ anı (kontak-açılma DEĞİL, commute sayılmaz).
          //  • first_ignition — bugünün ilk kontak açılışı.
          // İkisi de "bugün için bir başlangıç anı" döndürür ya da hiç; aşağısı
          // ortak yoldur, iki tetikleyici için ayrı bir açma kodu YOKTUR.
          let startedAt: string | null = null;
          if (SHIFT_START_TRIGGER === "first_ignition") {
            startedAt = await firstIgnitionToday(v.id);
          } else {
            const trig = await depotArrivalTrigger(v.id);
            startedAt = trig ? trig.startAt : null;
          }
          if (!startedAt) {
            huni.tetikYok++;
            continue;
          }
          const startKm = await resolveStartKm(v.id, latest.odometer_km, latest.recorded_at);

          // BAŞLATMA YOLU İZİ (037): start_source='auto'. 25.07.2026'ya kadar bu
          // alan HİÇ yazılmıyordu ve kolonun `default 'self'` değeri düşüyordu —
          // yani motorun açtığı her vardiya "şoför kendi başlattı" olarak
          // kaydediliyordu (25.07 sabahı 9 vardiya). auto_started zaten gerçeği
          // taşıyor, ama iki alan birbiriyle çelişemez.
          const baseRow = {
            worker_id: v.assigned_worker_id,
            vehicle_id: v.id,
            plate: v.plate,
            started_at: startedAt,
            start_km: startKm,
            break_minutes: 0,
            auto_started: true,
            // PENDING YOK (Volkan 24.07): şoför onayı beklemez, doğrudan açılır;
            // panel bilgi gösterir, yanlış açılırsa yönetici düzeltir.
            confirmation_status: "confirmed",
            confirmed_at: startedAt,
          };
          let { data: ins, error: insErr } = await supabaseAdmin
            .from("time_entries")
            .insert({ ...baseRow, start_source: "auto" })
            .select("id")
            .maybeSingle();
          // 037 uygulanmamış ortam: kolon yok → izsiz tekrar dene. Vardiya ASLA
          // iz kolonu yüzünden açılmadan kalmaz (shift.ts:448 deseninin aynısı).
          if (insErr && /start_source|column/i.test(insErr.message)) {
            ({ data: ins, error: insErr } = await supabaseAdmin
              .from("time_entries")
              .insert(baseRow)
              .select("id")
              .maybeSingle());
          }

          if (insErr) {
            // 23505 = uq_time_entries_one_open (eşzamanlı sync/ingest yarışı) —
            // beklenen bir durum, hata değil.
            if (!/duplicate key|23505/i.test(insErr.message)) {
              summary.errors.push(`${v.plate} start: ${insErr.message}`);
            }
            continue;
          }
          if (ins) {
            summary.started++;
            // Aynı turda başka bir araç aynı şoför için ikinci vardiya açmasın.
            startedToday.add(v.assigned_worker_id);
            openByWorker.set(v.assigned_worker_id, {
              id: ins.id as string,
              worker_id: v.assigned_worker_id,
              vehicle_id: v.id,
              started_at: startedAt,
              start_km: startKm,
              break_minutes: 0,
              break_started_at: null,
              auto_started: true,
              confirmation_status: "confirmed",
              confirmed_at: startedAt,
              plate: v.plate,
            });

            // DIS BILDIRIM KATMANI SOKULDU (20.08.2026): otomatik baslatma
            // sofore ve yoneticilere ayrica bildiriliyordu. Vardiyanin ACILMASI
            // degismedi; bilgi paneldeki Dikkat/Roster yuzeylerinde duruyor.
          }
          continue;
        } else if (AUTO_START_ENABLED) {
          /* GEÇİCİ TEŞHİS — hangi kapı eledi (sırayla ilk uyan). Yazma yok. */
          if (vehicleShift) huni.acikVardiya++;
          else if (!(SHIFT_START_TRIGGER === "first_ignition" || depotZones.length > 0))
            huni.depoYok++;
          else if (!v.assigned_worker_id) huni.atamaYok++;
          else if (v.status !== "active") huni.pasifArac++;
          else if (v.auto_start_enabled === false) huni.otoKapali++;
          else if (openByWorker.has(v.assigned_worker_id)) huni.soforMesgul++;
          else if (startedToday.has(v.assigned_worker_id)) huni.bugunBasladi++;
          else if (onLeaveToday.has(v.assigned_worker_id)) huni.izinli++;
          else huni.digerGuard++;
        }

        // ── OTOMATİK BİTİR — KAPALI (Volkan, 22.07.2026) ────────────────
        // KURAL: VARDİYAYI YALNIZCA PERSONEL KAPATIR. Sistem bir vardiyayı
        // asla kendiliğinden kapatmaz.
        //
        // Neden kaldırıldı: kontak kapalı + 30 dk hareketsizlik eşiği, depoda
        // paket yükleyen şoförü "ölü" sayıyordu. 22.07.2026 sabahı 24 şoförün
        // 20'si, 8–48 dakikalık vardiyalarla otomatik kapatıldı; ardından
        // "günde tek vardiya" kilidi (lib/shift-day.ts) yeni vardiya açılmasını
        // engelleyince şoförler güne kayıtsız devam etti ("GPS çalışmıyor").
        //
        // Otomatik BAŞLATMA (yukarısı) DURUYOR — kural yalnız kapanış hakkında.
        // Kapanış yolları artık yalnız insan eliyle: panel (endShiftAction),
        // çevrimdışı kuyruk replay'i, watchdog "Hayır" yanıtı ve
        // yönetici (adminCloseShiftAction / editEntryAction).
        //
        // Aşağıdaki blok AUTO_END_ENABLED=false ile kapatıldı (silinmedi):
        // eşik/aktivite mantığı, kural bir gün geri istenirse tek sabitin
        // true yapılmasıyla geri gelir. lastActivityMs/resolveEndKm hâlâ
        // kullanımda (resolveEndKm manuel kapanışın km kaynağı).
        if (!AUTO_END_ENABLED) continue;

        if (!vehicleShift) continue;
        // AUTO_STARTED ŞARTI — yalnız depo tetikli kurulumda (HAK61 davranışı).
        // 'depot_idle' kurulumunda şoför paneli yoktur: yöneticinin elle açtığı
        // bir vardiyayı da kapatacak kimse kalmaz, o yüzden orada şart aranmaz.
        if (!AUTO_END_REQUIRES_DEPOT && !vehicleShift.auto_started) continue;
        // Şoför molada — mola, vardiyanın bilinçli sürdüğünün beyanı.
        if (vehicleShift.break_started_at) continue;
        // Kontak açık ve cihaz konuşuyor → vardiya sürüyor.
        if (latest.ignition_on === true && now - latestMs < SILENT_GRACE_MS) {
          continue;
        }

        const lastActivity = await lastActivityMs(v.id, vehicleShift);
        if (now - lastActivity < idleMs) continue;

        // ── DEPO ŞARTI + GECE-YARISI EMNİYETİ ('depot_idle') ─────────────
        // Gün içindeki teslimat duraklarında kontak kapanır ve araç eşiği aşacak
        // kadar hareketsiz kalabilir. Vardiyayı bitiren şey hareketsizlik değil,
        // DEPOYA DÖNMÜŞ + hareketsiz olmaktır.
        //
        // Emniyet: araç gün sonuna kadar depoya dönmezse vardiya gece boyu açık
        // kalmamalı. Vardiyanın başladığı Viyana günü kapandıysa, kapanış SON
        // HAREKET anına yazılır (şu ana değil) — çalışılmayan saatler AZG
        // raporuna girmez. Emniyet kapatılabilir; kapalıysa depo dışındaki araç
        // hiç kapanmaz ve ertesi gün yönetici düzeltir.
        if (AUTO_END_REQUIRES_DEPOT) {
          const inDepot = await lastFixInDepot(v.id, depotZones);
          if (!inDepot) {
            const shiftDayEnded =
              new Date(vehicleShift.started_at).getTime() <
              startOfTodayVienna().getTime();
            if (!(SHIFT_AUTO_END_MIDNIGHT_FALLBACK && shiftDayEnded)) continue;
          }
        }

        const endedAtIso = new Date(lastActivity).toISOString();
        const endKm = await resolveEndKm(
          v.id,
          vehicleShift,
          endedAtIso,
          latest.odometer_km,
          latest.recorded_at
        );

        const update: Record<string, unknown> = {
          ended_at: endedAtIso,
          end_km: endKm,
          auto_ended: true,
          end_reason: "auto_idle",
          summary_notified_at: new Date().toISOString(),
        };
        if (vehicleShift.confirmation_status === "pending") {
          update.confirmation_status = "unconfirmed";
        }

        const { data: closed, error: endErr } = await supabaseAdmin
          .from("time_entries")
          .update(update)
          .eq("id", vehicleShift.id)
          .is("ended_at", null)
          .select("id");
        if (endErr) {
          summary.errors.push(`${v.plate} end: ${endErr.message}`);
          continue;
        }
        if (!closed || closed.length === 0) continue; // başka bir yol kapattı

        summary.ended++;
        openByVehicle.delete(v.id);
        openByWorker.delete(vehicleShift.worker_id);

        // DIS BILDIRIM KATMANI SOKULDU (20.08.2026): otomatik kapanista
        // sofore ozet mesaji gidiyordu. Kapanisin KENDISI degismedi.
      } catch (e) {
        summary.errors.push(
          `${v.plate}: ${e instanceof Error ? e.message : "error"}`
        );
      }
    }
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : "error");
  }

  /* ══ GEÇİCİ TEŞHİS — İŞ BİTİNCE KALDIRILACAK (21.08.2026) ══
     BUGÜNÜN VARDİYALARINI KİM KAPATTI? "15 vardiya açıldı, 0'ı açık"
     tek başına kapatanı söylemiyor. end_reason + auto_ended + SÜRE bunu
     tek satırda verir: auto_idle + kısa süre = motorun kendisi kapatmış. */
  let bugunkuOzet = "olculmedi";
  try {
    const { data: bugunku } = await supabaseAdmin
      .from("time_entries")
      .select("started_at, ended_at, auto_started, auto_ended, end_reason")
      .gte("started_at", startOfTodayVienna().toISOString());
    const satirlar = (bugunku ?? []) as {
      started_at: string; ended_at: string | null;
      auto_started: boolean | null; auto_ended: boolean | null;
      end_reason: string | null;
    }[];
    const sebep: Record<string, number> = {};
    const sureler: number[] = [];
    for (const r of satirlar) {
      const k = r.ended_at ? (r.end_reason ?? "bos") : "ACIK";
      sebep[k] = (sebep[k] ?? 0) + 1;
      if (r.ended_at) {
        sureler.push(Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000));
      }
    }
    sureler.sort((a, b) => a - b);
    bugunkuOzet = JSON.stringify({
      toplam: satirlar.length,
      otoAcilan: satirlar.filter((r) => r.auto_started).length,
      otoKapanan: satirlar.filter((r) => r.auto_ended).length,
      sebep,
      sureDk: sureler.length
        ? { min: sureler[0], orta: sureler[Math.floor(sureler.length / 2)], max: sureler[sureler.length - 1] }
        : null,
    });
  } catch (e) {
    bugunkuOzet = "hata:" + (e instanceof Error ? e.message.slice(0, 40) : "?");
  }
  console.log(
    "[oto-vardiya-teshis] tetik=" + SHIFT_START_TRIGGER +
      " otoAcik=" + AUTO_START_ENABLED +
      " gunBasi=" + startOfTodayVienna().toISOString() +
      " simdi=" + new Date(now).toISOString() +
      " depoBolge=" + depoBolgeSayisi +
      " acikVardiya=" + acikVardiyaSayisi +
      " bugunBaslayanSofor=" + bugunBaslayanSayisi +
      " izinliSofor=" + izinliSayisi +
      " telemetriYasDk=[" + enYeniTelemetriDk + "," + enEskiTelemetriDk + "]" +
      " bugunkuVardiyalar=" + bugunkuOzet +
      " huni=" + JSON.stringify(huni) +
      " ozet=" + JSON.stringify({ checked: summary.checked, started: summary.started, ended: summary.ended, hata: summary.errors.length })
  );
  return summary;
}
