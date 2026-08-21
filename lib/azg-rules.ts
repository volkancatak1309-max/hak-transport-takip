import {
  startOfDayViennaFromYmd,
  addCalendarDaysVienna,
  viennaDayKey,
  workedMs,
} from "@/lib/format";

/**
 * AZG ÇALIŞMA SÜRESİ EŞİKLERİ — tek kaynak.
 *
 * KAPSAM (Volkan teyidi, 22.07.2026): HAK61 araçlarının hepsi 2,5 ton altında
 * ve sınır geçmiyor. Bu yüzden AB sürüş-dinlenme tüzüğü (VO 561/2006) ve
 * takograf yükümlülüğü UYGULANMAZ; geçerli olan tek çerçeve Avusturya
 * Arbeitszeitgesetz'tir (AZG).
 *
 * ⚠️ BURADAKİ SAYILAR HUKUKİ EŞİKTİR. Değiştirmek raporun ve panelin ihlal
 * saydığı şeyi değiştirir. Her sabit, dayandığı paragrafla birlikte yazılmıştır;
 * paragraf değişmeden sayı değiştirilmez.
 *
 * ── Neden 9 saat "ihlal" DEĞİL ──────────────────────────────────────────────
 * Panel 22.07.2026'ya kadar 9 saati ihlal eşiği gibi gösteriyordu ve 20 şoför
 * kırmızı görünüyordu. 9 saat bir İHLAL değil, MOLA KADEMESİDİR: bu süreyi
 * aşan vardiyada zorunlu mola 30 değil 45 dakikadır (§ 13c Abs. 1). Günlük
 * azami çalışma süresi § 9 Abs. 1'e göre 12 saattir. İkisi ayrı ayrı
 * gösterilir: 12 saat = ihlal (bordo), 9 saat = mola uyarısı (gold).
 */

const H = 3_600_000;

// ── Günlük azami çalışma süresi ────────────────────────────────────────────
/** § 9 Abs. 1 AZG — günlük azami çalışma süresi. Aşılması İHLALDİR. */
export const AZG_DAILY_MAX_MS = 12 * H;

/**
 * § 14 Abs. 2 AZG — GECE çalışması yapılan günde günlük tavan 10 saate iner.
 * "Gece çalışması" için bu dosyadaki tanım: vardiyanın 00:00–04:00 (Viyana)
 * aralığına DEĞMESİ (bkz. touchesNightWindow).
 */
export const AZG_NIGHT_DAILY_MAX_MS = 10 * H;

// ── Mola kademeleri (§ 13c Abs. 1 AZG) ─────────────────────────────────────
// NOT: şoförler için geçerli paragraf § 13c'dir; § 11 genel hükümdür ve
// raporda yanlışlıkla o gösteriliyordu (22.07.2026'da düzeltildi).
/** 6 saati aşan çalışmada asgari mola. */
export const AZG_BREAK_AFTER_6H_MIN = 30;
/** 9 saati aşan çalışmada asgari mola — 30 değil 45 dakika. */
export const AZG_BREAK_AFTER_9H_MIN = 45;

/** Mola kademelerinin eşikleri. */
export const AZG_BREAK_TIER1_MS = 6 * H;
export const AZG_BREAK_TIER2_MS = 9 * H;

/**
 * Bu vardiya için yasal asgari mola (dakika). 6 saatin altında zorunlu mola
 * yoktur → 0.
 */
export function requiredBreakMin(workedMs: number): number {
  if (workedMs > AZG_BREAK_TIER2_MS) return AZG_BREAK_AFTER_9H_MIN;
  if (workedMs > AZG_BREAK_TIER1_MS) return AZG_BREAK_AFTER_6H_MIN;
  return 0;
}

/**
 * Mola SAYACININ hedefi (dakika) — panelde mola bu süreye ulaşınca otomatik
 * biter. requiredBreakMin'den farkı: 6 saat dolmadan mola veren şoför için de
 * anlamlı bir hedef döndürür (0 olsaydı sayaç anında biterdi).
 *
 * `workedMs` = molanın BAŞLADIĞI andaki çalışılmış süre. Vardiya 9 saati o an
 * geçmişse hedef 45 dakikadır.
 */
export function breakTargetMin(workedMs: number): number {
  return workedMs > AZG_BREAK_TIER2_MS
    ? AZG_BREAK_AFTER_9H_MIN
    : AZG_BREAK_AFTER_6H_MIN;
}

// ── Gece çalışması (§ 14 Abs. 2 AZG) ───────────────────────────────────────
/** Gece penceresi (Viyana yerel saati): 00:00 – 04:00. */
export const NIGHT_WINDOW_START_H = 0;
export const NIGHT_WINDOW_END_H = 4;

/**
 * Vardiya 00:00–04:00 (Viyana) penceresine değiyor mu?
 *
 * Vardiya gece yarısını geçebildiği için pencere, vardiyanın kapsadığı HER
 * Viyana günü için ayrı ayrı kurulur ve kesişim aranır. Gün sınırları
 * DST-güvenli yardımcılarla hesaplanır (lib/format.ts) — sunucu UTC'de
 * çalıştığı için `setHours` ile yapılsaydı yaz saatinde 1 saat kayardı.
 *
 * Açık vardiyada (ended_at null) "şu an" bitiş kabul edilir: gece penceresine
 * çoktan girmiş açık bir vardiya bugün de 10 saatlik tavana tabidir.
 */
export function touchesNightWindow(
  startedAt: string | Date,
  endedAt: string | Date | null,
  now: Date = new Date()
): boolean {
  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const end = endedAt
    ? typeof endedAt === "string"
      ? new Date(endedAt)
      : endedAt
    : now;
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }

  // Vardiyanın kapsadığı Viyana günleri (uzun vardiyalar için üst sınır: 4 gün —
  // bir vardiya bundan uzunsa zaten çok daha büyük bir sorun var).
  let dayStart = startOfDayViennaFromYmd(viennaDayKey(start));
  if (!dayStart) return false;

  for (let i = 0; i < 4; i++) {
    const winStart = dayStart.getTime() + NIGHT_WINDOW_START_H * H;
    const winEnd = dayStart.getTime() + NIGHT_WINDOW_END_H * H;
    // Yarı açık aralık kesişimi: [start,end) ∩ [winStart,winEnd) boş değil mi?
    if (startMs < winEnd && endMs > winStart) return true;
    dayStart = addCalendarDaysVienna(dayStart, 1);
    if (dayStart.getTime() > endMs) break;
  }
  return false;
}

/**
 * Bu vardiya için geçerli günlük tavan. Gece penceresine değiyorsa 10 saat
 * (§ 14 Abs. 2), değilse 12 saat (§ 9 Abs. 1).
 */
export function dailyCapMs(night: boolean): number {
  return night ? AZG_NIGHT_DAILY_MAX_MS : AZG_DAILY_MAX_MS;
}

/**
 * ŞOFÖR-GÜN EKSENİ — § 9 Abs. 1 tavanı bir GÜNE aittir, tek vardiyaya değil.
 *
 * 14.08.2026'ya kadar panelin altı yüzeyi tavanı SATIR başına uyguluyordu:
 * aynı gün 8 saat + 6 saat çalışan şoför panelde temiz görünürken AZG PDF'i
 * (app/actions/azg-report.ts:288-297, gün toplayıcısı) aynı günü ihlal
 * sayıyordu. İki yüzey aynı yasal soruya iki farklı cevap veriyordu. Günde
 * birden çok vardiya Sendigo'da normal hâle gelince (SHIFT_PER_DAY='many')
 * bu ayrışma sessiz bir uyum boşluğuna dönüşürdü.
 *
 * Toplama kuralı PDF'inkiyle BİREBİR: aynı şoför + aynı Viyana günü (vardiya
 * BAŞLANGICININ günü) toplanır; günün HERHANGİ bir vardiyası gece penceresine
 * değiyorsa o gün için tavan 10 saate iner (§ 14 Abs. 2).
 *
 * Canlı ölçüm (14.08.2026, son 120 gün): HAK61'de aşan şoför-gün 78 — satır
 * ekseninin verdiği 78 ile AYNI. Yalnız işaretlenen satır sayısı 78→81 çıkıyor,
 * çünkü zaten aşan bir günün ikinci vardiyası da o ihlale aittir. Sendigo 3→3.
 */
export type CapEntry = {
  id: string;
  worker_id: string | null;
  started_at: string;
  ended_at: string | null;
  break_minutes: number | null;
};

type DayAcc = { ms: number; night: boolean; ids: string[] };

/** Şoför+gün kovaları. Anahtar `${worker_id}|${viennaDayKey(started_at)}`. */
export function workerDayBuckets(
  entries: CapEntry[],
  now: number = Date.now()
): Map<string, DayAcc> {
  const byDay = new Map<string, DayAcc>();
  for (const e of entries) {
    // worker_id'siz satır bir ŞOFÖR-gününe ait olamaz; kendi başına değerlendirilir
    // (kovaya girseydi hepsi tek sahte kovada toplanırdı).
    const key = `${e.worker_id ?? `-${e.id}`}|${viennaDayKey(e.started_at)}`;
    const a = byDay.get(key) ?? { ms: 0, night: false, ids: [] };
    a.ms += workedMs(e, now);
    if (touchesNightWindow(e.started_at, e.ended_at, new Date(now))) a.night = true;
    a.ids.push(e.id);
    byDay.set(key, a);
  }
  return byDay;
}

/** Tavanı aşan ŞOFÖR-GÜN sayısı — kartlardaki "ihlal" rakamı. */
export function overLimitDayCount(
  entries: CapEntry[],
  now: number = Date.now()
): number {
  let n = 0;
  for (const a of workerDayBuckets(entries, now).values()) {
    if (a.ms > dailyCapMs(a.night)) n++;
  }
  return n;
}

/**
 * Tavanı aşan şoför-günlere ait vardiya id'leri — satır rozeti/süzgeci için.
 * Aşan bir günün HER vardiyası işaretlenir: ihlal güne aittir, ikinci vardiya
 * ihlalin dışında sayılamaz.
 */
export function overLimitEntryIds(
  entries: CapEntry[],
  now: number = Date.now()
): Set<string> {
  const out = new Set<string>();
  for (const a of workerDayBuckets(entries, now).values()) {
    if (a.ms > dailyCapMs(a.night)) for (const id of a.ids) out.add(id);
  }
  return out;
}

// ── Panel/rapor eşikleri, okunur adlarla ───────────────────────────────────
/** Yönetici panosundaki İHLAL kartının eşiği (bordo). */
export const OVER_LIMIT_MS = AZG_DAILY_MAX_MS;
/** Yönetici panosundaki MOLA UYARISI kartının eşiği (gold). */
export const BREAK45_THRESHOLD_MS = AZG_BREAK_TIER2_MS;

/** Almanca hukuki dayanak etiketleri — rapor ve PDF tek yerden okur. */
export const AZG_REF = {
  dailyMax: "§ 9 Abs. 1 AZG (Höchstgrenze 12 Stunden täglich)",
  nightMax: "§ 14 Abs. 2 AZG (Nachtarbeit — Höchstgrenze 10 Stunden täglich)",
  break30: "§ 13c Abs. 1 AZG (mind. 30 Min bei mehr als 6 Std)",
  break45: "§ 13c Abs. 1 AZG (mind. 45 Min bei mehr als 9 Std)",
  rest11: "§ 12 Abs. 1 AZG (ununterbrochene Ruhezeit mind. 11 Std.)",
  /** Tek haftada mutlak tavan. */
  weeklyMax: "§ 13b Abs. 2 AZG (Höchstgrenze 60 Stunden pro Woche)",
  /** 17 haftalık ortalama — tek bir haftanın 48'i aşması TEK BAŞINA ihlal değil. */
  weeklyAvg: "§ 13b Abs. 2 AZG (48 Stunden im Durchschnitt über 17 Wochen)",
  weeklyNormal: "§ 3 AZG (Normalarbeitszeit 40 Stunden wöchentlich)",
} as const;

/**
 * YASA ATIFLARI · TÜRKÇE İKİZ (21.08.2026).
 *
 * ⚠️ `§` NUMARASI ÇEVRİLMEZ. "§ 13b Abs. 2 AZG" bir kanun maddesinin
 * kimliğidir; denetimde o kimlikle aranır ve Türkçeleştirmek belgeyi
 * doğrulanamaz hâle getirirdi. Çevrilen YALNIZ parantez içindeki insan-okur
 * açıklama — Almanca sürümde de zaten maddenin özetinden ibaret.
 *
 * Bu, künye kuralının aynısı: kimlik sabit, açıklama dile uyar
 * (bkz. lib/report-de.ts COMPANY notu).
 */
export const AZG_REF_TR = {
  dailyMax: "§ 9 Abs. 1 AZG (günlük en çok 12 saat)",
  nightMax: "§ 14 Abs. 2 AZG (gece çalışması — günlük en çok 10 saat)",
  break30: "§ 13c Abs. 1 AZG (6 saatten fazlasında en az 30 dk mola)",
  break45: "§ 13c Abs. 1 AZG (9 saatten fazlasında en az 45 dk mola)",
  rest11: "§ 12 Abs. 1 AZG (kesintisiz en az 11 saat dinlenme)",
  weeklyMax: "§ 13b Abs. 2 AZG (haftada en çok 60 saat)",
  weeklyAvg: "§ 13b Abs. 2 AZG (17 hafta ortalamasında 48 saat)",
  weeklyNormal: "§ 3 AZG (normal çalışma haftada 40 saat)",
} as const;

/** Dil → yasa atıf kümesi. Bilinmeyen/boş dilde Almanca (eski hâl). */
export function azgRef(dil?: string | null): typeof AZG_REF {
  return (dil === "tr" ? AZG_REF_TR : AZG_REF) as typeof AZG_REF;
}
