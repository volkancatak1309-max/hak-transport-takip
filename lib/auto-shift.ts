import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { latestVehicleTelemetry, listVehicleTrack } from "@/lib/telemetry";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { MAX_ODOMETER, MAX_PER_SHIFT_KM } from "@/lib/validation";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  autoShiftStartedAdminMessage,
  autoShiftStartedDriverMessage,
  shiftSummaryMessage,
} from "@/lib/telegram-messages";
import { workedMs, formatDurationShort, formatTime } from "@/lib/format";
import { workersWithShiftToday } from "@/lib/shift-day";
import { approvedLeaveWorkerIdsForDay } from "@/lib/leaves";

/**
 * Otomatik vardiya motoru (Şoför Paneli v2 — İş 1).
 *
 * Araç telemetrisi (device_telemetry.ignition_on) üzerinden:
 *  - BAŞLAT: KALDIRILDI (24.07.2026, AUTO_START_ENABLED=false). Vardiyayı
 *    yalnızca PERSONEL başlatır; sistem kontaktan vardiya AÇMAZ. Eski davranış
 *    (kontak açılınca auto_started=true açma) kodda kill-switch ardında duruyor.
 *    Mesai artık depoya bağlı — geri istenirse depo kapısıyla açılmalı.
 *  - BİTİR: KALDIRILDI (22.07.2026, AUTO_END_ENABLED=false). Vardiyayı
 *    yalnızca personel kapatır; sistem hiçbir koşulda kapatmaz. Eski davranış
 *    (kontak kapalı + AUTO_SHIFT_IDLE_END_MINUTES hareketsizlik → auto_idle)
 *    kodda duruyor ama şalter kapalı. Gerekçe: eşik, depoda yükleme yapan
 *    şoförü ölü sayıp vardiyayı 9 dakikada kapatıyordu.
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
 * OTOMATİK KAPANIŞ ANA ŞALTERİ — KAPALI (Volkan, 22.07.2026).
 * "Vardiyayı yalnızca personel kapatır." Tip açıkça `boolean`: literal `false`
 * olarak daraltılsaydı aşağıdaki blok statik olarak erişilmez sayılırdı.
 * Kural geri istenirse tek yapılacak bunu `true` yapmaktır.
 */
const AUTO_END_ENABLED: boolean = false;

/**
 * OTOMATİK BAŞLATMA ANA ŞALTERİ — KAPALI (Volkan, 24.07.2026).
 *
 * KURAL: VARDİYAYI SADECE PERSONEL BAŞLATIR VE BİTİRİR. Sistem hiçbir koşulda
 * kendiliğinden vardiya AÇMAZ.
 *
 * 22.07.2026'da otomatik KAPATMA kaldırılırken (AUTO_END_ENABLED=false) başlatma
 * yanlışlıkla açık bırakılmıştı: her kontak açılışı yeni bir vardiya ekliyor,
 * üstelik şoförler evde kamyonu ısıtırken mesai evde başlamış görünüyordu
 * (24.07 sabahı 12 vardiyanın 9'u böyle otomatik açılmıştı). Tip açıkça
 * `boolean`: literal `false`'a daraltılsaydı aşağıdaki blok statik erişilemez
 * sayılırdı. Kural geri istenirse tek yapılacak bunu `true` yapmaktır — ama
 * mesai artık depoya bağlı, geri açılırsa depo kapısıyla açılmalı.
 */
const AUTO_START_ENABLED: boolean = false;

/** Config: kontak kapalı + hareketsizlik eşiği (dk). Env ile ayarlanabilir. */
export function autoEndIdleMinutes(): number {
  const raw = Number(process.env.AUTO_SHIFT_IDLE_END_MINUTES);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 720) return Math.floor(raw);
  return DEFAULT_IDLE_END_MINUTES;
}

/** Otomatik BAŞLATMA için telemetri bu kadar taze olmalı. */
const START_FRESH_MS = 10 * 60 * 1000;
/** Bu hızın üstü "hareket" sayılır (GPS jitter'ı elemek için). */
const MOVE_SPEED_KMH = 5;
/**
 * Kontak "açık" görünen ama bu süredir susan cihaz artık "çalışıyor"
 * sayılmaz (Teltonika kontak kapanınca raporlamayı kesebilir/seyreltebilir).
 * metrics-engine-hours'daki MAX_ON_GAP_MS ile aynı mantık.
 */
const SILENT_GRACE_MS = 15 * 60 * 1000;
/** Vardiya başlangıcı kontak-açılma anına en fazla bu kadar geri yazılır. */
const MAX_BACKDATE_MS = 2 * 60 * 60 * 1000;

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

/** Kontağın açıldığı anı bulur (son OFF noktasından sonraki ilk ON). */
async function detectIgnitionOnAt(
  vehicleId: string,
  latestRecordedAt: string
): Promise<string> {
  const lastOff = await newestTime("recorded_at", () =>
    supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", vehicleId)
      .eq("ignition_on", false)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  if (!lastOff) return latestRecordedAt;

  try {
    const { data } = await supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", vehicleId)
      .eq("ignition_on", true)
      .gt("recorded_at", lastOff)
      .order("recorded_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const cand = data?.recorded_at ?? latestRecordedAt;
    // Bayat/garip veriyle saatlerce geriye vardiya açma.
    if (Date.now() - new Date(cand).getTime() > MAX_BACKDATE_MS) {
      return latestRecordedAt;
    }
    return cand;
  } catch {
    return latestRecordedAt;
  }
}

/**
 * Vardiya başlangıç km'si: odometre → aracın son biten vardiyası → 0.
 * Manuel başlatma (startShiftManualAction) da bunu kullanır — iki yol arasında
 * km kuralı çatallanmasın diye tek kaynak.
 */
export async function resolveStartKm(
  vehicleId: string,
  odometerKm: number | null | undefined
): Promise<number> {
  const norm = normalizeOdometerKm(odometerKm);
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
 */
export async function resolveEndKm(
  vehicleId: string,
  shift: { started_at: string; start_km: number },
  endedAtIso: string,
  odometerKm: number | null | undefined
): Promise<number | null> {
  const norm = normalizeOdometerKm(odometerKm);
  if (
    norm !== null &&
    norm >= shift.start_km &&
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

/** Telegram'a bağlı tüm adminler (best-effort bildirimler için). */
async function linkedAdmins(): Promise<{ chat: string; locale: string | null }[]> {
  // test-visible: alıcı listesi (is_admin). Özne elemesi araç taramasında —
  // test aracının cihazı yok, otomatik vardiya döngüsüne hiç girmiyor.
  const { data } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);
  return (data ?? []).map((a) => ({
    chat: a.telegram_chat_id as string,
    locale: (a.telegram_locale as string) ?? null,
  }));
}

/**
 * Ana giriş noktası. `vehicleIds` verilirse yalnız o araçlar taranır
 * (ingest push'u); verilmezse atanmış şoförü olan tüm aktif araçlar (sync).
 * Asla throw etmez — hatalar summary.errors'a yazılır (GPS akışını düşürmez).
 */
export async function processAutoShifts(
  vehicleIds?: string[]
): Promise<AutoShiftSummary> {
  const summary: AutoShiftSummary = { checked: 0, started: 0, ended: 0, errors: [] };
  const now = Date.now();
  const idleMs = autoEndIdleMinutes() * 60 * 1000;

  try {
    // Telemetrisi olabilecek araçlar (auto-end tüm açık oto-vardiyaları kapsar;
    // auto-start ayrıca atanmış şoför + aktif durum ister).
    // test-visible: YAZMA yolu — otomatik vardiya açma/kapama taraması.
    // `.or(flespi_device_id/imei not null)` cihazsız test aracını zaten eler.
    let vq = supabaseAdmin
      .from("vehicles")
      .select("id, plate, status, assigned_worker_id, flespi_device_id, imei")
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
    const openByVehicle = new Map(
      open.filter((s) => s.vehicle_id).map((s) => [s.vehicle_id as string, s])
    );

    let admins: { chat: string; locale: string | null }[] | null = null;

    for (const v of vehicles) {
      summary.checked++;
      try {
        const latest = await latestVehicleTelemetry(v.id);
        if (!latest) continue;

        const latestMs = new Date(latest.recorded_at).getTime();
        const vehicleShift = openByVehicle.get(v.id) ?? null;

        // ── OTOMATİK BAŞLAT — KAPALI (Volkan, 24.07.2026) ───────────────
        // KURAL: vardiyayı yalnızca personel başlatır. AUTO_START_ENABLED=false
        // olduğu için aşağıdaki blok hiç girmez; kod, kural bir gün depo-kapılı
        // geri istenirse diye korunur (silinmedi).
        if (
          AUTO_START_ENABLED &&
          !vehicleShift &&
          v.assigned_worker_id &&
          v.status === "active" &&
          latest.ignition_on === true &&
          now - latestMs <= START_FRESH_MS &&
          !openByWorker.has(v.assigned_worker_id) &&
          !startedToday.has(v.assigned_worker_id) &&
          !onLeaveToday.has(v.assigned_worker_id)
        ) {
          const { data: w } = await supabaseAdmin
            .from("workers")
            .select("id, name, is_active, telegram_chat_id, telegram_locale")
            .eq("id", v.assigned_worker_id)
            .maybeSingle();
          if (!w || w.is_active !== true) continue;

          const startedAt = await detectIgnitionOnAt(v.id, latest.recorded_at);
          const startKm = await resolveStartKm(v.id, latest.odometer_km);

          const { data: ins, error: insErr } = await supabaseAdmin
            .from("time_entries")
            .insert({
              worker_id: v.assigned_worker_id,
              vehicle_id: v.id,
              plate: v.plate,
              started_at: startedAt,
              start_km: startKm,
              break_minutes: 0,
              auto_started: true,
              confirmation_status: "pending",
            })
            .select("id")
            .maybeSingle();

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
              confirmation_status: "pending",
              confirmed_at: null,
              plate: v.plate,
            });

            // Best-effort Telegram: şoföre "panelden onayla", adminlere bilgi.
            try {
              if (w.telegram_chat_id) {
                await sendTelegramMessage(
                  w.telegram_chat_id as string,
                  autoShiftStartedDriverMessage(
                    (w.telegram_locale as string) ?? null,
                    { plate: v.plate, time: formatTime(startedAt, (w.telegram_locale as string) ?? "tr") }
                  )
                );
              }
              admins = admins ?? (await linkedAdmins());
              for (const a of admins) {
                await sendTelegramMessage(
                  a.chat,
                  autoShiftStartedAdminMessage(a.locale, {
                    name: (w.name as string) ?? "—",
                    plate: v.plate,
                    time: formatTime(startedAt, a.locale ?? "tr"),
                  })
                );
              }
            } catch {
              // bildirim hatası vardiyayı etkilemez
            }
          }
          continue;
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
        // çevrimdışı kuyruk replay'i, Telegram watchdog "Hayır" yanıtı ve
        // yönetici (adminCloseShiftAction / editEntryAction).
        //
        // Aşağıdaki blok AUTO_END_ENABLED=false ile kapatıldı (silinmedi):
        // eşik/aktivite mantığı, kural bir gün geri istenirse tek sabitin
        // true yapılmasıyla geri gelir. lastActivityMs/resolveEndKm hâlâ
        // kullanımda (resolveEndKm manuel kapanışın km kaynağı).
        if (!AUTO_END_ENABLED) continue;

        if (!vehicleShift || !vehicleShift.auto_started) continue;
        // Şoför molada — mola, vardiyanın bilinçli sürdüğünün beyanı.
        if (vehicleShift.break_started_at) continue;
        // Kontak açık ve cihaz konuşuyor → vardiya sürüyor.
        if (latest.ignition_on === true && now - latestMs < SILENT_GRACE_MS) {
          continue;
        }

        const lastActivity = await lastActivityMs(v.id, vehicleShift);
        if (now - lastActivity < idleMs) continue;

        const endedAtIso = new Date(lastActivity).toISOString();
        const endKm = await resolveEndKm(
          v.id,
          vehicleShift,
          endedAtIso,
          latest.odometer_km
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

        // Best-effort: şoföre vardiya özeti (manuel kapanışla aynı mesaj).
        try {
          const { data: me } = await supabaseAdmin
            .from("workers")
            .select("telegram_chat_id, telegram_locale")
            .eq("id", vehicleShift.worker_id)
            .maybeSingle();
          if (me?.telegram_chat_id) {
            const loc = (me.telegram_locale as string) ?? "tr";
            const ms = workedMs({
              started_at: vehicleShift.started_at,
              ended_at: endedAtIso,
              break_minutes: vehicleShift.break_minutes ?? 0,
            });
            const { count } = await supabaseAdmin
              .from("shift_packages")
              .select("id", { count: "exact", head: true })
              .eq("time_entry_id", vehicleShift.id);
            await sendTelegramMessage(
              me.telegram_chat_id as string,
              shiftSummaryMessage(loc, {
                hours: formatDurationShort(ms, loc),
                km: endKm !== null ? String(endKm - vehicleShift.start_km) : "—",
                cargo: String(count ?? 0),
                breakMin: String(vehicleShift.break_minutes ?? 0),
              })
            );
          }
        } catch {
          // bildirim hatası kapanışı etkilemez
        }
      } catch (e) {
        summary.errors.push(
          `${v.plate}: ${e instanceof Error ? e.message : "error"}`
        );
      }
    }
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : "error");
  }

  return summary;
}
