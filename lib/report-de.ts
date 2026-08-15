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

/** Rapor içindeki tarih/saat/süre biçimi de Almancadır (de-AT, kiracı dilimi). */
export const REPORT_LOCALE = "de";

/** Veri olmayan hücrelerin gösterimi (tüm kolonlarda aynı). */
export const REPORT_EMPTY = "—";

/**
 * Firma künyesi — ÜÇ PDF'in de (Vardiya, AZG, CO2) tek kaynağı. Daha önce aynı
 * adres üç dosyada + iki sözlükte ayrı ayrı yazılıydı ve biri düzeltilince
 * diğerleri geride kalıyordu. Adres tahminle doldurulmaz: burası resmî belgenin
 * antetidir, değeri yalnız Volkan'ın verdiği metindir.
 */
/**
 * ⚠️ NEDEN `NEXT_PUBLIC_` (31.07.2026 — Sendigo kabul testinde yakalandı).
 *
 * Bu künyeyi okuyan BEŞ PDF bileşeninin beşi de `"use client"`: belge
 * tarayıcıda üretilir (@react-pdf/renderer → blob → indirme). Next, istemci
 * paketine YALNIZ `NEXT_PUBLIC_` önekli env'leri gömer; öneksiz olan tarayıcıda
 * `undefined`'dır. Sonuç: Sendigo'nun Vercel'inde `COMPANY_*` doğru tanımlıydı,
 * sunucuda doğru okunuyordu, ama indirilen AZG raporunun antetinde HAK61'in
 * adı, adresi ve UID numarası basılıyordu — başka bir firmanın vergi kimliği,
 * resmî bir belgede. Ölçüldü: Sendigo'ya inen istemci paketi `ATU79519228`
 * içeriyordu, `681377a` hiç içermiyordu.
 *
 * Öneksiz ad geriye dönük OKUNMAYA DEVAM EDER: sunucu tarafındaki bir çağrı
 * (ya da eski bir kurulum) yalnız `COMPANY_NAME` tanımlamışsa davranış
 * değişmez. Sıra: NEXT_PUBLIC_ → öneksiz → HAK61 varsayılanı.
 *
 * ALTERNATİF NEDEN SEÇİLMEDİ: PDF üretimini sunucuya almak da çözerdi, ama beş
 * bileşenin indirme akışını (blob + <a download>) baştan yazmayı ve rapor
 * verisini ikinci kez sunucuya taşımayı gerektirirdi. Sorun künyenin İSMİNDE,
 * üretim yerinde değil.
 *
 * ⚠️ HER ERİŞİM DÜZ LİTERAL OLMAK ZORUNDA. Next/Turbopack `process.env.X`
 * ifadesini derleme anında METİN olarak değiştirir; `process.env[expr]` gibi
 * dinamik bir erişimi değiştiremez ve istemcide yine `undefined` kalır. Bu
 * yüzden burada yardımcı fonksiyona parametre GEÇİLMEZ — değerler çağrı
 * yerinde okunup fonksiyona hazır dize olarak verilir.
 */
function pickCompany(
  publicValue: string | undefined,
  serverValue: string | undefined,
  fallback: string
): string {
  return publicValue?.trim() || serverValue?.trim() || fallback;
}

export const COMPANY = {
  name: pickCompany(
    process.env.NEXT_PUBLIC_COMPANY_NAME,
    process.env.COMPANY_NAME,
    "HAK61 GmbH"
  ),
  address: pickCompany(
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS,
    process.env.COMPANY_ADDRESS,
    "Josef-Ganahl-Straße 4, 6850 Dornbirn, Österreich"
  ),
} as const;

/**
 * Antette basılan SİCİL SATIRI — tüm PDF'lerde aynı biçim.
 *
 * Avusturya'da resmî belgede firma adı + adres + sicil kimliği birlikte
 * bulunur. Kimliğin TÜRÜ firmaya göre değişir ve bu yüzden 31.07.2026'da
 * "UID" alanı yerine SERBEST SATIR oldu:
 *   • HAK61'in UID'si var        → "UID-Nr.: ATU79519228"  (varsayılan, değişmedi)
 *   • Sendigo'nun henüz yok      → "FN 681377a (Landesgericht Feldkirch)"
 * UID geldiğinde tek env satırı değişir, kod değişmez. Etiketi de env taşır:
 * "UID-Nr.:" önekini koda gömmek, UID'si olmayan firmada yanlış bir hukuki
 * iddia basardı.
 */
export const COMPANY_UID_LINE = pickCompany(
  process.env.NEXT_PUBLIC_COMPANY_REG_LINE,
  process.env.COMPANY_REG_LINE,
  "UID-Nr.: ATU79519228"
);

/**
 * Antetin isteğe bağlı DÖRDÜNCÜ satırı (ör. "Geschäftsführer: …"). Tanımsızsa
 * satır hiç basılmaz — HAK61 antetinde böyle bir satır yoktu ve olmayacak.
 */
export const COMPANY_EXTRA_LINE = pickCompany(
  process.env.NEXT_PUBLIC_COMPANY_EXTRA_LINE,
  process.env.COMPANY_EXTRA_LINE,
  ""
);

/**
 * PDF kapağındaki kare amblem kutusunun içindeki kısa işaret. Bir GÖRSEL değil,
 * 2-4 harflik bir metin — @react-pdf'te dış görsel yüklemek ek bir ağ isteği ve
 * hata yüzeyi demek, üç raporun kapağı için bedeli yüksek. Varsayılan "HAK",
 * yani bugün basılan dizenin aynısı.
 */
export const BRAND_MARK = pickCompany(
  process.env.NEXT_PUBLIC_PDF_BRAND_MARK,
  process.env.PDF_BRAND_MARK,
  "HAK"
);

/**
 * İNDİRİLEN DOSYA ADI ÖNEKİ — amblemden türetilir.
 *
 * 31.07.2026 öncesi beş bileşenin dördünde önek KODA SABİTTİ (`HAK_AZG_…`,
 * `hak-kraftstoff-…`). Sendigo'da indirilen AZG raporunun adı `HAK_AZG_2026-07.pdf`
 * çıkıyordu — künye düzelse bile dosya adı yanlış kalırdı.
 *
 * HAK61'de `BRAND_MARK` varsayılanı "HAK" olduğu için üretilen adlar
 * BİREBİR eskisiyle aynıdır: `HAK_AZG_…` ve `hak-kraftstoff-…`.
 *
 * Dosya adına giren her şey temizlenir: amblem serbest metin bir env'dir ve
 * boşluk/eğik çizgi içerebilir; işletim sistemi adında bunlar kabul edilmez.
 */
const FILE_MARK = BRAND_MARK.replace(/[^A-Za-z0-9]+/g, "") || "HAK";
/** `HAK_AZG_2026-07.pdf` biçimindeki adların öneki. */
export const FILE_PREFIX_UPPER = FILE_MARK.toUpperCase();
/** `hak-kraftstoff-2026-07-31.pdf` biçimindeki adların öneki. */
export const FILE_PREFIX_LOWER = FILE_MARK.toLowerCase();

export const SHIFT_REPORT_DE = {
  title: "Schichtbericht",
  company: COMPANY.name,
  address: COMPANY.address,
  uid: COMPANY_UID_LINE,
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
    /** Sayaç kolonu yok; bu KAT EDİLEN mesafe (bkz. ShiftReport PdfHeaders). */
    km: "Gefahrene km",
    /**
     * "Zu liefernde Pakete"nin KISA hâli. Uygulamada terim tam yazılıyor
     * (messages/de.json), burada kısaltıldı: bu kolon PDF tablosunda %9
     * genişlikte ve 8pt — tam terim üç satıra sararak başlık satırını
     * şişirirdi. Anlam aynı, kolon eni "Aufgenommen" ile birebir.
     */
    loaded: "Zu liefern",
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
  /**
   * false → vardiya boyunca araçtan telemetri gelmemiş; `end_km - start_km`
   * bayat odometreden 0 çıkar ve bu bir ölçüm DEĞİLDİR. PDF'e "0" değil
   * REPORT_EMPTY basılır (bkz. lib/km-quality.ts). Kâğıda basılan sayı
   * ekrandakinden daha kalıcıdır; uydurma 0 oraya hiç girmemeli.
   */
  km_measured?: boolean;
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
