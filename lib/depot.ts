import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listVehicleTrack, latestVehicleTelemetry } from "@/lib/telemetry";
import { pointInCircleM } from "@/lib/geo";
import { todayYmdVienna } from "@/lib/leaves";
import { startOfTodayVienna } from "@/lib/format";

/**
 * DEPO-GİRİŞ VARDİYA ÖNERİSİ (Modül 3).
 *
 * Araç bir "depo" bölgesine (geofences.purpose='depot') girip orada 3 DAKİKA
 * (histerezis) kaldığında, şoförün panelinde "mesaiyi başlat?" ÖNERİSİ çıkar —
 * OTOMATİK BAŞLATMA YOK (auto-shift ile yarışır, çift-açılış olur; ayrıca
 * otomatik-kapanış felaketinin dersi). Öneri + tek dokunuş; şoför kapatabilir,
 * manuel başlatma her zaman açık kalır.
 *
 * Mesai depoda başlar (ev→depo yolu = commute, mesai değil): startShiftManualAction
 * zaten "şimdi" başlatır (kontak-açılmaya geri sarmaz), dokunuş anı ≈ varış anı.
 *
 * Best-effort: purpose kolonu / bölge yoksa ya da telemetri okunamazsa null →
 * öneri sessizce çıkmaz, mevcut bekleme ekranı aynen çalışır.
 */

/**
 * KİLİT için "güncel" eşiği: 90 dk (Modül 6). Park eden sağlıklı cihaz saatlik
 * heartbeat atar → son fix ≤~60 dk. 90 dk içinde fix varsa cihaz CANLI kabul
 * edilir (konum güvenilir). Aşarsa cihaz sessiz → konum DOĞRULANAMAZ ('unknown':
 * "evde park (engelle)" ile "cihaz ölü (izin ver+işaretle)" ayrımının anahtarı).
 */
const FRESH_STATE_MS = 90 * 60 * 1000;

/** Depoda "şu an içeride" saymak için son fix bu kadar taze olmalı (öneri). */
const FRESH_MS = 10 * 60 * 1000;
/** Histerezis: depoda en az bu kadar süre kalınmış olmalı (yoldan geçiş elenir). */
const DWELL_MS = 3 * 60 * 1000;
/** Giriş anını bulmak için geriye bu kadar telemetri taranır. */
const LOOKBACK_MS = 25 * 60 * 1000;

export type DepotArrival = { enteredAt: string; zoneName: string };

type DepotZone = {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
};

/** Aktif depo bölgeleri (worker-safe: requireAdmin YOK, hassas veri değil). */
export async function activeDepotZones(): Promise<DepotZone[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("geofences")
      .select("id, name, center_lat, center_lng, radius_m")
      .eq("active", true)
      .eq("purpose", "depot");
    if (error || !data) return [];
    return data as DepotZone[];
  } catch {
    return [];
  }
}

/**
 * Araç ŞU AN bir depo bölgesinde mi ve orada ≥3 dk mı? Öyleyse giriş anını
 * ("önerilen başlangıç" bağlamı) döndürür; değilse null.
 */
export async function getDepotSuggestion(
  vehicleId: string
): Promise<DepotArrival | null> {
  const zones = await activeDepotZones();
  if (zones.length === 0) return null;

  const now = Date.now();
  let track;
  try {
    track = await listVehicleTrack(
      vehicleId,
      new Date(now - LOOKBACK_MS),
      new Date(now)
    );
  } catch {
    return null;
  }
  if (!track || track.length === 0) return null;

  const rows = [...track].sort(
    (a, b) =>
      new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const zoneOf = (lat: number, lng: number) =>
    zones.find((z) => pointInCircleM(lat, lng, z.center_lat, z.center_lng, z.radius_m)) ??
    null;

  const latest = rows[rows.length - 1];
  if (now - new Date(latest.recorded_at).getTime() > FRESH_MS) return null; // bayat
  const latestZone = zoneOf(latest.latitude, latest.longitude);
  if (!latestZone) return null; // şu an depoda değil

  // Giriş anı: sondan geriye, aracın AYNI depoda kesintisiz olduğu ilk fix.
  let enteredAt = latest.recorded_at;
  for (let i = rows.length - 2; i >= 0; i--) {
    const z = zoneOf(rows[i].latitude, rows[i].longitude);
    if (z && z.id === latestZone.id) enteredAt = rows[i].recorded_at;
    else break;
  }

  // Histerezis: en az 3 dk depoda kalınmış olmalı (depo yanından geçiş elenir).
  if (now - new Date(enteredAt).getTime() < DWELL_MS) return null;

  return { enteredAt, zoneName: latestZone.name };
}

// ───────────────────────── DEPO KİLİDİ (Modül 6) ─────────────────────────
//
// KURAL: mesai depoda başlar. Aracın konumu depo dışındaysa (canlı telemetriyle
// KESİN dışarıda) yeni vardiya AÇILMAZ. Belirsiz/cihaz-ölü ya da yönetici
// muafiyetinde izin verilir ama "konum doğrulanamadı" işareti düşer. ASLA
// kilitlenme: yalnız kesin-dışarıda engelle, belirsiz her durumda izin ver.

export type DepotStateKind = "in" | "out" | "unknown" | "no_depot";

/** Aracın son fix'ine göre depo durumu (kilit için). Depo yoksa 'no_depot'. */
async function depotLocationState(
  vehicleId: string,
  zones: DepotZone[]
): Promise<DepotStateKind> {
  if (zones.length === 0) return "no_depot";
  let latest;
  try {
    latest = await latestVehicleTelemetry(vehicleId);
  } catch {
    return "unknown";
  }
  if (!latest || latest.latitude == null || latest.longitude == null) return "unknown";
  if (Date.now() - new Date(latest.recorded_at).getTime() > FRESH_STATE_MS) {
    return "unknown"; // cihaz sessiz → konum doğrulanamaz
  }
  const inZone = zones.some((z) =>
    pointInCircleM(latest.latitude, latest.longitude, z.center_lat, z.center_lng, z.radius_m)
  );
  return inZone ? "in" : "out";
}

/** Yönetici bu şoför için BUGÜN depo şartını kaldırmış mı? Best-effort. */
export async function hasDepotExemption(
  workerId: string,
  dayYmd: string = todayYmdVienna()
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("depot_exemptions")
      .select("id")
      .eq("worker_id", workerId)
      .eq("exempt_date", dayYmd)
      .limit(1)
      .maybeSingle();
    if (error || !data) return false;
    return true;
  } catch {
    return false;
  }
}

export type DepotGate = {
  /** true → vardiya AÇILMAZ (kesin depo dışı + muafiyet yok). */
  blocked: boolean;
  /** true → açıldı ama konum doğrulanamadı (unknown / muafiyet) → işaretle. */
  unverified: boolean;
  state: DepotStateKind;
};

/**
 * SUNUCU KAPISI (startShiftManualAction bunu çağırır — buton UX yeterli değil,
 * action fail-closed olmalı). Depo yoksa kilit yok. Kesin dışarı + muafiyet yok
 * → blocked. İçeride → temiz. Belirsiz ya da muafiyet → izin + unverified.
 */
export async function evaluateDepotGate(
  vehicleId: string,
  workerId: string
): Promise<DepotGate> {
  const zones = await activeDepotZones();
  if (zones.length === 0) return { blocked: false, unverified: false, state: "no_depot" };
  const state = await depotLocationState(vehicleId, zones);
  if (state === "in") return { blocked: false, unverified: false, state };
  const exempt = await hasDepotExemption(workerId);
  if (state === "out") {
    return exempt
      ? { blocked: false, unverified: true, state }
      : { blocked: true, unverified: false, state };
  }
  // unknown → izin ver + işaretle (cihaz ölü/sinyal yok meşru şoförü kilitlemesin)
  return { blocked: false, unverified: true, state };
}

/** Panelin butonu kilitlemesi + öneri banner'ı için birleşik durum. */
export type DepotPanel = {
  locked: boolean;
  state: DepotStateKind;
  enteredAt: string | null;
  zoneName: string | null;
};

export async function getDepotPanel(
  vehicleId: string,
  workerId: string
): Promise<DepotPanel> {
  const zones = await activeDepotZones();
  if (zones.length === 0)
    return { locked: false, state: "no_depot", enteredAt: null, zoneName: null };
  const state = await depotLocationState(vehicleId, zones);
  const exempt = state === "in" ? false : await hasDepotExemption(workerId);
  const locked = state === "out" && !exempt;
  let enteredAt: string | null = null;
  let zoneName: string | null = null;
  if (state === "in") {
    const s = await getDepotSuggestion(vehicleId);
    if (s) {
      enteredAt = s.enteredAt;
      zoneName = s.zoneName;
    }
  }
  return { locked, state, enteredAt, zoneName };
}

// ───────────────── DEPO-TETİKLİ OTOMATİK VARDİYA (Modül 7) ─────────────────

/**
 * Araç BUGÜN depoya girip mesaiye başladı mı? Otomatik vardiya TETİĞİ.
 *
 * Başlangıç anı = bugünün İLK "depo içi + kontak açık" fix'i. Bu, iki durumu da
 * doğru çözer:
 *   • Evden gelen kamyon: kontak evde açık gelir; depo dışı fixler sayılmaz;
 *     ilk depo-içi fix = VARIŞ anı.
 *   • Depoda park etmiş kamyon: gece kontak kapalı (depo içi ama sayılmaz);
 *     şoför sabah kontağı açınca ilk "depo-içi + kontak açık" = MESAİ başlangıcı.
 * Böylece gece boyu depoda duran araç 00:00'da tetiklenmez.
 *
 * Histerezis: o fix'ten sonra depoda ≥3 dk KESİNTİSİZ kalınmış olmalı (depo
 * yanından/içinden geçiş elenir). Araç sonradan çıkmış olsa da (kaçırılan giriş
 * / dağıtıma çıkmış) tetik geçerlidir — bugün depoya girip çalıştığı kesin.
 *
 * Best-effort: depo yoksa / telemetri yoksa null.
 */
export async function depotArrivalTrigger(
  vehicleId: string
): Promise<{ startAt: string } | null> {
  const zones = await activeDepotZones();
  if (zones.length === 0) return null;
  let rows;
  try {
    const { data, error } = await supabaseAdmin
      .from("device_telemetry")
      .select("latitude, longitude, ignition_on, recorded_at")
      .eq("vehicle_id", vehicleId)
      .gte("recorded_at", startOfTodayVienna().toISOString())
      .order("recorded_at", { ascending: true })
      .limit(3000);
    if (error || !data) return null;
    rows = data.filter(
      (t) => t.latitude != null && t.longitude != null
    ) as {
      latitude: number;
      longitude: number;
      ignition_on: boolean | null;
      recorded_at: string;
    }[];
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const inZone = (lat: number, lng: number) =>
    zones.some((z) => pointInCircleM(lat, lng, z.center_lat, z.center_lng, z.radius_m));

  // Bugünün ilk "depo içi + kontak açık" fix'i = mesai başlangıcı.
  let startIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].ignition_on === true && inZone(rows[i].latitude, rows[i].longitude)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  // Histerezis: o andan itibaren depoda ≥3 dk kesintisiz kalınmış mı?
  const startMs = new Date(rows[startIdx].recorded_at).getTime();
  let lastInZoneMs = startMs;
  for (let i = startIdx; i < rows.length; i++) {
    if (inZone(rows[i].latitude, rows[i].longitude)) {
      lastInZoneMs = new Date(rows[i].recorded_at).getTime();
    } else break;
  }
  if (lastInZoneMs - startMs < DWELL_MS) return null;

  return { startAt: rows[startIdx].recorded_at };
}
