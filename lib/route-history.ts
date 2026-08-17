import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listVehicleTrack } from "@/lib/telemetry";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { gunPenceresi, seyrelt } from "@/lib/vehicle-day";

export type RoutePoint = {
  lat: number;
  lng: number;
  t: string;
  /** Device course 0..359, when the source carries it (device GPS). Phone-GPS
   *  (driver_locations) routes leave it undefined. */
  heading?: number | null;
  /**
   * Speed at the fix, km/h — and ignition state, both straight off the device.
   *
   * 10.08.2026: `listVehicleTrack` has ALWAYS selected these two columns and
   * `getVehicleDeviceRoute` was throwing them away in the `.map()` below. The
   * replay scrubber therefore had no km/h to print and no way to tell a moving
   * vehicle from a parked-with-engine-on one. Additive: the panel's RouteReplay
   * reads neither field today, so nothing on that screen changes; the mobile
   * route endpoint (/api/mobile/vehicles/[id]/rota) is the first consumer.
   *
   * Optional, not null-typed, because phone-GPS routes never had them.
   */
  speed?: number | null;
  ignition?: boolean | null;
};
export type LatLng = [number, number];

export type RouteDay = {
  date: string; // YYYY-MM-DD (Vienna)
  points: RoutePoint[];
  /** Road-snapped polyline (map-matched). Falls back to raw points if matching
   *  is unavailable. This is what the map draws & the marker travels along. */
  geometry: LatLng[];
  matched: boolean;
  plate: string | null;
  driverName: string | null;
  driverId: string | null;
  totalRaw: number; // point count before sampling (for the UI hint)
  /** When true the replay marker is a heading arrow (the source has course
   *  data, i.e. device GPS) instead of a plain pin. Driver routes leave unset. */
  directional?: boolean;

  /**
   * ── ÖZET ŞERİDİ (17.08.2026) ──────────────────────────────────────────────
   *
   * Neden eklendi: oynatıcıdaki tek sayı o anki noktanın SAATİydi ve yanında
   * hiçbir bağlam yoktu — kullanıcı onu "süre" sanıp "her gün aynı, bozuk"
   * sonucuna vardı (canlı gözlem, 17.08.2026). Bağlam artık ekranda.
   *
   * Dördü de OPSİYONEL: yoksa şerit hiç basılmaz ve eski davranış birebir
   * korunur. HAM izden hesaplanır — `points` 900'de örneklendiği için ondan
   * hesaplamak mesafeyi eksik gösterirdi.
   */
  /** Günün ilk fix'i (ISO) — özet şeridinin başlangıç saati. */
  firstAt?: string | null;
  /** Günün son fix'i (ISO) — özet şeridinin bitiş saati. */
  lastAt?: string | null;
  /** Ham izden GPS mesafesi (km, 1 ondalık). `computeDistanceKm` ile: park
   *  titremesi ve veri boşlukları o fonksiyonda zaten eleniyor. */
  distanceKm?: number | null;
  /**
   * Araç o gün fiilen HAREKET ETMEDİ (park + saatlik heartbeat).
   *
   * Ölçülen desen (17.08.2026, galzura-demo): park günü 24 nokta üretiyor ve
   * 24'ünün de koordinatı BİREBİR aynı → çizilecek yol yok; oynatıcı doğru
   * çalışsa bile ekranda hiçbir şey kıpırdamıyor ve kullanıcı bunu kırık
   * özellik sanıyor. Bayrak, ekranın "bu araç bu tarihte hareket etmedi"
   * diyebilmesi için var — boş durumda sessiz kalmak arızaya dönüşüyor.
   */
  stationary?: boolean;
};

/** Bu mesafenin altındaki gün "hareket etmedi" sayılır (km). Depo içi manevra
 *  ve GPS titremesi bu bandın altında kalır; gerçek bir çıkış kalmaz. */
const STATIONARY_KM = 0.2;

const OSRM_MATCH = "https://router.project-osrm.org/match/v1/driving/";
const MATCH_INPUT_MAX = 180; // coords sent to OSRM (it returns a dense geometry)
const MATCH_CHUNK = 90; // OSRM public demo coordinate cap per request

async function matchChunk(chunk: RoutePoint[]): Promise<LatLng[] | null> {
  if (chunk.length < 2) return null;
  const coords = chunk.map((p) => `${p.lng},${p.lat}`).join(";");
  const radiuses = chunk.map(() => "25").join(";");
  const url = `${OSRM_MATCH}${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      matchings?: { geometry: { coordinates: [number, number][] } }[];
    };
    if (data.code !== "Ok" || !data.matchings?.length) return null;
    const out: LatLng[] = [];
    for (const m of data.matchings) {
      for (const c of m.geometry.coordinates) out.push([c[1], c[0]]);
    }
    return out.length ? out : null;
  } catch {
    return null; // timeout / network / parse → caller falls back to raw
  }
}

/**
 * Snap a GPS track to the road network via OSRM Match. Chunks long tracks to the
 * public server's coordinate cap and runs them in parallel. Any failed chunk
 * (or a track too short) falls back to the raw straight-line coordinates, so the
 * caller never errors and always gets a drawable polyline.
 */
async function buildMatchedGeometry(
  points: RoutePoint[]
): Promise<{ geometry: LatLng[]; matched: boolean }> {
  const raw: LatLng[] = points.map((p) => [p.lat, p.lng]);
  if (points.length < 3) return { geometry: raw, matched: false };

  const input = seyrelt(points, MATCH_INPUT_MAX);
  const chunks: RoutePoint[][] = [];
  for (let i = 0; i < input.length; i += MATCH_CHUNK - 1) {
    chunks.push(input.slice(i, i + MATCH_CHUNK));
    if (i + MATCH_CHUNK >= input.length) break;
  }

  const results = await Promise.all(
    chunks.map((ch) => matchChunk(ch).then((m) => ({ m, ch })))
  );

  let any = false;
  const geometry: LatLng[] = [];
  for (const { m, ch } of results) {
    const seg: LatLng[] = m ?? ch.map((p) => [p.lat, p.lng] as LatLng);
    if (m) any = true;
    for (let j = 0; j < seg.length; j++) {
      if (geometry.length && j === 0) continue; // dedupe the chunk join
      geometry.push(seg[j]);
    }
  }
  return { geometry: geometry.length > 1 ? geometry : raw, matched: any };
}

const MAX_POINTS = 900; // keep replay smooth even on long days

/** Empty day — unparseable date, or a vehicle with no fixes that day. */
function bosGun(date: string, plate: string | null): RouteDay {
  return {
    date,
    points: [],
    geometry: [],
    matched: false,
    totalRaw: 0,
    plate,
    driverName: null,
    driverId: null,
  };
}

/*
 * TELEFON GPS'İ KALDIRILDI (21.07.2026). Buradaki iki fonksiyon —
 * getWorkerRoute (şoförün telefon izleri) ve getVehicleRoute (aynı izlerin
 * araca göre gruplanmışı) — `driver_locations` okuyordu. Rota takibinin tek
 * kaynağı artık araç cihazıdır (FMC003 → device_telemetry); aşağıdaki
 * getVehicleDeviceRoute o hattı kullanır. `driver_locations` tablosu geçmiş
 * veri olarak DURUYOR, yalnız hiçbir yerde okunmuyor.
 */
/**
 * Route of a vehicle on a given day from its OWN hardware tracker
 * (device_telemetry) — the FMC003's 24/7 GPS, independent of any phone or open
 * shift. Mirrors getVehicleRoute's RouteDay shape so RouteReplay renders it
 * unchanged, but the line AND the marker heading come from the device, not from
 * driver_locations. Built on listVehicleTrack, the shared telemetry-series base.
 */
export async function getVehicleDeviceRoute(
  vehicleId: string,
  date: string,
  /**
   * `match: false` skips the OSRM road-snapping round-trip and returns the raw
   * straight-line geometry. The panel keeps the default (true) — the mobile
   * endpoint turns it off, because OSRM is a 6-second EXTERNAL dependency and a
   * phone-sized preview line does not earn it (same call the shift-detail
   * endpoint already made).
   */
  opts: { match?: boolean } = {}
): Promise<RouteDay> {
  /**
   * ── PENCERE: ±1 GÜN PARANTEZİ → KESİN KİRACI GÜNÜ (11.08.2026) ───────────
   *
   * Eskiden gün, ±1 günlük bir UTC parantezinde okunup `viennaDayKey` ile
   * süzülüyordu — yani üç günün satırları çekilip ikisi atılıyordu. Kesin
   * kiracı-gün sınırı (`gunPenceresi`, lib/format.ts'in DST-güvenli
   * yardımcıları) aynı kümeyi doğrudan seçiyor. ÖLÇÜLDÜ (canlı HAK61, 5 araç-gün,
   * her biri 3 tur): dönen nokta dizisi BİREBİR aynı, okunan satır 2,7× az,
   * süre ~3,0 sn → ~0,9 sn. Panelin rota sayfası da bu fonksiyonu çağırıyor.
   *
   * Süzgeç KALDIRILDI çünkü artık hiçbir şeyi elemiyor — ve ucuz da değildi:
   * satır başına bir `Intl` çağrısıydı (yoğun günde 4.000+ kez).
   *
   * ⚠️ Teorik tek fark: sorgu `.lte(gün sonu)` ile kapanıyor ve gün sonu
   * milisaniye çözünürlüğünde (23:59:59.999). 23:59:59.9991-23:59:59.9999
   * bandındaki bir satır eskiden gelirdi, artık gelmez. `device_telemetry`
   * damgaları santisaniye çözünürlüğünde (ör. "04:50:08.01") — o bantta satır
   * ÜRETİLEMEZ. Beş araç-günün beşinde de fark 0 ölçüldü.
   */
  const pencere = gunPenceresi(date);
  // Plaka ve iz PARALEL okunur (eski davranış). Geçersiz tarihte iz sorgusu
  // hiç açılmaz ama plaka yine gelir — boş gün ekranı başlığını yazabilsin.
  const [{ data: vehicle }, track] = await Promise.all([
    supabaseAdmin.from("vehicles").select("plate").eq("id", vehicleId).maybeSingle(),
    pencere ? listVehicleTrack(vehicleId, pencere.baslangic, pencere.bitis) : [],
  ]);
  const plate = (vehicle?.plate as string) ?? null;
  // Ayrıştırılamayan tarih artık BOŞ GÜN döndürür. Eskiden `new Date("çöp")`
  // üzerinden `toISOString()` RangeError atıyor ve panel sayfasını komple
  // düşürüyordu (`?date=` elle düzenlenebilir bir arama parametresi).
  if (!pencere) return bosGun(date, plate);

  const rawPts: RoutePoint[] = track.map((r) => ({
    lat: r.latitude,
    lng: r.longitude,
    t: r.recorded_at,
    heading: r.heading,
    speed: r.speed_kmh,
    ignition: r.ignition_on,
  }));

  const points = seyrelt(rawPts, MAX_POINTS);
  const { geometry, matched } =
    opts.match === false
      ? { geometry: points.map((p) => [p.lat, p.lng] as LatLng), matched: false }
      : await buildMatchedGeometry(points);
  // Show the heading arrow only if the device actually reported a course.
  const directional = rawPts.some((p) => p.heading !== null && p.heading !== undefined);

  // ── Özet şeridi + hareketsizlik (17.08.2026) ──────────────────────────────
  // HAM iz üzerinden: `points` 900'de örneklenmiş olabilir, mesafe ondan
  // hesaplanırsa eksik çıkar. `computeDistanceKm` park titremesini (D_MIN_M) ve
  // veri boşluklarını (GAP_MAX_MS) zaten eliyor, yani "gerçekten kat edilen"i
  // veriyor — hareketsizlik eşiği de bu yüzden ona dayanıyor.
  const mesafe = computeDistanceKm(track);
  const distanceKm = mesafe.points > 0 ? Math.round(mesafe.km * 10) / 10 : null;
  const stationary =
    rawPts.length > 0 && distanceKm !== null && distanceKm < STATIONARY_KM;

  return {
    date,
    points,
    geometry,
    matched,
    totalRaw: rawPts.length,
    plate,
    driverName: null, // vehicle-centric track — no driver label
    driverId: vehicleId, // replay reset key
    directional,
    firstAt: rawPts.length ? rawPts[0].t : null,
    lastAt: rawPts.length ? rawPts[rawPts.length - 1].t : null,
    distanceKm,
    stationary,
  };
}
