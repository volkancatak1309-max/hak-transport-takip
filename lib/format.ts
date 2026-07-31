export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Kısa süre: "8s 30dk" (tr) · "8 Std 30 Min" (de).
 *
 * BOŞLUK YALNIZ ALMANCADA (31.07.2026, Sendigo kabul testi). Çıktı "0Std 00Min"
 * biçimindeydi; Almancada sayı ile birimin bitişik yazılması yanlıştır
 * (doğrusu "0 Std 00 Min") ve ekranda okunaksızdı.
 *
 * TÜRKÇE BİLEREK DEĞİŞMEDİ: "8s 30dk" HAK61'in bugün canlıda gösterdiği
 * biçimdir ve Türkçede bu bitişik kısaltma yaygındır. Tek boşluk uğruna
 * çalışan bir müşterinin tablolarını kaydırmıyoruz.
 *
 * ⚠️ Almanca çıktı HAK61'de de görünür: PDF raporlar SABİT ALMANCADIR
 * (lib/report-de.ts). Yani HAK61'in vardiya/AZG PDF'lerinde süre sütunu
 * "8Std 30Min" yerine "8 Std 30 Min" basar. Görsel bir düzeltme; sayılar,
 * sütun sırası ve hesap aynı.
 */
export function formatDurationShort(ms: number, locale: string = "tr"): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const de = locale === "de";
  const hSuffix = de ? " Std" : "s";
  const mSuffix = de ? " Min" : "dk";
  return `${h}${hSuffix} ${String(m).padStart(2, "0")}${mSuffix}`;
}

/**
 * Rölanti süresi rozeti için: <1 sa → "25 dk", ≥1 sa → "1 sa 5 dk" (0 dakikayı
 * atar: "2 sa"). formatDurationShort'tan farkı 0 saati göstermemesi ("0s 25dk"
 * yerine "25 dk"). Yuvarlama Math.round — 24.6 dk → 25 dk.
 */
export function formatIdleShort(ms: number, locale: string = "tr"): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.round(ms / 60000);
  const mu = locale === "de" ? "Min" : "dk";
  if (totalMin < 60) return `${totalMin} ${mu}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hu = locale === "de" ? "Std" : "sa";
  return m === 0 ? `${h} ${hu}` : `${h} ${hu} ${m} ${mu}`;
}

export function formatHoursDecimal(ms: number): string {
  if (ms < 0) ms = 0;
  return (ms / 3600000).toFixed(2);
}

/** "3 sa 45 dk" / "3 Std 45 Min" — hours+minutes, for durations like engine runtime. */
export function formatHoursMinutes(ms: number, locale: string = "tr"): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hu = locale === "de" ? "Std" : "sa";
  const mu = locale === "de" ? "Min" : "dk";
  return `${h} ${hu} ${String(m).padStart(2, "0")} ${mu}`;
}

export function formatDateTime(iso: string | null | undefined, locale: string = "tr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const tag = locale === "de" ? "de-AT" : "tr-TR";
  return d.toLocaleString(tag, {
    timeZone: "Europe/Vienna",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string | null | undefined, locale: string = "tr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const tag = locale === "de" ? "de-AT" : "tr-TR";
  return d.toLocaleTimeString(tag, {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Localized relative time, e.g. "5 dakika önce" / "vor 5 Minuten". Picks the
 * largest sensible unit (second → minute → hour → day). Uses Date.now(), so it
 * must only be rendered client-side (or after mount) to avoid hydration drift.
 */
export function formatRelative(iso: string | null | undefined, locale: string = "tr"): string {
  if (!iso) return "—";
  const tag = locale === "de" ? "de-AT" : "tr-TR";
  const diffMs = new Date(iso).getTime() - Date.now(); // negative = in the past
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60000), "minute");
  if (absSec < 86400) return rtf.format(Math.round(diffMs / 3600000), "hour");
  return rtf.format(Math.round(diffMs / 86400000), "day");
}

export function formatDate(iso: string | null | undefined, locale: string = "tr"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const tag = locale === "de" ? "de-AT" : "tr-TR";
  return d.toLocaleDateString(tag, {
    timeZone: "Europe/Vienna",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatWeekday(iso: string, locale: string = "tr"): string {
  const d = new Date(iso);
  const tag = locale === "de" ? "de-AT" : "tr-TR";
  return d.toLocaleDateString(tag, { timeZone: "Europe/Vienna", weekday: "short" });
}

export function workedMs(entry: {
  started_at: string;
  ended_at: string | null;
  break_minutes: number | null;
}, now: number = Date.now()): number {
  const startTs = new Date(entry.started_at).getTime();
  const endTs = entry.ended_at ? new Date(entry.ended_at).getTime() : now;
  const breakMs = Math.max(0, (entry.break_minutes ?? 0) * 60_000);
  return Math.max(0, endTs - startTs - breakMs);
}

export function rawDurationMs(entry: {
  started_at: string;
  ended_at: string | null;
}, now: number = Date.now()): number {
  const startTs = new Date(entry.started_at).getTime();
  const endTs = entry.ended_at ? new Date(entry.ended_at).getTime() : now;
  return Math.max(0, endTs - startTs);
}

export function kmDiff(entry: {
  start_km: number | null;
  end_km: number | null;
}): number | null {
  if (entry.end_km === null || entry.start_km === null) return null;
  return entry.end_km - entry.start_km;
}

/** Vienna calendar day key (YYYY-MM-DD) for an ISO timestamp — timezone-safe. */
export function viennaDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
}

// ---------------------------------------------------------------------------
// Timezone-aware date boundaries (Europe/Vienna)
//
// The previous implementation built a Date from a Vienna *string* and then
// called setHours(0,…), which snaps to the SERVER's local midnight — on a UTC
// host (Vercel) that is 1–2 h off the real Vienna day boundary, so "today /
// this week / this month" silently drifted. These helpers instead compute the
// exact UTC instant that corresponds to a Vienna wall-clock time, DST-safe.
// ---------------------------------------------------------------------------
const VIENNA_TZ = "Europe/Vienna";

/** Wall-clock parts of an instant as seen in `timeZone`. */
function tzParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Some engines emit hour "24" at midnight — normalise to 0.
  if (map.hour === 24) map.hour = 0;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Offset of `timeZone` at `date`, in ms (wall-clock-as-UTC minus the instant). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = tzParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

/**
 * The UTC instant for a wall-clock time in `timeZone`. DST-safe: the offset is
 * resolved at the naive instant, then corrected once for transition days.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = tzOffsetMs(new Date(naiveUTC), timeZone);
  const candidate = naiveUTC - offset1;
  const offset2 = tzOffsetMs(new Date(candidate), timeZone);
  return new Date(naiveUTC - offset2);
}

/** Add `n` calendar days to a Vienna day-start instant (DST-safe). */
export function addCalendarDaysVienna(dayStart: Date, n: number): Date {
  const p = tzParts(dayStart, VIENNA_TZ);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return zonedWallTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    VIENNA_TZ
  );
}

/** Start of the Vienna calendar day containing `ref` (default now), as UTC. */
export function startOfDayVienna(ref: Date = new Date()): Date {
  const p = tzParts(ref, VIENNA_TZ);
  return zonedWallTimeToUtc(p.year, p.month, p.day, 0, 0, 0, VIENNA_TZ);
}

/** Last millisecond of the Vienna calendar day containing `ref`. */
export function endOfDayVienna(ref: Date = new Date()): Date {
  return new Date(addCalendarDaysVienna(startOfDayVienna(ref), 1).getTime() - 1);
}

export function startOfTodayVienna(): Date {
  return startOfDayVienna();
}

export function endOfTodayVienna(): Date {
  return endOfDayVienna();
}

/** Monday 00:00 (Vienna) of the current week, as a UTC instant. */
export function startOfWeekVienna(): Date {
  const p = tzParts(new Date(), VIENNA_TZ);
  const dow = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - dow));
  return zonedWallTimeToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    0,
    VIENNA_TZ
  );
}

/** Last millisecond of the current Vienna week (Sunday 23:59:59.999). */
export function endOfWeekVienna(): Date {
  return new Date(addCalendarDaysVienna(startOfWeekVienna(), 7).getTime() - 1);
}

/** First day 00:00 (Vienna) of the current month, as a UTC instant. */
export function startOfMonthVienna(): Date {
  const p = tzParts(new Date(), VIENNA_TZ);
  return zonedWallTimeToUtc(p.year, p.month, 1, 0, 0, 0, VIENNA_TZ);
}

/** Last millisecond of the current Vienna month. */
export function endOfMonthVienna(): Date {
  const p = tzParts(new Date(), VIENNA_TZ);
  const nextMonth = zonedWallTimeToUtc(p.year, p.month + 1, 1, 0, 0, 0, VIENNA_TZ);
  return new Date(nextMonth.getTime() - 1);
}

/** Parse a YYYY-MM-DD string as the start of that Vienna day (UTC instant). */
export function startOfDayViennaFromYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return zonedWallTimeToUtc(+m[1], +m[2], +m[3], 0, 0, 0, VIENNA_TZ);
}

/** Parse a YYYY-MM-DD string as the end (last ms) of that Vienna day. */
export function endOfDayViennaFromYmd(s: string): Date | null {
  const start = startOfDayViennaFromYmd(s);
  if (!start) return null;
  return new Date(addCalendarDaysVienna(start, 1).getTime() - 1);
}

/* ── Para & sayı formatlayıcıları (DESIGN-SYSTEM Ek A) ──────────────────────
   eur() kopyaları (masraf/yakıt client + action'ları) FAZ 4'te buraya taşınır;
   yeni bileşenler yalnız bunları kullanır. */

/** Yereldeki Intl etiketi: de → de-AT, aksi halde tr-TR. */
export function localeTag(locale: string = "tr"): string {
  return locale === "de" ? "de-AT" : "tr-TR";
}

/** "1.234,56 €" — Avusturya/TR biçiminde para. */
export function formatEur(n: number, locale: string = "tr"): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

/** Binlik ayraçlı tam/ondalık sayı ("46.019" / "12,4"). */
export function formatNumber(
  n: number,
  locale: string = "tr",
  maxFractionDigits: number = 0
): string {
  return new Intl.NumberFormat(localeTag(locale), {
    maximumFractionDigits: maxFractionDigits,
  }).format(n);
}
