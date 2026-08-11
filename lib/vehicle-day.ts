import type { TelemetryRow } from "@/lib/telemetry";
import {
  addCalendarDaysVienna,
  endOfDayViennaFromYmd,
  startOfDayVienna,
  startOfDayViennaFromYmd,
  viennaDayKey,
} from "@/lib/format";
import { computeEngineHours } from "@/lib/metrics-engine-hours";
import { computeDistanceKm } from "@/lib/metrics-distance";
import { computeIdleTime } from "@/lib/metrics-idle";
import {
  computeTripsAndStops,
  DWELL_MIN_MS,
  MAX_GAP_MS as TRIP_MAX_GAP_MS,
  MOVE_SPEED_KMH,
  STOP_RADIUS_M,
} from "@/lib/metrics-trips";
import { alarmKademe, eventTone, type AlarmKademe } from "@/lib/event-ui";
import type { ChipTone } from "@/components/ui-v2/StatusChip";

/**
 * ARAÇ × GÜN ekseni — mobil araç uçlarının (U1-U5) ORTAK SAF KATMANI.
 *
 * ── NEDEN AYRI DOSYA ───────────────────────────────────────────────────────
 * Beş uç aynı üç şeyi yapıyor: kiracı gününü ISO penceresine çevir, tek aracın
 * izini/olaylarını o pencerede oku, sonucu ekranın anlayacağı şekle sok. İkinci
 * ve üçüncü adım SAF (saat okumaz, ağa çıkmaz, DB'ye dokunmaz) — bu dosyada
 * yalnız o saf kısım yaşıyor.
 *
 * Saflık bir üslup tercihi değil, MUHAFIZIN ÖN KOŞULU: `server-only` ve
 * `supabaseAdmin` içe aktarılmadığı için `scripts/check-arac-uclari.mjs` bu
 * fonksiyonların GERÇEĞİNİ Node'da çalıştırıp ölçülmüş veriyle sınayabiliyor.
 * Aynı mantık route.ts içine yazılsaydı yalnız canlı istekle denenebilirdi.
 * (`import type` satırları derlemede silinir — Node onları görmez.)
 *
 * ── SAAT DİLİMİ ────────────────────────────────────────────────────────────
 * Gün sınırı ASLA burada sabitlenmez: lib/format.ts'in `*Vienna` yardımcıları
 * kiracı dilimini lib/tz.ts'ten okur ve DST geçişlerinde doğru sınırı verir.
 * "2026-08-10" bir kiracı takvim günüdür, bir UTC dilimi değil.
 */

/** Gün listesi penceresinin tavanı (U1). Keşif belgesi: son 14 gün. */
export const GUN_PENCERE_MAX = 14;

/**
 * Eşit aralıklı seyreltme — İLK ve SON eleman HER ZAMAN korunur.
 *
 * lib/route-history.ts içinde bu mantığın İKİ birebir kopyası vardı (`sample`
 * çizim tavanı için, `cap` OSRM girdi tavanı için). Tek kaynağa alındı: rota
 * ucunun "ilk ve son nokta korunur" sözü ancak muhafızın çalıştırabildiği bir
 * yerde yaşarsa sınanabilir. Davranış aynı — `max ≥ 2` için üretilen dizi
 * eskisiyle birebir.
 */
export function seyrelt<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return items.length ? [items[items.length - 1]] : [];
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  out[out.length - 1] = items[items.length - 1]; // gerçek son nokta garanti
  return out;
}

/** `YYYY-MM-DD` mi — ve gerçekten var olan bir takvim günü mü? */
export function gecerliGun(s: string | null | undefined): s is string {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // 31 Şubat gibi taşan tarihler: UTC'de kurup geri okuyunca gün kayar.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/**
 * Bir kiracı takvim gününün [başlangıç, bitiş] ISO sınırları (DST-güvenli).
 *
 * ⚠️ ÖNCE `gecerliGun`: `startOfDayViennaFromYmd` yalnız BİÇİMİ denetler
 * (`/^\d{4}-\d{2}-\d{2}/`) ve taşan tarihi sessizce kaydırır — "2026-02-31"
 * ona 3 Mart penceresi verdirir. Muhafız bunu yakaladı (10.08.2026): uç
 * gövdesinde `tarih:"2026-02-31"` yazarken pencere bambaşka bir güne bakardı.
 * Uçlar zaten `gecerliGun` ile 400 döndürüyor, ama sınırı üreten fonksiyonun
 * kendisi de kapalı olmalı — ikinci bir çağıran o kapıyı unutabilir.
 */
export function gunPenceresi(gun: string): { baslangic: string; bitis: string } | null {
  if (!gecerliGun(gun)) return null;
  const s = startOfDayViennaFromYmd(gun);
  const e = endOfDayViennaFromYmd(gun);
  if (!s || !e) return null;
  return { baslangic: s.toISOString(), bitis: e.toISOString() };
}

/**
 * `ref` gününden geriye `n` kiracı günü — YENİDEN ESKİYE.
 * Takvimle yürür (24 saat eklemez), yani DST günü de tam bir gündür.
 */
export function sonGunler(n: number, ref: Date = new Date()): string[] {
  const bugun = startOfDayVienna(ref);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(viennaDayKey(addCalendarDaysVienna(bugun, -i)));
  return out;
}

// ── U1 · veri olan günler ───────────────────────────────────────────────────

export type GunOzeti = {
  tarih: string;
  nokta: number;
  ilk: string | null;
  son: string | null;
};

/**
 * Ham zaman damgalarını kiracı gününe göre gruplar (U1'in saf çekirdeği).
 *
 * NOKTASI SIFIR OLAN GÜN LİSTEYE GİRMEZ — "veri olan gün hapı" tanımı bu.
 * Yeniden eskiye sıralar; `ilk`/`son` o günün en erken/en geç anıdır.
 */
export function izGunleri(rows: readonly { recorded_at: string }[]): GunOzeti[] {
  const harita = new Map<string, { nokta: number; ilk: string; son: string }>();
  for (const r of rows) {
    const gun = viennaDayKey(r.recorded_at);
    const v = harita.get(gun);
    if (!v) {
      harita.set(gun, { nokta: 1, ilk: r.recorded_at, son: r.recorded_at });
      continue;
    }
    v.nokta += 1;
    if (r.recorded_at < v.ilk) v.ilk = r.recorded_at;
    if (r.recorded_at > v.son) v.son = r.recorded_at;
  }
  return [...harita.entries()]
    .map(([tarih, v]) => ({ tarih, nokta: v.nokta, ilk: v.ilk, son: v.son }))
    .sort((a, b) => b.tarih.localeCompare(a.tarih));
}

// ── U3 · gün olayları ───────────────────────────────────────────────────────

/** `vehicle_events` satırının bu katmanın gördüğü kadarı. */
export type OlayGirdisi = {
  id: string;
  event_type: string;
  event_value: Record<string, unknown> | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  occurred_at: string;
};

/** `idle_episodes` satırının bu katmanın gördüğü kadarı. */
export type RolantiGirdisi = {
  id: string;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string;
  latitude: number | null;
  longitude: number | null;
};

export type OlayKalemi = {
  id: string;
  tur: string;
  an: string;
  konum: { lat: number; lng: number } | null;
  /**
   * Olay anındaki ARACIN HIZI (km/h) — `vehicle_events.speed_kmh`.
   *
   * ⚠️ HIZ LİMİTİ DEĞİL. Bu depoda hız limiti diye bir veri YOK: ne kolon, ne
   * sabit, ne de cihazdan okunabilen bir eşik. `overspeeding` olayında cihazın
   * kendi eşiği tetikler ve `event_value.speed` ile bu kolon canlıda BİREBİR
   * aynı sayıdır (10.08.2026 ölçümü, 60/60 satır). Ekranda "limit N" yazan bir
   * çip çizilirse o sayı uydurma olur.
   */
  hizKmh: number | null;
  /** Ham `event_value` — türe göre değişir (`{speed}` / `{angle}` / null). */
  deger: Record<string, unknown> | null;
  sureMs: number | null;
  devamEdiyor: boolean;
  siddet: ChipTone;
  kademe: AlarmKademe;
};

/**
 * Nokta olayları + rölanti epizodlarını TEK listede birleştirir, saate göre.
 *
 * Dönüşüm `/api/mobile/shifts/[id]`in alarm bloğuyla BİREBİR aynıdır — tek
 * fark pencerenin vardiya değil GÜN olması. İki yüzey aynı olayı aynı şekilde
 * yazmalı, yoksa aynı sürüş iki ekranda iki farklı sayı verir.
 *
 * `idleTriggerS` çağrıdan gelir (lib/telemetry.ts `IDLE_TRIGGER_S`): epizodun
 * `started_at`i fiziksel duruştan o kadar SONRADIR, süreye geri eklenir.
 */
export function gunOlaylari(
  events: readonly OlayGirdisi[],
  episodes: readonly RolantiGirdisi[],
  idleTriggerS: number
): OlayKalemi[] {
  const kalemler: OlayKalemi[] = [
    ...events.map((r) => ({
      id: r.id,
      tur: r.event_type,
      an: r.occurred_at,
      konum:
        r.latitude != null && r.longitude != null
          ? { lat: r.latitude, lng: r.longitude }
          : null,
      hizKmh: r.speed_kmh,
      deger: r.event_value,
      sureMs: null as number | null,
      devamEdiyor: false,
      siddet: eventTone(r.event_type),
      kademe: alarmKademe(r.event_type),
    })),
    ...episodes.map((x) => {
      const s = new Date(x.started_at).getTime();
      const f = new Date(x.ended_at ?? x.last_seen_at).getTime();
      return {
        id: x.id,
        tur: "idling",
        an: x.started_at,
        konum:
          x.latitude != null && x.longitude != null
            ? { lat: x.latitude, lng: x.longitude }
            : null,
        hizKmh: 0 as number | null,
        deger: null,
        sureMs: Math.max(0, f - s) + idleTriggerS * 1000,
        devamEdiyor: x.ended_at === null,
        siddet: eventTone("idling"),
        kademe: alarmKademe("idling"),
      };
    }),
  ];
  // Anlara göre SAYISAL karşılaştırma: iki tablo ISO'yu farklı yazarsa
  // ("…Z" ↔ "…+00:00") metin sıralaması yanlış sıralardı. Eşitlikte id.
  return kalemler.sort((a, b) => {
    const d = new Date(a.an).getTime() - new Date(b.an).getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

// ── U4 · duraklar & seferler ────────────────────────────────────────────────

export type GunDuraklari = {
  noktaSayisi: number;
  belirsiz: boolean;
  bosluk: number;
  duraklar: { baslangic: string; bitis: string; sureMs: number; lat: number; lng: number }[];
  seferler: {
    baslangic: string;
    bitis: string;
    sureMs: number;
    km: number;
    baslangicLat: number;
    baslangicLng: number;
    bitisLat: number;
    bitisLng: number;
  }[];
  toplamSeferKm: number | null;
  /** Eşikler UÇTAN gelir: ekran "3 dk'dan kısa duruş durak değildir" diyebilsin. */
  esikler: {
    hareketHizKmh: number;
    enAzDurusMs: number;
    yaricapM: number;
    enFazlaBoslukMs: number;
  };
};

/** `computeTripsAndStops`ı uç şekline çevirir. İlk tüketicisi bu uçtur. */
export function gunDuraklari(track: readonly TelemetryRow[]): GunDuraklari {
  const r = computeTripsAndStops(track as TelemetryRow[]);
  const olculdu = track.length >= 2;
  return {
    noktaSayisi: r.points,
    belirsiz: r.uncertain,
    bosluk: r.gapCount,
    duraklar: r.stops.map((s) => ({
      baslangic: s.startTime,
      bitis: s.endTime,
      sureMs: s.durationMs,
      lat: s.lat,
      lng: s.lng,
    })),
    seferler: r.trips.map((t) => ({
      baslangic: t.startTime,
      bitis: t.endTime,
      sureMs: t.durationMs,
      km: yuvarla(t.km, 2),
      baslangicLat: t.startLat,
      baslangicLng: t.startLng,
      bitisLat: t.endLat,
      bitisLng: t.endLng,
    })),
    // Ölçülemeyen sayı SIFIR DEĞİLDİR: iki noktadan az izde toplam yoktur.
    toplamSeferKm: olculdu ? yuvarla(r.totalTripKm, 2) : null,
    esikler: {
      hareketHizKmh: MOVE_SPEED_KMH,
      enAzDurusMs: DWELL_MIN_MS,
      yaricapM: STOP_RADIUS_M,
      enFazlaBoslukMs: TRIP_MAX_GAP_MS,
    },
  };
}

// ── U5 · gün metrikleri ─────────────────────────────────────────────────────

/** Bir metrik neden hesaplanamadı — `null` tek başına bunu söyleyemez. */
export type MetrikSebep = "var" | "veri_yok" | "kontak_yok" | "hiz_yok";

export type GunMetrikleri = {
  noktaSayisi: number;
  belirsiz: boolean;
  motorDk: number | null;
  motorMs: number | null;
  gpsKm: number | null;
  rolantiDk: number | null;
  rolantiMs: number | null;
  rolantiOlay: number | null;
  sebep: { motor: MetrikSebep; gps: MetrikSebep; rolanti: MetrikSebep };
  ayrinti: {
    bosluk: number;
    kirpilanKontak: number;
    sicrama: number;
    titresim: number;
    rolantiBosluk: number;
  };
};

function yuvarla(n: number, basamak: number): number {
  const k = 10 ** basamak;
  return Math.round(n * k) / k;
}

/**
 * Motor saati · GPS km · rölanti — panelin araç detayında YAN YANA çağrılan üç
 * fonksiyonun aynısı, tek `listVehicleTrack` sonucunu paylaşarak.
 *
 * ── HESAPLANAMAYAN SIFIR DEĞİLDİR ──────────────────────────────────────────
 * "0 dk motor" ile "motor süresini ölçemedik" aynı piksel, iki ayrı gerçek.
 * Kapılar:
 *   nokta < 2               → üçü de null (`veri_yok`) — tek noktadan aralık çıkmaz
 *   hiç `ignition_on` yok   → motor + rölanti null (`kontak_yok`)
 *   hiç `speed_kmh` yok     → rölanti null (`hiz_yok`) — rölanti kontak VE hız ister
 * GPS km yalnız konum ister; iki nokta varsa daima ölçülür (sıfır olabilir ve
 * o sıfır gerçektir: araç kıpırdamamıştır).
 */
export function gunMetrikleri(track: readonly TelemetryRow[]): GunMetrikleri {
  const rows = track as TelemetryRow[];
  const veriVar = rows.length >= 2;
  const kontakVar = rows.some((r) => r.ignition_on !== null);
  const hizVar = rows.some((r) => r.speed_kmh !== null);

  const motorSebep: MetrikSebep = !veriVar ? "veri_yok" : !kontakVar ? "kontak_yok" : "var";
  const gpsSebep: MetrikSebep = !veriVar ? "veri_yok" : "var";
  const rolantiSebep: MetrikSebep = !veriVar
    ? "veri_yok"
    : !kontakVar
      ? "kontak_yok"
      : !hizVar
        ? "hiz_yok"
        : "var";

  const motor = computeEngineHours(rows);
  const mesafe = computeDistanceKm(rows);
  const rolanti = computeIdleTime(rows);

  return {
    noktaSayisi: rows.length,
    belirsiz: motor.uncertain || mesafe.uncertain || rolanti.uncertain,
    motorDk: motorSebep === "var" ? Math.round(motor.ms / 60_000) : null,
    motorMs: motorSebep === "var" ? motor.ms : null,
    gpsKm: gpsSebep === "var" ? yuvarla(mesafe.km, 2) : null,
    rolantiDk: rolantiSebep === "var" ? Math.round(rolanti.totalIdleMs / 60_000) : null,
    rolantiMs: rolantiSebep === "var" ? rolanti.totalIdleMs : null,
    rolantiOlay: rolantiSebep === "var" ? rolanti.idleEvents : null,
    sebep: { motor: motorSebep, gps: gpsSebep, rolanti: rolantiSebep },
    ayrinti: {
      bosluk: mesafe.gapCount,
      kirpilanKontak: motor.clampedCount,
      sicrama: mesafe.spikeCount,
      titresim: mesafe.jitterCount,
      rolantiBosluk: rolanti.gapCount,
    },
  };
}
