export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDurationShort(ms: number, locale: string = "tr"): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hSuffix = locale === "de" ? "Std" : "s";
  const mSuffix = locale === "de" ? "Min" : "dk";
  return `${h}${hSuffix} ${String(m).padStart(2, "0")}${mSuffix}`;
}

export function formatHoursDecimal(ms: number): string {
  if (ms < 0) ms = 0;
  return (ms / 3600000).toFixed(2);
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

export function startOfTodayVienna(): Date {
  const now = new Date();
  const tz = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  tz.setHours(0, 0, 0, 0);
  return tz;
}

export function startOfWeekVienna(): Date {
  const today = startOfTodayVienna();
  const day = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - day);
  return today;
}

export function startOfMonthVienna(): Date {
  const today = startOfTodayVienna();
  today.setDate(1);
  return today;
}
