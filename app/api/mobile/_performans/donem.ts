import "server-only";
import {
  addCalendarDaysVienna,
  startOfDayViennaFromYmd,
  viennaDayKey,
} from "@/lib/format";
import { computeAnalyticsRange, previousPeriod } from "@/lib/analytics";
import type { DateRange } from "@/lib/analytics-shared";
import type { PerformanceRow } from "@/lib/reports";

/**
 * SÜRÜCÜ PERFORMANSI — İKİ MOBİL UCUN ORTAK ÇEKİRDEĞİ.
 *
 * `/driver-scores` (filo listesi) ve `/workers/[id]/performans` (tek şoför) aynı
 * dönem dilini ve aynı satır biçimini kullanır. İkisi ayrı yazılsaydı bir gün
 * biri "hafta = son 7 gün", öteki "hafta = takvim haftası" derdi ve aynı şoför
 * iki ekranda iki farklı sıra alırdı.
 *
 * ⚠️ BU DOSYA ROUTE DEĞİLDİR. Klasör adı `_` ile başlıyor → Next yönlendirmeden
 * muaf tutar; `app/api/mobile/_performans/donem` diye bir uç OLUŞMAZ.
 *
 * ── DÖNEM DİLİ ────────────────────────────────────────────────────────────
 * `?donem=gun|hafta|ay` + `?tarih=YYYY-MM-DD` (tarih opsiyonel).
 *
 * Pencereler PANELİN KAYAN PENCERELERİDİR (lib/analytics.ts, 27.07.2026 kararı):
 *   gun   = 1 gün    hafta = son 7 gün    ay = son 30 gün
 * Takvim haftası/ayı DEĞİL. Gerekçe computeAnalyticsRange başlığında ölçümle
 * yazılı: takvim penceresi haftanın başında 0,56 güne çöküyor ve "haftalık" ile
 * "günlük" aynı sayıyı veriyordu.
 *
 * `tarih` VERİLMEZSE pencere `computeAnalyticsRange(donem)`den AYNEN gelir —
 * yani mobil, panelin o an gösterdiği sayının birebir aynısını döndürür. İkinci
 * bir pencere tanımı yazmıyoruz; yazsaydık iki yüzey sessizce ayrışırdı.
 *
 * `tarih` VERİLİRSE aynı uzunluktaki pencere o güne DEMİRLENİR: `tarih` pencerenin
 * SON günüdür, başlangıcı `tarih - (uzunluk-1)`. Böylece "geçen haftanın raporu"
 * istenebilir. Demirli pencere `tarih = bugün` ile çağrıldığında kayan pencereyle
 * BİREBİR aynı aralığı üretir (aynı iki yardımcı, aynı takvim) — iki yol tek yolun
 * iki girişi, ayrı hesap değil.
 *
 * ── ÖNCEKİ DÖNEM ──────────────────────────────────────────────────────────
 * `previousPeriod` (lib/analytics.ts) — aynı UZUNLUKTA, hemen önce biten pencere.
 * Panelin trend oku da onu kullanıyor. Filo başlangıcına (FLEET_EPOCH) dayanan
 * pencerede null döner ve o zaman sıra değişimi de HESAPLANMAZ; uydurulmuş bir
 * "0 değişim" göstermek, ölçüm olmadığını gizlemek olurdu.
 */

export const DONEMLER = ["gun", "hafta", "ay"] as const;
export type Donem = (typeof DONEMLER)[number];

/** Pencere uzunlukları — panelin SLIDING_WEEK_DAYS/SLIDING_MONTH_DAYS'iyle aynı. */
export const DONEM_GUNLERI: Record<Donem, number> = { gun: 1, hafta: 7, ay: 30 };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type DonemCozumu = {
  donem: Donem;
  /** İstemcinin verdiği demir tarih; verilmediyse null (kayan pencere). */
  tarih: string | null;
  gun: number;
  range: DateRange;
  /** Aynı uzunlukta önceki pencere; filo başlangıcına dayanıyorsa null. */
  onceki: DateRange | null;
};

export type DonemSonucu =
  | { ok: true; cozum: DonemCozumu }
  | { ok: false; kod: "invalid_donem" | "invalid_tarih" };

/**
 * Sorgu parametrelerinden dönemi çözer.
 *
 * GEÇERSİZ DEĞER SESSİZCE YUTULMAZ. `parseRange` (lib/mobile-list.ts) bilinmeyen
 * anahtarı haftaya düşürüyor; orada doğru, burada değil: bu iki uç bir İNSAN
 * hakkında sıra üretiyor. `?donem=ay` yazmak isteyip `?donem=aylik` yazan istemci
 * haftalık sayıları "aylık" diye gösterirdi ve hata hiçbir yerde görünmezdi.
 */
export function donemCoz(url: URL): DonemSonucu {
  const ham = url.searchParams.get("donem");
  const donem = (ham ?? "hafta") as Donem;
  if (!(DONEMLER as readonly string[]).includes(donem)) {
    return { ok: false, kod: "invalid_donem" };
  }

  const gun = DONEM_GUNLERI[donem];
  const tarih = url.searchParams.get("tarih");

  let range: DateRange;
  if (tarih === null || tarih === "") {
    // Panelin penceresi, AYNEN. Kopya hesap yok.
    range = computeAnalyticsRange(donem);
  } else {
    // ÇAPA: tam ISO damga ("2026-08-12T10:00Z") gün olarak kabul edilmesin —
    // startOfDayViennaFromYmd ön eke bilerek toleranslı.
    if (!YMD.test(tarih)) return { ok: false, kod: "invalid_tarih" };
    /**
     * TAKVİM DENETİMİ KAYNAKTA (12.08.2026): `startOfDayViennaFromYmd` var
     * olmayan günde null döner ("2026-02-31", "2026-13-01", "2026-02-29").
     * Burada ikinci bir takvim uygulaması TUTULMUYOR — tutulsaydı ikisi bir
     * gün ayrışırdı. Tek yapılan, null'ı 400'e çevirmek.
     */
    const son = startOfDayViennaFromYmd(tarih);
    if (!son) return { ok: false, kod: "invalid_tarih" };
    const ilk = addCalendarDaysVienna(son, -(gun - 1));
    range = computeAnalyticsRange("ozel", viennaDayKey(ilk), tarih);
  }

  return {
    ok: true,
    cozum: {
      donem,
      tarih: tarih === "" ? null : tarih,
      gun,
      range,
      onceki: previousPeriod(range),
    },
  };
}

/** Yanıtın `donem` bloğu — iki uçta da aynı alanlar. */
export function donemGovdesi(c: DonemCozumu) {
  return {
    tur: c.donem,
    tarih: c.tarih,
    gun: c.gun,
    baslangic: c.range.start.toISOString(),
    bitis: c.range.end.toISOString(),
    /** Demirli mi (tarih verildi) yoksa kayan mı (bugüne kadar). */
    demirli: c.tarih !== null,
  };
}

/**
 * SIRA HARİTASI — workerId → 1 tabanlı sıra.
 *
 * Sıra, `buildPerformanceReport`in KENDİ sıralamasıdır (skor yüksek→düşük,
 * skorsuzlar sonda vardiya sayısına göre). Burada yeniden sıralamıyoruz: panel
 * tablosu hangi sırayı gösteriyorsa mobil de onu gösterir.
 *
 * ⚠️ SKORSUZ SATIRIN SIRASI BİR PERFORMANS İDDİASI DEĞİLDİR. `safetyScore`
 * null olanlar listenin sonunda vardiya sayısına göre dizilir; o bölgedeki
 * sıra değişimi "daha iyi sürdü" demek değil, "daha çok vardiya açtı" demektir.
 * Bu yüzden her satır `yetersizVeri` bayrağını da taşır ve istemci ikisini
 * ayırabilir.
 */
export function siraHaritasi(rows: PerformanceRow[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.workerId, i + 1] as const));
}

export type MobilPerformansSatiri = ReturnType<typeof performansSatiri>;

/**
 * PerformanceRow → mobil JSON.
 *
 * ── İHLAL KIRILIMI BURADAN GELİR, ALARM UCUNDAN DEĞİL ─────────────────────
 * `sertFren/aniHizlanma/asiriHiz` doğrudan PerformanceRow'un alanlarıdır.
 * `/api/mobile/alarms` ucundan TÜRETİLMEZ ve türetilmemelidir: oradaki şoför
 * alanı olayın yaşandığı andaki şoför değil, ARACIN BUGÜNKÜ atanmış şoförüdür
 * (türetilmiş ayna). Geçen ayın ihlalini bu ay o aracı devralan kişiye yazmak
 * yanlış insanı suçlar — ve suçlama ekranda kalır.
 *
 * buildPerformanceReport olayları da araç→şoför eşlemesiyle bağlar; farkı,
 * eşlemenin GÜVENLİK SKORUYLA AYNI eşleme olmasıdır. Yani kırılım ile skor
 * aynı kaynaktan çıkar ve birbiriyle çelişemez.
 */
export function performansSatiri(
  r: PerformanceRow,
  sira: number,
  oncekiSira: number | null
) {
  return {
    workerId: r.workerId,
    adSoyad: r.name,
    sira,
    /** Önceki dönemde bu şoför rapora hiç girmediyse null (0 DEĞİL). */
    oncekiSira,
    /** Pozitif = yukarı çıktı. Önceki sıra yoksa null — sıfır uydurulmaz. */
    siraDegisimi: oncekiSira === null ? null : oncekiSira - sira,
    /** safetyScore null → skor hesaplanamadı (yeterli km yok). 0 ile ayrıdır. */
    yetersizVeri: r.safetyScore === null,
    guvenlikSkoru: r.safetyScore,
    vardiya: r.shifts,
    calismaMs: r.workedMs,
    /** null = sayaç okunamadı; 0 km sürdü DEMEK DEĞİL. */
    km: r.km,
    teslim: r.delivered,
    teslimEdilemeyen: r.undelivered,
    ihlal: {
      toplam: r.events,
      sertFren: r.harshBraking,
      aniHizlanma: r.harshAcceleration,
      asiriHiz: r.overspeeding,
    },
    /**
     * ── SKOR KAPISININ GEREKÇESİ (18.08.2026) ─────────────────────────────
     *
     * `yetersizVeri: true` bugüne kadar SESSİZ bir bayraktı: ekran "Yetersiz
     * veri" yazıyor, kullanıcı da bunu çoğu zaman "az çalıştı" diye okuyordu.
     * Canlıda ölçülen karşı örnek: 1.354 km sürmüş bir şoför de aynı etiketi
     * alıyor — sebebi km azlığı değil, vardiyalarının ölçülemeyen kısmı.
     * Dört alan o cümleyi tamamlar ve istemci artık "eksik olan ne" sorusunu
     * cevaplayabilir.
     *
     * DEĞERLER RAPORUN KARAR NOKTASINDAN GELİR (lib/reports.ts), burada
     * yeniden hesaplanmaz — hesaplansaydı ekran ile kapı ayrışabilirdi.
     */
    /** Bu şoför için hesaplanan km eşiği. Sabit DEĞİL — kişiye göre ölçeklenir. */
    esikKm: r.scoreMinKm,
    /** Skorun paydası olan ölçülen km; null = ölçülemedi ("0 km sürdü" DEĞİL). */
    olculenKm: r.scoreKm,
    /** Km'si ölçülebilen vardiya oranı 0–1; ölçüm penceresi yoksa null. */
    kapsama: r.scoreCoverage,
    /**
     * Skor neden yok: `km_yetersiz` | `kapsama_dusuk` | `vardiya_yok` | null.
     * `yetersizVeri === (sebep !== null)` — biri diğerinin gerekçesidir, ikisi
     * asla çelişemez çünkü ikisi de aynı `safetyScore` alanından türer.
     */
    sebep: r.scoreGate,
  };
}
