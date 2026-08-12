import "server-only";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import { computeAnalyticsRange } from "@/lib/analytics";
import type { AnalyticsRangeKey, DateRange } from "@/lib/analytics-shared";

/**
 * MOBİL LİSTE SÖZLEŞMESİ — sayfalama ve tarih aralığı, tek yerde.
 *
 * ── TARİH BİÇİMİ ──────────────────────────────────────────────────────────
 * Yanıtlardaki TÜM zaman damgaları ISO 8601 / UTC ("2026-08-07T09:24:00.000Z").
 * Sebep: veritabanı timestamptz tutuyor, lib fonksiyonları zaten ISO döndürüyor
 * ve istemcinin saat diliminden bağımsız tek bir mutlak an lazım.
 *
 * AMA gün sınırları (bugün / son 7 gün / özel aralık) VİYANA takvimine göre
 * hesaplanır — panelle aynı `lib/format.ts` yardımcılarıyla. Yani "bugün", mobil
 * cihazın saat dilimine göre değil, işletmenin gününe göre kesilir; panel ile
 * mobil aynı günü aynı yerden başlatır. Sorgu parametreleri `YYYY-MM-DD`.
 *
 * ── SAYFALAMA ─────────────────────────────────────────────────────────────
 * `?limit=` & `?offset=`. Varsayılan 50, tavan 200 — telefon ekranı ve zayıf
 * bağlantı için bilinçli olarak küçük. Yanıt daima `page` bloğu taşır:
 *   { limit, offset, total, hasMore }
 * `total` sunucudan gelen GERÇEK sayıdır (PostgREST `count: "exact"` ya da
 * sayfalanmış tam okumanın uzunluğu) — istemci "kaç tane var" sorusunu
 * tahmin etmez.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type PageParams = { limit: number; offset: number };

export function parsePage(url: URL): PageParams {
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { limit, offset };
}

export type PageInfo = {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
};

export function pageInfo(p: PageParams, total: number): PageInfo {
  return { ...p, total, hasMore: p.offset + p.limit < total };
}

/**
 * Aralık çözümü — panelle AYNI pencere dili.
 *
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` verilirse özel aralık; verilmezse
 * `?range=gun|hafta|ay|tumzaman` (varsayılan `hafta` = son 7 gün, KAYAN pencere).
 * Hepsi lib/analytics.ts computeAnalyticsRange üzerinden geçer — yönetici panosu,
 * Analiz ve raporlar da o fonksiyonu kullanıyor, ikinci bir pencere tanımı yok.
 *
 * ── TAKVİMDE OLMAYAN TARİH (12.08.2026) ───────────────────────────────────
 * `?from=2026-02-31` gibi biçimi doğru ama takvimde olmayan bir gün ARTIK
 * VARSAYILAN PENCEREYE düşer. Eskiden sessizce KAYIYORDU (3 Mart'tan başlayan
 * bir pencere kuruluyordu) — yani istemci yazdığı tarihin verisine baktığını
 * sanıyordu. Kapı lib/format.ts startOfDayViennaFromYmd'de; computeAnalyticsRange
 * null gördüğü an `fallback`a düşer.
 *
 * ⚠️ DÜŞÜŞ HÂLÂ SESSİZ: bu fonksiyonun hata kanalı yok (DateRange döner) ve tek
 * çağıranı `/api/mobile/alarms`. Yanlış pencere yerine varsayılan pencere
 * göstermek daha az zararlı, ama istemciye "tarihin geçersizdi" DEMİYOR.
 * 400 döndürmek o ucun sözleşmesini değiştirir — ayrı karar. Yeni uçlar
 * (`/driver-scores`) bu yüzden kendi katı ayrıştırıcısını kullanıyor.
 */
export function parseRange(url: URL): DateRange {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) return computeAnalyticsRange("ozel", from, to);
  const key = url.searchParams.get("range") ?? "hafta";
  const allowed: readonly string[] = ["gun", "hafta", "ay", "tumzaman"];
  const k = (allowed.includes(key) ? key : "hafta") as AnalyticsRangeKey;
  return computeAnalyticsRange(k);
}

/**
 * `YYYY-MM-DD` → Viyana gün başı/sonu; geçersizse null.
 *
 * "Geçersiz" artık TAKVİMİ de kapsıyor (12.08.2026, lib/format.ts): `2026-02-31`
 * null döner, eskiden 3 Mart sınırı üretiyordu. Buradaki `ymd` denetimi ÇAPA
 * içindir (ön ekli ISO damga gün sınırı sayılmasın); takvim kararı tek kaynakta.
 *
 * ⚠️ null = "SINIR YOK" demek. Tek çağıran `/api/mobile/shifts`: geçersiz bir
 * `?from=` artık pencereyi KAYDIRMIYOR ama sınırı da DÜŞÜRÜYOR, yani sonuç
 * kümesi daralmak yerine genişliyor. Yanlış pencereden iyi, sessizlikten kötü —
 * o ucu 400'e çevirmek sözleşme değişikliğidir, ayrı karar.
 */
export function parseYmdRange(
  from: string | null,
  to: string | null
): { start: Date | null; end: Date | null } {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  return {
    start: from && ymd.test(from) ? startOfDayViennaFromYmd(from) : null,
    end: to && ymd.test(to) ? endOfDayViennaFromYmd(to) : null,
  };
}
