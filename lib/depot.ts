import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listVehicleTrack } from "@/lib/telemetry";
import { pointInCircleM } from "@/lib/geo";

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

/** Depoda "şu an içeride" saymak için son fix bu kadar taze olmalı. */
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
async function activeDepotZones(): Promise<DepotZone[]> {
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
