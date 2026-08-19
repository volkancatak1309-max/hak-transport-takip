import "server-only";
import { supabaseAdmin, fetchPagesUntil } from "@/lib/supabase";
import { listVehicleTrack, latestVehicleTelemetry } from "@/lib/telemetry";
import { pointInCircleM } from "@/lib/geo";
import { todayYmdVienna } from "@/lib/leaves";
import {
  startOfTodayVienna,
  startOfDayVienna,
  addCalendarDaysVienna,
} from "@/lib/format";
import { TENANT_TZ } from "@/lib/tz";
import { turMemo } from "@/lib/query-counter";

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

/**
 * Aktif depo bölgeleri (worker-safe: requireAdmin YOK, hassas veri değil).
 *
 * TUR İÇİNDE TEK SORGU (#84 Adım 4 / Bekleyen-Isler #83, 19.08.2026).
 * Bu fonksiyon 7 ayrı yerden çağrılıyor ve bazıları araç döngüsünün içinde;
 * her çağrı DB'ye gidiyordu. Ölçüldü: senkron turu başına 6-7 `geofences`
 * sorgusu. Depo bölgeleri bir tur boyunca DEĞİŞMEZ, dolayısıyla tekrar okumak
 * saf israftı.
 *
 * `turMemo` yalnız senkron turunun kabı içinde önbellekler; panel sayfaları ve
 * diğer rotalar için davranış BİREBİR aynı kalır (kap yoksa doğrudan okur).
 * Önbellek tek tur kadar yaşar → iki tur arasında taşınmaz, bayat veri riski
 * yok.
 */
export async function activeDepotZones(): Promise<DepotZone[]> {
  return turMemo("activeDepotZones", async () => {
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
  });
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
  const todayStart = startOfTodayVienna();
  const startAt = await firstDepotEntryInRange(
    vehicleId,
    todayStart.toISOString(),
    // Üst sınır YOK demek yerine gün sonunu veriyoruz: aralık ne kadar darsa
    // indeks taraması o kadar ucuz.
    addCalendarDaysVienna(todayStart, 1).toISOString(),
    zones
  );
  return startAt ? { startAt } : null;
}

/**
 * Bir aracın verilen aralıktaki "depoya ilk geliş" anı — TEK sorgu değil,
 * SAYFALI okuma (25.07.2026).
 *
 * Neden: PostgREST sorgu başına 1000 satır döndürüyor ve `.limit(3000)` bunu
 * aşmıyordu; fazlası SESSİZCE kırpılıyordu. Yoğun bir araçta günlük fix sayısı
 * 1930–3127, yani bir GÜN bile tek sayfaya sığmıyor. Artan sıralama sayesinde
 * kırpılan kısım günün sonuydu ve tetik sabahı gördüğü için hata bugüne dek
 * patlamadı — ama öğleden sonra çağrıldığında kör kalırdı.
 *
 * Erken çıkış: geliş anı tipik olarak ilk sayfada bulunur ve kalan sayfalar hiç
 * okunmaz; bulunamazsa aralığın SONUNA kadar taranır. `probe` birikmiş satırların
 * tamamını alır, çünkü 3 dakikalık histerezis sayfa sınırına denk gelebilir.
 *
 * DIŞA AÇIK (15.08.2026) — yalnız geriye dönük ÖLÇÜM betikleri için
 * (scripts/measure-depo-geridonuk.mjs). Üretimde çağıran hâlâ yalnız bu dosya.
 * Alternatif "ölçüm betiği algoritmayı kopyalasın" olurdu ve o kopya ilk
 * değişiklikte üretimden sapıp yanlış rapor üretirdi.
 */
export async function firstDepotEntryInRange(
  vehicleId: string,
  fromIso: string,
  toIso: string,
  zones: DepotZone[]
): Promise<string | null> {
  try {
    const { result } = await fetchPagesUntil<TelemetryFix, string>(
      (from, to) =>
        supabaseAdmin
          .from("device_telemetry")
          .select("latitude, longitude, ignition_on, recorded_at")
          .eq("vehicle_id", vehicleId)
          .gte("recorded_at", fromIso)
          .lt("recorded_at", toIso)
          .order("recorded_at", { ascending: true })
          .order("id")
          .range(from, to),
      (rows) =>
        firstDepotEntryIn(
          rows.filter((t) => t.latitude != null && t.longitude != null),
          zones
        ),
      `depotArrival(${fromIso.slice(0, 10)})`
    );
    return result;
  } catch {
    return null;
  }
}

type TelemetryFix = {
  latitude: number;
  longitude: number;
  ignition_on: boolean | null;
  recorded_at: string;
};

/**
 * ORTAK ÇEKİRDEK: verilen (zamana göre ARTAN sıralı, tek güne ait) fix dizisinde
 * "depoya ilk geliş" anını bulur. depotArrivalTrigger (bugün) ile geçmiş-gün
 * ortalaması AYNI tanımı kullansın diye ayrıldı — iki yerde çatallanan bir
 * "geliş anı" tanımı, ortalamayı bugünle kıyaslanamaz hâle getirirdi.
 *
 * Tanım (değişmedi): ilk "depo içi + KONTAK AÇIK" fix + o andan itibaren ≥3 dk
 * kesintisiz depoda kalma. Kontak şartı bilinçli: depoda geceleyen aracın
 * gece heartbeat'leri aksi hâlde geliş anını 00:00'a çekerdi.
 *
 * ⚠️ TEĞET-GEÇME KÖRLÜĞÜ (düzeltildi 27.07.2026). Eski sürüm günün İLK adayını
 * bulup histerezisi orada sınıyor, tutmazsa null dönüp PES EDİYORDU — sonraki
 * adaylara hiç bakmıyordu. Depo çemberini yolda tek fix'lik teğet geçen araçta
 * (500 m yarıçap ana yolu kesiyor) tetik BÜTÜN GÜN ölü kalıyordu. 27.07.2026
 * canlı ölçümü, tek günde beş araç:
 *   DO-623GL teğet 04:30:57 (1 fix) → gerçek duruş 04:58–07:30 (152 dk) kaçtı
 *   DO-992GO teğet 05:53:28 (1 fix) → gerçek duruş 06:18–08:55 (157 dk) kaçtı
 *   DO-753GS teğet 07:17:22 (1 fix) → gerçek duruş 07:19–09:02 (103 dk) kaçtı
 *   DO-945HL teğet 07:59:32 (2 fix) → gerçek duruş 08:00–09:03  (63 dk) kaçtı
 *   DO-775GS teğet 06:25:09 (2 fix) → gerçek duruş 06:37–07:53  (76 dk) kaçtı
 * Sonuncusunun bedeli en ağırdı: otomatik vardiya açılmadı, şoför de elle
 * açmadı, araç bütün gün kayıt DIŞI kaldı.
 *
 * Düzeltme: aday elenince tarama BİTMEZ — o depo-içi koşunun sonundan devam
 * eder ve günün TÜM adayları denenir. İlk ≥3 dk tutan aday geliş anıdır.
 * `averageDepotArrivalMinute` de aynı çekirdeği kullandığı için 14 günlük
 * ortalama kademesi kendiliğinden düzelir.
 */
function firstDepotEntryIn(rows: TelemetryFix[], zones: DepotZone[]): string | null {
  if (rows.length === 0) return null;

  const inZone = (lat: number, lng: number) =>
    zones.some((z) => pointInCircleM(lat, lng, z.center_lat, z.center_lng, z.radius_m));

  let i = 0;
  while (i < rows.length) {
    // Aday: "depo içi + kontak açık" ilk fix.
    if (!(rows[i].ignition_on === true && inZone(rows[i].latitude, rows[i].longitude))) {
      i++;
      continue;
    }

    // Histerezis: bu andan itibaren depoda ≥3 dk KESİNTİSİZ kalınmış mı?
    const startMs = new Date(rows[i].recorded_at).getTime();
    let lastInZoneMs = startMs;
    let j = i;
    while (j < rows.length && inZone(rows[j].latitude, rows[j].longitude)) {
      lastInZoneMs = new Date(rows[j].recorded_at).getTime();
      j++;
    }
    if (lastInZoneMs - startMs >= DWELL_MS) return rows[i].recorded_at;

    // Teğet geçiş: bu koşuyu TÜMDEN atla, sonraki adaya bak. `j > i` garanti
    // (rows[i] depo içi olduğu için iç döngü en az bir adım ilerler) → sonsuz
    // döngü olamaz.
    i = j;
  }
  return null;
}

// ─────────── MANUEL BAŞLATMADA BAŞLANGIÇ ANI (25.07.2026, Volkan) ───────────
//
// KURAL: manuel başlatmada started_at ARTIK "şimdi" DEĞİL. Şoför butona basma
// anını değil, aracın DEPOYA GELDİĞİ anı yazarız — mesai depoda başlar ve
// şoför çoğu zaman depoya vardıktan bir süre sonra panele dokunuyor.
//
// KESİN YASAK: kontak-açılma anı ve "günün ilk telemetrisi" başlangıç olarak
// KULLANILAMAZ. Kontağı evde açıp 1-2 saat sonra depoya gelen şoförler var;
// o an mesai başlangıcı değil, commute'un başıdır.
//
// Kademeler: (1) bugünkü depo girişi → (2) son 14 günün ortalama geliş saati →
// (3) now. 2 ve 3 "doğrulanmadı"dır → location_unverified işareti düşer.

/** Ortalama hesabında geriye bakılan Viyana günü sayısı. */
const AVG_LOOKBACK_DAYS = 14;

export type ResolvedShiftStart = {
  at: string;
  source: "depot_entry" | "avg_arrival" | "now";
  /** false → çağıran location_unverified=true yazar. */
  verified: boolean;
};

/** Bir ISO anın Viyana duvar-saatini gün-içi dakikaya çevirir (0–1439). */
function viennaMinuteOfDay(iso: string): number | null {
  const hm = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TENANT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Son 14 Viyana gününde aracın depoya İLK GELİŞ saatlerinin ortalaması
 * (gün-içi dakika). Hiç geliş bulunamazsa null.
 *
 * Tek sorgu: 14 günlük aralık bir kerede çekilir, sonra bellekte güne bölünür
 * (14 ayrı sorgu manuel başlatmanın gecikmesini görünür ölçüde artırırdı).
 */
async function averageDepotArrivalMinute(
  vehicleId: string,
  zones: DepotZone[]
): Promise<number | null> {
  const todayStart = startOfTodayVienna();

  // GÜN GÜN sorgulanır — 14 günü TEK sorguda çekmek 25.07.2026'ya kadar bu
  // fonksiyonu sessizce çürütüyordu: `.limit(40000)` isteniyor, PostgREST 1000
  // satır döndürüyordu (canlıda ölçüldü: gerçek 23.217 satırın %4'ü) ve dönen
  // dilim tek bir günün 4 saatiydi. Yani "14 günün ortalaması" fiilen tek kısmi
  // günden hesaplanıyordu — hata yok, ekranda belirti yok, sonuç yanlış.
  //
  // Her gün ayrı ve SAYFALI okunur; aranan şey günün başındaki ilk geliş olduğu
  // için erken çıkış tipik olarak günde tek sorguyla bitirir. 14 küçük sorgu,
  // bir büyük kırık sorgudan iyidir.
  const minutes: number[] = [];
  for (let d = AVG_LOOKBACK_DAYS; d >= 1; d--) {
    const dayStart = addCalendarDaysVienna(todayStart, -d);
    const dayEnd = addCalendarDaysVienna(todayStart, -d + 1);
    const entry = await firstDepotEntryInRange(
      vehicleId,
      dayStart.toISOString(),
      dayEnd.toISOString(),
      zones
    );
    if (!entry) continue; // o gün depoya gelinmemiş (izin/tatil) → ortalamaya girmez
    const min = viennaMinuteOfDay(entry);
    if (min !== null) minutes.push(min);
  }
  if (minutes.length === 0) return null;

  return Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
}

/**
 * MANUEL BAŞLATMANIN başlangıç anı. Asla throw etmez — her hata yolu `now`'a
 * düşer (kademe 3), yani başlatma hiçbir koşulda kırılmaz.
 */
export async function resolveShiftStartAt(
  vehicleId: string
): Promise<ResolvedShiftStart> {
  const nowIso = new Date().toISOString();
  try {
    const zones = await activeDepotZones();
    if (zones.length === 0) return { at: nowIso, source: "now", verified: false };

    // 1) Bugün depoya girildiyse: geliş anı.
    const trig = await depotArrivalTrigger(vehicleId);
    if (trig) return { at: trig.startAt, source: "depot_entry", verified: true };

    // 2) Bugün giriş yok → son 14 günün ortalama geliş saati, BUGÜNÜN tarihiyle.
    const avgMin = await averageDepotArrivalMinute(vehicleId, zones);
    if (avgMin !== null) {
      // Viyana gün başlangıcı + dakika. Yaz/kış saati geçiş gününde bu bir saat
      // kayabilir; kestirilmiş bir ortalama için kabul edilebilir sapma.
      const at = new Date(startOfDayVienna().getTime() + avgMin * 60_000);
      // Savunmacı: ortalama geleceği gösteriyorsa (gece yarısı sonrası başlatma)
      // gelecek bir başlangıç yazma — now'a düş.
      if (at.getTime() <= Date.now()) {
        return { at: at.toISOString(), source: "avg_arrival", verified: false };
      }
    }
  } catch {
    // yut → now
  }
  // 3) Hiç veri yok (yeni araç/cihaz) ya da hata.
  return { at: nowIso, source: "now", verified: false };
}

/**
 * ARACIN SON FIX'İ DEPODA MI? — otomatik kapanış için (31.07.2026).
 *
 * `depotLocationState`'ten iki farkı var ve ikisi de bilinçli:
 *
 *  1. TAZELİK ARAMAZ. O fonksiyon kilit içindir ve "cihaz sessizse konum
 *     doğrulanamaz" der. Burada durum tam tersi: kapanışı tetikleyen ŞEY zaten
 *     kontağın kapalı ve cihazın sessiz olmasıdır. Tazelik şartı konsaydı depoya
 *     gelip motoru susturan araç ASLA kapanmazdı — kapanış için son bilinen
 *     konum doğru cevaptır.
 *  2. Boolean döner, üç durumlu değil: çağıran zaten "depoda mı, değil mi"
 *     sorusunu soruyor; konumu hiç bilinmeyen araç (fix yok) `false` sayılır ve
 *     gece-yarısı emniyetine bırakılır — sessizce kapatılmaz.
 *
 * Depo tanımlı değilse `false`: depo bilinmeden "depoda" denemez.
 */
export async function lastFixInDepot(
  vehicleId: string,
  zones?: DepotZone[]
): Promise<boolean> {
  const z = zones ?? (await activeDepotZones());
  if (z.length === 0) return false;
  try {
    const latest = await latestVehicleTelemetry(vehicleId);
    if (!latest || latest.latitude == null || latest.longitude == null) return false;
    return z.some((zone) =>
      pointInCircleM(
        latest.latitude,
        latest.longitude,
        zone.center_lat,
        zone.center_lng,
        zone.radius_m
      )
    );
  } catch {
    return false;
  }
}

/** activeDepotZones()'un döndürdüğü tip — auto-shift motoru da kullanıyor. */
export type { DepotZone };
