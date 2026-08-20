import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchDeviceMessages,
  type FlespiEvent,
  type FlespiPoint,
  type IdleReading,
} from "@/lib/flespi";
import { saveTelemetry } from "@/lib/telemetry";
import { IDLE_SPEED_THRESHOLD_KMH, MAX_GAP_MS } from "@/lib/metrics-idle";
import { startOfDayVienna, addCalendarDaysVienna } from "@/lib/format";

/**
 * GEÇMİŞ DOLGU — TARİHSEL MOD (07.08.2026, yalnız galzura-demo).
 *
 * ── NEDEN AYRI BİR DOSYA ───────────────────────────────────────────────────
 * Canlı senkron yolundaki üç koruma, geçmişi geriye dönük yazmayı BİLEREK
 * engelliyor. Ölçüldü (07.08.2026):
 *
 *   1. Olaylar — lib/telemetry.ts:169-195. Tür başına DB'deki EN YENİ
 *      occurred_at okunur, sonra `t - last < cooldown` ise atlanır. Tarihsel
 *      olayda `t - last` NEGATİFtir, yani her zaman eşiğin altında → tarihsel
 *      olayların TAMAMI sessizce düşer.
 *   2. Rölanti — lib/telemetry.ts:376-384. `cursorMs`ten eski okuma atlanır.
 *   3. Vardiya — lib/auto-shift.ts:364, lib/depot.ts:255, lib/shift-day.ts:44.
 *      Motor yalnız `startOfTodayVienna()` penceresine bakar.
 *
 * Üçü de canlı akışta DOĞRUdur (yeniden teslim edilen mesaj tekrar kayıt
 * üretmesin diye kondular). Dolguda ise tam tersi etki yapıyorlar. Bu yüzden
 * onları GEVŞETMEK yerine, tarihsel yol AYRI fonksiyonlar olarak yazıldı:
 * canlı `saveVehicleEvents` / `saveIdleEpisodes` / `processAutoShifts` bu
 * dosyadan HİÇ çağrılmaz ve tek satırları değişmedi.
 *
 * ── DTC YAZILMAZ ───────────────────────────────────────────────────────────
 * `saveDtc`de zaman imleci yoktur: anlık görüntüleri sırayla uygular ve aktif
 * arıza listesini o görüntüye eşitler. 7 gün önceki bir liste BUGÜNKÜ listenin
 * üstüne yazardı — düşen kayıt değil, YANLIŞ kayıt üretirdi. Dolgu DTC'ye hiç
 * dokunmaz; arıza geçmişi yalnız canlı akıştan birikir.
 */

/** lib/flespi.ts'teki MAX_PER_POLL ile aynı — sayfa boyu. */
const PAGE_SIZE = 1000;
/** Bir araç için en fazla sayfa (güvenlik freni): 400 × 1000 = 400 bin mesaj. */
const MAX_PAGES = 400;
/** auto-shift.ts:125'teki MOVE_SPEED_KMH ile aynı eşik — "hareket" sayılan hız. */
const MOVE_SPEED_KMH = 5;

export type VehicleBackfill = {
  plate: string;
  fetched: number;
  telemetry: number;
  events: number;
  idle: number;
  shifts: number;
  pages: number;
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) SAYFALI ÇEKİM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pencerenin TAMAMINI çeker. `fetchDeviceMessages` sayfa başına en fazla
 * MAX_PER_POLL (1000) mesaj döndürdüğü için canlı senkron bir turda pencereyi
 * bitiremez — orada sorun değil, çünkü imleç her turda biraz ilerler. Dolguda
 * ise pencere tek çağrıda bitmek zorunda; bu yüzden burada sayfalıyoruz.
 *
 * İmleç ilerletme, canlı yolun desenini izler: `from` DAHİLdir, sınırdaki mesaj
 * yeniden çekilir ve upsert onu düşürür. Zaman ilerlemezse (aynı saniyede 1000+
 * mesaj) imleç 1 sn zorlanır — sonsuz döngü olamaz.
 */
async function fetchWindowPaged(
  deviceId: number,
  fromTs: number,
  toTs: number
): Promise<{
  points: FlespiPoint[];
  events: FlespiEvent[];
  idle: IdleReading[];
  pages: number;
}> {
  const points: FlespiPoint[] = [];
  const events: FlespiEvent[] = [];
  const idle: IdleReading[] = [];
  let cursor = fromTs;
  let pages = 0;

  for (; pages < MAX_PAGES; ) {
    // DTC bilerek alınmıyor — dosya başındaki nota bakın.
    const r = await fetchDeviceMessages(deviceId, cursor, toTs);
    pages++;
    const got = r.points.length + r.events.length + r.idle.length;
    if (got === 0) break;

    points.push(...r.points);
    events.push(...r.events);
    idle.push(...r.idle);

    // Bu sayfada görülen en büyük cihaz zamanı.
    let maxTs = -Infinity;
    for (const p of r.points) if (p.flespi_timestamp > maxTs) maxTs = p.flespi_timestamp;
    for (const i of r.idle) if (i.ts > maxTs) maxTs = i.ts;
    for (const e of r.events) {
      const t = Math.floor(new Date(e.occurred_at).getTime() / 1000);
      if (t > maxTs) maxTs = t;
    }
    if (!Number.isFinite(maxTs)) break;

    // Sayfa dolmadıysa pencere bitti.
    if (r.points.length < PAGE_SIZE && r.idle.length < PAGE_SIZE) break;
    cursor = maxTs > cursor ? maxTs : cursor + 1;
    if (cursor > toTs) break;
  }

  return { points, events, idle, pages };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) OLAYLAR — cooldown YOK, (tür + an) tekilliği VAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `saveVehicleEvents`in tarihsel ikizi. TEK farkı cooldown bloğunun olmaması;
 * yazma yolu ve çakışma hedefi birebir aynıdır, bu yüzden canlı akışın daha
 * önce yazdığı bir olayı ikizlemez (uq_vehicle_events_dedup).
 *
 * Cooldown yerine ne var: batch içi (tür + an) tekilliği. Cihaz durum bayrağını
 * her periyodik kayıtta tekrar gönderdiği için 25 dakikalık bir aşırı hız
 * penceresinden onlarca satır çıkabilir; aynı SANİYEDE aynı türden iki satır
 * ise gerçek bir tekrardır ve elenir. Zaman farkı olanlar KORUNUR — geçmişi
 * seyreltmek dolgunun amacına ters.
 */
export async function saveEventsHistorical(
  vehicleId: string,
  events: FlespiEvent[]
): Promise<number> {
  if (events.length === 0) return 0;
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const key = `${e.event_type}|${e.occurred_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      vehicle_id: vehicleId,
      event_type: e.event_type,
      event_value: e.event_value,
      latitude: e.latitude,
      longitude: e.longitude,
      speed_kmh: e.speed_kmh,
      occurred_at: e.occurred_at,
    });
  }
  if (rows.length === 0) return 0;

  let written = 0;
  // 500'lük parçalar: tek istekte 20 binlik gövde PostgREST'i zorlar.
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from("vehicle_events")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "vehicle_id,event_type,occurred_at",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(error.message);
    written += data?.length ?? 0;
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RÖLANTİ — imleç yok sayılır, epizodlar bellekte kurulur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Epizodlar tamamen BELLEKTE kurulur ve yalnız KAPANMIŞ olanlar yazılır.
 *
 * Neden açık epizod yazılmıyor: `uq_idle_open_per_vehicle`, araç başına tek
 * `ended_at is null` satırına izin veriyor. Canlı akışın o an açık bir epizodu
 * varsa, tarihsel açık epizod 23505 ile çakışır ve dolgu düşerdi. Pencerenin
 * sonunda hâlâ açık kalan epizod `gap_timeout` ile son görülen ana kapatılır —
 * gözlemlenmemiş süre asla sayılmaz (canlı `reconcileIdleEpisodes` ile aynı
 * ilke).
 *
 * Kapanış sebepleri canlı durum makinesiyle aynı: idle_off / ignition_off /
 * moving / gap_timeout.
 */
export async function saveIdleHistorical(
  vehicleId: string,
  readings: IdleReading[]
): Promise<number> {
  if (readings.length === 0) return 0;
  const sorted = [...readings].sort((a, b) => a.ts - b.ts);

  type Epi = {
    started_at: string;
    last_seen_at: string;
    ended_at: string;
    end_reason: string;
    latitude: number | null;
    longitude: number | null;
  };
  const done: Epi[] = [];
  let open: Omit<Epi, "ended_at" | "end_reason"> | null = null;

  const close = (reason: string, at: string) => {
    if (!open) return;
    done.push({ ...open, ended_at: at, end_reason: reason });
    open = null;
  };

  let prevMs: number | null = null;
  for (const r of sorted) {
    const nowMs = r.ts * 1000;
    // Sinyal boşluğu: açık epizod SON GÖRÜLEN anda kapanır, boşluk sayılmaz.
    if (open && prevMs !== null && nowMs - prevMs > MAX_GAP_MS) {
      close("gap_timeout", open.last_seen_at);
    }
    prevMs = nowMs;

    if (r.idle === true) {
      if (!open) {
        open = {
          started_at: r.occurred_at,
          last_seen_at: r.occurred_at,
          latitude: r.latitude,
          longitude: r.longitude,
        };
      } else {
        open.last_seen_at = r.occurred_at;
      }
      continue;
    }
    if (!open) continue;
    if (r.idle === false) close("idle_off", r.occurred_at);
    else if (r.ignition_on === false) close("ignition_off", r.occurred_at);
    else if (r.speed_kmh !== null && r.speed_kmh >= IDLE_SPEED_THRESHOLD_KMH) {
      close("moving", r.occurred_at);
    }
  }
  // Pencere sonunda açık kalan: son görülen anda kapat (açık YAZILMAZ).
  if (open) close("gap_timeout", open.last_seen_at);

  if (done.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < done.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from("idle_episodes")
      .insert(done.slice(i, i + 500).map((e) => ({ vehicle_id: vehicleId, ...e })))
      .select("id");
    if (error) throw new Error(error.message);
    written += data?.length ?? 0;
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) VARDİYA — "bugün" yerine İŞLENEN GÜN
// ─────────────────────────────────────────────────────────────────────────────

type DayRow = {
  recorded_at: string;
  ignition_on: boolean | null;
  speed_kmh: number | null;
  odometer_km: number | null;
};

/**
 * Pencereye düşen HER Viyana günü için bir vardiya üretir.
 *
 * Canlı motorun `startOfTodayVienna()` sabitinin yerini, döngüdeki günün
 * başlangıcı alır — tetik mantığı aynıdır:
 *   başlangıç = o günün İLK kontak-açık telemetrisi ('first_ignition' tetiği,
 *               galzura-demo'nun SHIFT_START_TRIGGER'ı)
 *   bitiş     = o günün SON "yaşam belirtisi" (kontak açık ya da hız ≥ 5)
 *
 * "Günde tek vardiya" kuralı korunur: şoförün o gün zaten bir vardiyası varsa
 * (canlı akış ya da önceki dolgu turu yazmış olabilir) gün ATLANIR.
 *
 * ⚠️ `end_reason` 'auto_idle' — migration 020'deki CHECK yalnız
 * ('manual','auto_idle','watchdog','admin') kabul ediyor, 'backfill' diye bir
 * değer YOK. Kaydın dolgudan geldiği `auto_started`+`auto_ended`+`start_source`
 * üçlüsünden zaten okunuyor.
 */
export async function buildShiftsHistorical(
  vehicleId: string,
  workerId: string,
  plate: string,
  fromMs: number,
  toMs: number
): Promise<number> {
  let created = 0;
  let day = startOfDayVienna(new Date(fromMs));
  const son = startOfDayVienna(new Date(toMs));

  for (let guard = 0; guard < 400 && day.getTime() <= son.getTime(); guard++) {
    const dayStart = day;
    const dayEnd = addCalendarDaysVienna(day, 1);
    day = dayEnd;

    // Şoförün o gün vardiyası var mı? (günde tek vardiya)
    const { count } = await supabaseAdmin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("worker_id", workerId)
      .gte("started_at", dayStart.toISOString())
      .lt("started_at", dayEnd.toISOString());
    if ((count ?? 0) > 0) continue;

    const { data, error } = await supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at, ignition_on, speed_kmh, odometer_km")
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", dayStart.toISOString())
      .lt("recorded_at", dayEnd.toISOString())
      .order("recorded_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DayRow[];
    if (rows.length === 0) continue;

    const start = rows.find((r) => r.ignition_on === true);
    if (!start) continue; // o gün hiç çalıştırılmamış → vardiya yok

    let end: DayRow | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.ignition_on === true || (r.speed_kmh !== null && r.speed_kmh >= MOVE_SPEED_KMH)) {
        end = r;
        break;
      }
    }
    if (!end || new Date(end.recorded_at).getTime() <= new Date(start.recorded_at).getTime()) {
      continue;
    }

    // start_km NOT NULL (migration 001). Odometre yoksa 0 — uydurma km yazmayız.
    const odoIlk = rows.find((r) => r.odometer_km !== null)?.odometer_km ?? null;
    let odoSon: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].odometer_km !== null) { odoSon = rows[i].odometer_km; break; }
    }

    const { error: insErr } = await supabaseAdmin.from("time_entries").insert({
      worker_id: workerId,
      vehicle_id: vehicleId,
      plate,
      started_at: start.recorded_at,
      ended_at: end.recorded_at,
      start_km: odoIlk === null ? 0 : Math.round(odoIlk),
      end_km: odoSon === null ? null : Math.round(odoSon),
      break_minutes: 0,
      auto_started: true,
      auto_ended: true,
      end_reason: "auto_idle",
      start_source: "auto",
      confirmation_status: "confirmed",
      confirmed_at: start.recorded_at,
      summary_notified_at: new Date().toISOString(), // özet imza akışı tetiklenmesin
    });
    // 23505 = aynı gün başka bir yol vardiya açmış; sessizce geç.
    if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
    if (!insErr) created++;
  }
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) TEK ARAÇ — uçtan uca
// ─────────────────────────────────────────────────────────────────────────────

export async function backfillVehicle(v: {
  id: string;
  plate: string;
  flespi_device_id: number;
  assigned_worker_id: string | null;
}, fromMs: number, toMs: number, dryRun: boolean): Promise<VehicleBackfill> {
  const out: VehicleBackfill = {
    plate: v.plate, fetched: 0, telemetry: 0, events: 0, idle: 0, shifts: 0, pages: 0,
  };
  const { points, events, idle, pages } = await fetchWindowPaged(
    v.flespi_device_id,
    Math.floor(fromMs / 1000),
    Math.floor(toMs / 1000)
  );
  out.fetched = points.length;
  out.pages = pages;
  if (dryRun) return out;

  out.telemetry = await saveTelemetry(v.id, points);
  // Her katman kendi try/catch'inde: biri patlarsa diğerleri yazılmış kalır ve
  // hata araç satırında görünür (canlı sync'in deseni).
  try { out.events = await saveEventsHistorical(v.id, events); }
  catch (e) { out.error = `events: ${e instanceof Error ? e.message : e}`; }
  try { out.idle = await saveIdleHistorical(v.id, idle); }
  catch (e) { out.error = `${out.error ?? ""} idle: ${e instanceof Error ? e.message : e}`.trim(); }
  if (v.assigned_worker_id) {
    try {
      out.shifts = await buildShiftsHistorical(v.id, v.assigned_worker_id, v.plate, fromMs, toMs);
    } catch (e) {
      out.error = `${out.error ?? ""} shifts: ${e instanceof Error ? e.message : e}`.trim();
    }
  }
  return out;
}
