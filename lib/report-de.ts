/**
 * Vardiya Raporu (PDF) metinleri — SABİT ALMANCA, arayüz dilinden BAĞIMSIZ.
 *
 * Gerekçe: bu çıktı bir Avusturya resmî belgesidir (AZG çalışma süresi kaydı;
 * muhasebe ve iş denetiminde ibraz edilir). Türkçe arayüzle çalışan yönetici de
 * Almanca PDF üretmek zorundadır — belgenin dili kullanıcının arayüz tercihine
 * bağlı olamaz.
 *
 * Metinler next-intl'den DEĞİL buradan gelir: next-intl istemciye yalnız AKTİF
 * dilin sözlüğünü yükler, yani Türkçe arayüzde "de" karşılıkları okunamaz.
 * Alternatif (tüm de.json'u istemci paketine sokmak) bu 20 satır için fazlasıyla
 * pahalı olurdu.
 */

import {
  formatDate,
  formatDurationShort,
  formatTime,
  kmDiff,
  workedMs,
} from "@/lib/format";

/** Rapor içindeki tarih/saat/süre biçimi de Almancadır (de-AT, Europe/Vienna). */
export const REPORT_LOCALE = "de";

/** Veri olmayan hücrelerin gösterimi (tüm kolonlarda aynı). */
export const REPORT_EMPTY = "—";

/**
 * Firma künyesi — ÜÇ PDF'in de (Vardiya, AZG, CO2) tek kaynağı. Daha önce aynı
 * adres üç dosyada + iki sözlükte ayrı ayrı yazılıydı ve biri düzeltilince
 * diğerleri geride kalıyordu. Adres tahminle doldurulmaz: burası resmî belgenin
 * antetidir, değeri yalnız Volkan'ın verdiği metindir.
 */
export const COMPANY = {
  name: "HAK61 GmbH",
  address: "Manstraße 21/1/5, 2333 Leopoldsdorf, Österreich",
} as const;

export const SHIFT_REPORT_DE = {
  title: "Schichtbericht",
  company: COMPANY.name,
  address: COMPANY.address,
  period: "Zeitraum",
  generatedAt: "Erstellt am",
  /** Alt not: belgenin hukuki dayanağı (Arbeitszeitgesetz kayıt yükümlülüğü). */
  footer: "Arbeitszeitaufzeichnung gemäß Arbeitszeitgesetz (AZG)",
  headers: {
    worker: "Mitarbeiter",
    date: "Datum",
    start: "Beginn",
    end: "Ende",
    worked: "Arbeitszeit",
    breakMin: "Pause",
    startKm: "Start-KM",
    endKm: "End-KM",
    km: "KM",
    loaded: "Aufgenommen",
    cargo: "Zugestellt",
    undelivered: "Nicht zugestellt",
    plate: "Kennzeichen",
  },
} as const;

/**
 * Aralık anahtarının Almancası. Önceden antete ham anahtar basılıyordu
 * ("Zeitraum: month") — Almanca bir belgede İngilizce anahtar.
 */
export function reportPeriodDe(range: string): string {
  switch (range) {
    case "week":
      return "Diese Woche";
    case "month":
      return "Dieser Monat";
    case "custom":
      return "Benutzerdefinierter Zeitraum";
    default:
      return "Heute";
  }
}

/** Rapor satırının okuduğu vardiya alanları (TimeEntry'nin alt kümesi). */
export type ShiftReportEntry = {
  started_at: string;
  ended_at: string | null;
  start_km: number | null;
  end_km: number | null;
  break_minutes: number | null;
  start_package_count: number | null;
  cargo_count: number | null;
  undelivered_count: number | null;
  plate: string | null;
};

/**
 * Bir vardiya → bir rapor satırı. İki çağıran (tüm filo raporu ve tek çalışan
 * raporu) 13 kolonu ayrı ayrı kurmasın diye tek kaynak: kolonlardan biri
 * birinde düzelip diğerinde unutulursa iki PDF sessizce çelişirdi.
 */
export function buildShiftReportRow(e: ShiftReportEntry, workerName: string) {
  const km = kmDiff(e);
  return {
    worker: workerName,
    date: formatDate(e.started_at, REPORT_LOCALE),
    start: formatTime(e.started_at, REPORT_LOCALE),
    end: e.ended_at ? formatTime(e.ended_at, REPORT_LOCALE) : REPORT_EMPTY,
    worked: formatDurationShort(workedMs(e), REPORT_LOCALE),
    breakMin: String(e.break_minutes ?? 0),
    startKm: e.start_km != null ? String(e.start_km) : REPORT_EMPTY,
    endKm: e.end_km != null ? String(e.end_km) : REPORT_EMPTY,
    km: km !== null ? String(km) : REPORT_EMPTY,
    loaded:
      e.start_package_count != null ? String(e.start_package_count) : REPORT_EMPTY,
    // "Teslim edilen" ancak vardiya KAPANDIKTAN sonra gerçek sayıdır; açık
    // vardiyada cargo_count hâlâ gün başı yer tutucusudur.
    cargo:
      e.ended_at && e.cargo_count !== null ? String(e.cargo_count) : REPORT_EMPTY,
    undelivered:
      e.undelivered_count !== null ? String(e.undelivered_count) : REPORT_EMPTY,
    plate: e.plate ?? REPORT_EMPTY,
  };
}
