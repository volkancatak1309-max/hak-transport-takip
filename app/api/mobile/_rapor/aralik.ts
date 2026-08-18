import "server-only";
import { computeAnalyticsRange, previousPeriod } from "@/lib/analytics";
import type { AnalyticsRangeKey, DateRange } from "@/lib/analytics-shared";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";

/**
 * MOBİL RAPOR YÜZEYLERİNİN ORTAK ARALIK DİLİ.
 *
 * `?range=gun|hafta|ay|tumzaman|ozel` (+ `?from=&to=` YYYY-MM-DD, yalnız `ozel`).
 *
 * ⚠️ BU DOSYA ROUTE DEĞİLDİR. Klasör adı `_` ile başlıyor → Next yönlendirmeden
 * muaf tutar (`_performans/donem.ts` ile aynı desen).
 *
 * ── NEDEN AYRI DOSYA (18.08.2026) ─────────────────────────────────────────
 * Bu çözümleyici `/api/mobile/analytics` içinde doğmuştu. CSV uçları da aynı
 * dili konuşmak zorunda: "son 30 gün" iki yüzeyde iki farklı pencere olursa
 * yönetici Analiz ekranındaki sayıyı Excel'de bulamaz ve hangisinin doğru
 * olduğunu kimse söyleyemez. Kopyalamak yerine TAŞINDI; `/analytics` artık
 * buradan içe aktarıyor ve davranışı BİREBİR aynı (aynı beş anahtar, aynı
 * hata kodları, aynı doğrulama sırası).
 *
 * ── PANEL PENCERELERİYLE AYNI ─────────────────────────────────────────────
 * `computeAnalyticsRange` panelin kendi fonksiyonu. Yönetici panosunun
 * `computeRange`i (today/week/month/custom) AYRI bir isim kümesi kullanıyor
 * ama ÜRETTİĞİ PENCERELER aynı (ölçüldü, app/admin/page.tsx:51):
 *     today ↔ gun · week ↔ hafta (kayan 7) · month ↔ ay (kayan 30)
 * Tek fark `custom`/`ozel`in tarihsiz hâli: pano BUGÜNE, analytics son 7 güne
 * düşer. Bu uçlar tarihi KATI doğruladığı için o fark yüzeye çıkmaz.
 *
 * ── GEÇERSİZ TARİH SESSİZCE YUTULMAZ ──────────────────────────────────────
 * `computeAnalyticsRange("ozel", …)` geçersiz tarihte SESSİZCE son 7 güne
 * düşer — panel için doğru, API için değil: istemci yazdığı tarihin verisine
 * baktığını sanırdı. Burada 400 döner. Doğrulama İKİNCİ bir takvim uygulaması
 * DEĞİL: kararı pencereyi kuran fonksiyonların ta kendisi verir
 * (`startOfDayViennaFromYmd` / `endOfDayViennaFromYmd` var olmayan günde null).
 */

export const RANGE_KEYS = ["gun", "hafta", "ay", "tumzaman", "ozel"] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type AralikCozumu = {
  tur: AnalyticsRangeKey;
  range: DateRange;
  /** Aynı uzunlukta önceki pencere; filo başlangıcına dayanıyorsa null. */
  onceki: DateRange | null;
  /** İstemcinin verdiği ham tarihler (yalnız `ozel`); yoksa null. */
  from: string | null;
  to: string | null;
};

export type AralikSonucu =
  | { ok: true; cozum: AralikCozumu }
  | { ok: false; kod: "invalid_range" | "invalid_tarih" };

export function aralikCoz(url: URL): AralikSonucu {
  const ham = url.searchParams.get("range");
  const tur = (ham ?? "hafta") as AnalyticsRangeKey;
  if (!(RANGE_KEYS as readonly string[]).includes(tur)) {
    return { ok: false, kod: "invalid_range" };
  }

  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;

  // ÇAPA: tam ISO damga ("2026-08-12T10:00Z") gün olarak kabul edilmesin —
  // startOfDayViennaFromYmd ön eke bilerek toleranslı. Takvim denetimi
  // (2026-02-31) KAYNAKTA; burada yalnız null'ı 400'e çeviriyoruz.
  if (from !== null && (!YMD.test(from) || !startOfDayViennaFromYmd(from))) {
    return { ok: false, kod: "invalid_tarih" };
  }
  if (to !== null && (!YMD.test(to) || !endOfDayViennaFromYmd(to))) {
    return { ok: false, kod: "invalid_tarih" };
  }

  const range = computeAnalyticsRange(tur, from, to);
  return { ok: true, cozum: { tur, range, onceki: previousPeriod(range), from, to } };
}

/** 400 gövdesinin ortak alanları — istemci geçerli kümeyi dokümansız görsün. */
export function aralikHataAlanlari(kod: "invalid_range" | "invalid_tarih") {
  return kod === "invalid_range"
    ? { alan: "range", gecerli: RANGE_KEYS }
    : { alan: "from|to", bicim: "YYYY-MM-DD" };
}
