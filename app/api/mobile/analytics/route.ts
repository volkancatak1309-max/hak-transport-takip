import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  computeTopDriversByType,
  computeIdleWaste,
  listVehiclesAndWorkers,
  rangeElapsedDays,
} from "@/lib/analytics";
import {
  TOP10_EVENT_TYPES,
  IDLE_FUEL_L_PER_HOUR,
  DIESEL_EUR_PER_L,
  type DateRange,
  type VehicleLite,
  type WorkerLite,
} from "@/lib/analytics-shared";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { buildPerformanceReport } from "@/lib/reports";
import {
  getLatestConfigEpoch,
  rangeStartsBeforeEpoch,
  comparisonCrossesEpoch,
} from "@/lib/config-epoch";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";
import { aralikCoz, aralikHataAlanlari } from "../_rapor/aralik";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/analytics — MOBİL ANALİZ EKRANININ FİLO ÖZETİ.
 *
 * `?range=gun|hafta|ay|tumzaman|ozel` (+ `?from=&to=` YYYY-MM-DD, yalnız `ozel`).
 *
 * ── TEK KAYNAK: PANELİN KENDİ FONKSİYONLARI ───────────────────────────────
 * Burada HİÇBİR metrik yeniden hesaplanmaz. Her sayı panelin çalıştırdığı
 * fonksiyondan olduğu gibi gelir:
 *   pencere / önceki pencere → computeAnalyticsRange + previousPeriod
 *   vardiya / km / süre / skor → buildPerformanceReport   (Raporlar › Performans)
 *   alarm tür kırılımı         → computeTopDriversByType   (/admin/analiz Top-10)
 *   rölanti israfı             → computeIdleWaste          (/admin/analiz panosu)
 *   trend kapısı               → comparisonCrossesEpoch    (lib/config-epoch.ts)
 * İkinci bir tanım yazılsaydı "panel 412 diyor, telefon 409 diyor" durumu
 * doğardı ve hangisinin doğru olduğunu kimse söyleyemezdi.
 *
 * ── DÖNEM DİLİ `/driver-scores`TEN NEDEN FARKLI ───────────────────────────
 * `/driver-scores` `?donem=gun|hafta|ay` + `?tarih=` kullanır (demirlenebilir
 * pencere, sıralama ekranı için). Bu uç ANALİZ SAYFASININ dilini konuşur:
 * `?range=` + `?from/to=`, çünkü Analiz ekranının seçicisinde "Tüm zamanlar" ve
 * "Özel aralık" var, demir tarih yok. İki farklı ekran, iki farklı seçici;
 * birini ötekine benzetmek istemcinin ekranını değil, yalnız bu dosyayı
 * güzelleştirirdi.
 *
 * ── GEÇERSİZ TARİH SESSİZCE YUTULMAZ ──────────────────────────────────────
 * `computeAnalyticsRange("ozel", …)` geçersiz tarihte SESSİZCE son 7 güne
 * düşer (lib/analytics.ts) — panel için doğru, bir API için değil: istemci
 * yazdığı tarihin verisine baktığını sanırdı. Bu yüzden `from/to` burada ÖNCE
 * doğrulanır ve geçersizse 400 döner. Doğrulama ikinci bir takvim uygulaması
 * DEĞİL: kararı `startOfDayViennaFromYmd`/`endOfDayViennaFromYmd` verir, yani
 * pencereyi kuran fonksiyonun ta kendisi (`/driver-scores` ile aynı desen).
 *
 * `range=ozel` ama tarih verilmemişse panelin davranışı korunur (son 7 güne
 * düşer) — o kombinasyon panelin URL'inde de geçerli ve `bitis/baslangic`
 * yanıtta zaten açıkça yazılı.
 *
 * ── ÖNCEKİ DÖNEM: SAYILAR DÖNER, KARŞILAŞTIRMA KARARI İSTEMCİDE DEĞİL ─────
 * `oncekiDonem` bloğu aynı toplamları önceki pencere için taşır. `trendBloke`
 * ise o iki pencerenin KIYASLANABİLİR olup olmadığını söyler.
 *
 * Panel bu durumda önceki dönemi HİÇ YÜKLEMEZ (analiz/page.tsx) — bir RENDER
 * yüzeyi için doğru karar: gösterilmeyecek veriyi çekmek boşuna sorgudur.
 * Burada sayılar yine de dönüyor çünkü bu bir VERİ ucu: "geçen ayın toplam
 * vardiyası" tek başına meşru bir ölçüdür; yasak olan şey iki dönemi bir OK
 * ile birbirine bağlamaktır. `trendBloke: true` gördüğünde istemci fark/ok/yüzde
 * GÖSTERMEMELİDİR — cetvel değişmiştir, iyileşen sürüş değil ölçü birimidir.
 *
 * ── `trendBloke` NE ZAMAN TRUE ────────────────────────────────────────────
 * `device_config_epochs`teki EN SON eşik değişimi sınırını, iki pencereden biri
 * ortadan kesiyorsa ya da ikisi sınırın farklı taraflarındaysa (lib/config-epoch.ts).
 * Tablo yoksa / kayıt yoksa false döner ve hiçbir şey değişmez.
 * `esikNotu` ise ayrı bir sorudur: görüntülenen aralık sınırdan ÖNCE başlıyorsa
 * true — karşılaştırma yapılmasa bile o aralıktaki olay sayısı iki farklı
 * cetvelin karışımıdır.
 *
 * ── EŞZAMANLILIK ──────────────────────────────────────────────────────────
 * Dönemler ARDIŞIK yüklenir. `buildPerformanceReport` içindeki `loadBase` araç
 * başına iki sorguyu `mapBounded(6)` ile yürütüyor (lib/db-fanout.ts); iki
 * dönemi birlikte koşturmak o tavanı 12'ye çıkarırdı ve ölçülmüş ders şudur:
 * statement timeout İFADEYE uygulanır, eşzamanlılığı artırmak payı düşürür.
 * `/driver-scores` de aynı sebeple ardışık çalışıyor.
 *
 * ⚠️ OLAYLAR İKİ KEZ OKUNUYOR. `loadBase` aralığın olaylarını kendi içinde
 * çekiyor ama dışa vermiyor; tür kırılımı ve rölanti panosu için burada ikinci
 * kez çekiliyor. Bilinçli bedel: alternatif, `lib/reports.ts`in imzasını
 * değiştirmekti ve bu uç mevcut yüzeylerin davranışına dokunmamalı. Ölçüldü —
 * 30 günde 4.965 olay / 1.135 rölanti epizodu, sayfalı okuma ile saniyenin
 * altında.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Panel paritesi: `/admin/analiz` `requireAdmin()` ile korunuyor, filo şefi
 * ve şoför giremiyor → burada da 403 `admin_required`. Şefin kendi filosunun
 * analizini görmesi AYRI bir karardır (farklı kapı, farklı kapsam) ve bu turun
 * kapsamında değil.
 */

/**
 * ⚠️ ARALIK ÇÖZÜMLEYİCİSİ BURADAN TAŞINDI (18.08.2026) → `../_rapor/aralik.ts`.
 * Sebep: CSV uçları da AYNI pencere dilini konuşmak zorunda ve iki kopya bir
 * gün ayrışırdı. Davranış birebir aynı — beş anahtar, aynı hata kodları, aynı
 * doğrulama sırası (bkz. o dosyanın başlığı).
 */

/** Bir dönemin TÜM toplamları — iki dönem için de aynı fonksiyon çağrılır. */
async function donemToplami(
  range: DateRange,
  vehicles: VehicleLite[],
  workers: WorkerLite[]
) {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  // Sıra önemli: rapor kendi içinde mapBounded(6) kullanıyor, olay okumaları
  // ondan SONRA (bkz. eşzamanlılık notu).
  const rapor = await buildPerformanceReport(range);
  const [events, idleEpisodes] = await Promise.all([
    listEventsInRange(startISO, endISO),
    listIdleEpisodesInRange(startISO, endISO),
  ]);

  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));
  const topByType = computeTopDriversByType(events, idleEpisodes, vehiclesById, workersById);
  const idle = computeIdleWaste(idleEpisodes, vehiclesById, workersById);

  /**
   * TÜR KIRILIMI — panelin Top-10 başlıklarındaki sayının AYNISI.
   * `idling` sayısı `vehicle_events`ten DEĞİL, rölanti EPİZODLARINDAN gelir:
   * cihazın idle bayrağı rölanti sürdükçe tekrar geliyor ve nokta-olay modeli
   * tek bir 25 dakikalık rölantiyi beş satıra bölüyordu (bkz. lib/telemetry.ts).
   * Panel de aynı sebeple `vehicle_events` içindeki `idling` satırlarını atlar.
   */
  const tur: Record<string, number> = {};
  for (const ty of TOP10_EVENT_TYPES) tur[ty] = topByType[ty].total;

  /**
   * KAPSAM DIŞI OLAY — sessiz eksik YASAK.
   *
   * `tur` yalnız TOP10_EVENT_TYPES'i sayar. Cihaz bir gün başka bir tip
   * göndermeye başlarsa (ya da eski bir tip tabloda kalmışsa) `alarm.toplam`
   * sessizce eksik kalırdı ve kimse fark etmezdi. Sayaç bunu GÖRÜNÜR yapar:
   * canlıda bugün 0 (ölçüldü — tabloda yalnız harsh_acceleration /
   * harsh_cornering / harsh_braking / overspeeding / jamming var).
   *
   * `idling` burada kapsam dışı SAYILMAZ: o tip zaten epizodlardan geliyor ve
   * `vehicle_events`teki eski nokta-olay satırları bilerek atlanıyor.
   */
  const bilinen = new Set<string>([...TOP10_EVENT_TYPES]);
  const kapsamDisi = events.filter(
    (e) => !bilinen.has(e.event_type) && e.event_type !== "idling"
  ).length;

  const alarmToplam = Object.values(tur).reduce((s, n) => s + n, 0);
  const yetersiz = rapor.rows.filter((r) => r.safetyScore === null).length;

  return {
    vardiya: rapor.totalShifts,
    calismaMs: rapor.totalWorkedMs,
    /**
     * YALNIZ ÖLÇÜLEBİLEN VARDİYALARIN toplamı. Cihazı sessiz vardiyada
     * `end_km - start_km` bayat odometreden 0 çıkıyor ve bu 0 bir ölçüm değil
     * (lib/km-quality.ts). Eksik bir toplamı "tam" gibi göstermemek için
     * kapsama sayaçları YANINDA döner.
     */
    km: rapor.totalKm,
    kmKapsama: {
      olculenVardiya: rapor.kmMeasuredShifts,
      olculemeyenVardiya: rapor.kmUnmeasuredShifts,
    },
    skor: {
      /** false → panel skoru HİÇ göstermiyor; istemci de göstermemeli. */
      kalibre: SAFETY_SCORE_CALIBRATED,
      ortalama: rapor.avgScore,
      skorlanan: rapor.scoredCount,
      /** safetyScore null olan şoför sayısı — "yetersiz veri". */
      yetersizVeri: yetersiz,
      soforSayisi: rapor.rows.length,
    },
    alarm: {
      /** Σ tur — filo geneli, ATANMAMIŞ araçların olayları DAHİL. */
      toplam: alarmToplam,
      tur,
      /** Skora/kırılıma girmeyen bilinmeyen tipteki olay sayısı. 0 olmalı. */
      kapsamDisi,
    },
    rolanti: {
      toplamMs: idle.totalMs,
      epizod: idleEpisodes.length,
      litre: (idle.totalMs / 3_600_000) * IDLE_FUEL_L_PER_HOUR,
      /** TAHMİN — katsayılar yanıtın `rolantiKatsayi` bloğunda. */
      euro: idle.totalEuro,
    },
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const cozum = aralikCoz(url);
  if (!cozum.ok) {
    // Geçerli küme yanıtta: istemci hangi değerin kabul edildiğini dokümana
    // bakmadan görsün (`/driver-scores` ile aynı sözleşme).
    return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));
  }
  const c = cozum.cozum;

  const epoch = await getLatestConfigEpoch();
  const trendBloke =
    !!c.onceki &&
    comparisonCrossesEpoch(c.range.start, c.range.end, c.onceki.start, c.onceki.end, epoch);

  // Araç/şoför evreni İKİ dönem için de aynı (bugünkü kadro) — panelin
  // /admin/analiz sayfası da tek kez okuyup iki döneme veriyor.
  const { vehicles, workers } = await listVehiclesAndWorkers();

  const toplam = await donemToplami(c.range, vehicles, workers);
  // Ardışık — yukarıdaki eşzamanlılık notu.
  const oncekiToplam = c.onceki ? await donemToplami(c.onceki, vehicles, workers) : null;

  return Response.json({
    ok: true,
    donem: {
      tur: c.tur,
      baslangic: c.range.start.toISOString(),
      bitis: c.range.end.toISOString(),
      /** Pencerenin ŞİMDİYE KADAR geçen gün sayısı (en az 1) — panelin ölçüsü. */
      gecenGun: rangeElapsedDays(c.range),
      /** `range=ozel` için istemcinin verdiği ham tarihler; yoksa null. */
      from: c.from,
      to: c.to,
    },
    /**
     * ⚠️ true → İKİ DÖNEM FARKLI CETVELLE ÖLÇÜLDÜ. İstemci fark/ok/yüzde
     * GÖSTERMEMELİ; sayılar ayrı ayrı okunabilir ama birbirine bağlanamaz.
     * Bu alan olmadan mobil sahte bir "iyileşme" oku çizerdi — eşik
     * gevşetildiğinde olay sayısı düşer ve düzelen sürüş değil ölçüdür.
     */
    trendBloke,
    /** Görüntülenen aralık eşik değişiminden ÖNCE başlıyor mu (karışık veri). */
    esikNotu: rangeStartsBeforeEpoch(c.range.start, epoch),
    /** Eşik değişiminin anı ve notu — istemci uyarıyı tarihiyle yazabilsin. */
    esikDegisimi: epoch
      ? { an: epoch.changedAt.toISOString(), not: epoch.note, params: epoch.params }
      : null,
    toplam,
    oncekiDonem: c.onceki
      ? {
          baslangic: c.onceki.start.toISOString(),
          bitis: c.onceki.end.toISOString(),
          toplam: oncekiToplam,
        }
      : null,
    /**
     * Önceki dönem NEDEN yok — "null" tek başına sessizdir. `tumzaman`da ve
     * filo başlangıcına dayanan pencerede önceki dönem TANIMSIZDIR; uydurulmuş
     * bir "0 değişim" göstermek, ölçüm olmadığını gizlemek olurdu.
     */
    oncekiDonemYok: c.onceki ? null : "filo_baslangici",
    /** Rölanti € tahmininin katsayıları — sayı bir ölçüm değil, kestirimdir. */
    rolantiKatsayi: { litreSaat: IDLE_FUEL_L_PER_HOUR, euroLitre: DIESEL_EUR_PER_L },
  });
}
