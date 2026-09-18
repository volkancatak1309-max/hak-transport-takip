import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  computeTopDriversByType,
  computeIdleWaste,
  idlePlateResolver,
  ROLANTI_SATIR_TAVANI,
  computeOwnerlessEvents,
  getWorkerShiftDistance,
  shiftWindowsForScoring,
  listVehiclesAndWorkers,
  rangeElapsedDays,
} from "@/lib/analytics";
import {
  TOP10_EVENT_TYPES,
  IDLE_FUEL_L_PER_HOUR,
  type DateRange,
  type VehicleLite,
  type WorkerLite,
} from "@/lib/analytics-shared";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { buildPerformanceReport } from "@/lib/reports";
import { kmEkseniCoz, kmPencere, kaynakSay } from "@/lib/km-axis";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import type { KmShiftRow } from "@/lib/km-quality";
import {
  getLatestConfigEpoch,
  rangeStartsBeforeEpoch,
  comparisonCrossesEpoch,
} from "@/lib/config-epoch";
// co2Panosu import'u KALDIRILDI (28.08.2026) — CO₂ artık
// `/api/mobile/analytics/co2` ucunda. Gerekçe aşağıda, `co2` alanının başında.
import { SAFETY_SCORE_CALIBRATED, FUEL_PRICE_EUR_PER_L } from "@/lib/tenant";
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

  /**
   * Etiket dağılımı: aralıktaki vardiyalar TEK RPC ile çözülür (ölçüldü: 30
   * günlük pencere 425 vardiya / 153 ms). Sayıya DOKUNMAZ.
   *
   * ⚠️ EVREN `buildPerformanceReport` İLE BİREBİR OLMAK ZORUNDA. İlk yazımda
   * eleme yoktu ve `lint:test-filters` yakaladı: dağılım, `km` toplamının
   * saymadığı vardiyaları da sayardı — "bu toplamın kaçı cihazdan gelirdi"
   * sorusunun cevabı, toplamın kendi evreninden BAŞKA bir kümede hesaplanmış
   * olurdu. İki eleme de aynı sırayla uygulanıyor (lib/reports.ts:409-433).
   */
  const kmScope = await getTestScope();
  const kmDriverScope = await getDriverScope();
  // test-filtered + driver-scoped: rapor toplamıyla AYNI küme.
  const { data: kmRows } = await onlyDrivers(
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, vehicle_id, started_at, ended_at, start_km, end_km")
        .gte("started_at", startISO)
        .lte("started_at", endISO),
      "worker_id",
      kmScope.workerIds
    ),
    "worker_id",
    kmDriverScope
  );
  const kmGirdi = (kmRows ?? []) as (KmShiftRow & { id: string })[];
  const kmPen = kmPencere(kmGirdi);
  const kmCoz = kmPen ? await kmEkseniCoz(kmGirdi, kmPen) : null;
  const kmDagilim = kmCoz ? kaynakSay(kmGirdi, kmCoz.karar) : null;
  const kmEksenDurum = kmCoz?.bDurumu ?? null;
  const [events, idleEpisodes] = await Promise.all([
    listEventsInRange(startISO, endISO),
    listIdleEpisodesInRange(startISO, endISO),
  ]);

  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const workersById = new Map(workers.map((w) => [w.id, w]));
  const topByType = computeTopDriversByType(events, idleEpisodes, vehiclesById, workersById);
  const idle = computeIdleWaste(idleEpisodes, vehiclesById, workersById);
  const idlePlaka = idlePlateResolver(vehicles, vehiclesById);

  /**
   * SAHİPSİZ OLAY (20.08.2026) — panelin /admin/analiz kartıyla AYNI fonksiyon.
   *
   * ⚠️ EK MALİYET: bir `getWorkerShiftDistance` çağrısı (052 RPC'si). Rapor
   * kendi içinde de çağırıyor ama sonucu dışarı vermiyor; ikinci bir çağrı,
   * `buildPerformanceReport`ın imzasını değiştirmekten ucuz ve risksiz.
   * 052'siz kiracıda (Sendigo/Galzura) `shiftWindowsForScoring` undefined döner
   * ve sayaç ESKİ ATAMA eksenine düşer — yani sahipsiz ≈ 0, panelle aynı.
   */
  const sahipsiz = computeOwnerlessEvents(
    events,
    idleEpisodes,
    vehiclesById,
    workersById,
    shiftWindowsForScoring(await getWorkerShiftDistance(startISO, endISO))
  );

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
    /**
     * 13. madde Adım 2 — YALNIZ ETİKET. `km` hâlâ A ekseninde (rapor.totalKm,
     * yani kmDiff toplamı). Bu blok "kural açılsa bu toplamın kaç vardiyası
     * hangi eksenden gelirdi" sorusunu cevaplar. Toplam TEK eksenden gelmediği
     * için yanına tek bir kmKaynak yazmak yalan olurdu.
     */
    kmKaynakDagilim: kmDagilim,
    kmEkseni: { durum: kmEksenDurum ?? "hazir" },
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
    /**
     * SAHİPSİZ OLAY — `alarm.toplam` ile skor tablosunun topladığı sayı
     * arasındaki köprü. YENİ ALAN (20.08.2026); mevcut alanların hiçbiri
     * değişmedi.
     *
     * KİMLİK: `skorlanabilir === yazilan + sahipsiz + kadroDisi`. İstemci
     * "toplam neden tutmuyor" sorusunu artık kendi başına cevaplayabilir.
     * ⚠️ `skorlanabilir` ile `alarm.toplam` aynı evreni sayar (ağırlığı olan
     * alarmlar + rölanti epizodları) ama ikisi FARKLI fonksiyondan gelir;
     * eşitliği scripts/verify-sahipsiz-olay.mjs canlıda denetler.
     */
    sahipsizOlay: {
      skorlanabilir: sahipsiz.scorable,
      yazilan: sahipsiz.attributed,
      sahipsiz: sahipsiz.ownerless,
      /** Vardiyası var ama kadroda yok — canlıda 0 beklenir. */
      kadroDisi: sahipsiz.outOfRoster,
      /** Sahipsiz olayların araç kırılımı, çoktan aza. İlk 5 panelde katlanır. */
      araclar: sahipsiz.vehicles.map((v) => ({
        aracId: v.vehicleId,
        plaka: v.plate,
        adet: v.count,
        /** Aralıkta bu araç için açılmış vardiya sayısı; 0 = hiç kayda girmemiş. */
        vardiya: v.shifts,
        atanmisAd: v.assignedName,
      })),
    },
    rolanti: {
      toplamMs: idle.totalMs,
      epizod: idleEpisodes.length,
      litre: (idle.totalMs / 3_600_000) * IDLE_FUEL_L_PER_HOUR,
      /** TAHMİN — katsayılar yanıtın `rolantiKatsayi` bloğunda. */
      euro: idle.totalEuro,
      /**
       * ══ ŞOFÖR SATIRLARI (18.09.2026) ══════════════════════════
       *
       * ÖNCEDEN YALNIZ TOPLAMLAR VARDI ve şoför kırılımı tek bir yerde yaşıyordu:
       * `/api/mobile/dashboard` → `rolanti.gun7.satirlar`. O uç SORGU PARAMETRESİ
       * ALMIYOR (pencereler sabit: bugün ve 7 gün), yani mobilde "30 günde kim ne
       * kadar rölanti yaptı" sorusunun cevabı HİÇ YOKTU — bugün için bile yoktu
       * (`bugun` bloğunda satır yok, yalnız toplam).
       *
       * 🔑 SATIRLAR ZATEN HESAPLANIYORDU. `computeIdleWaste` bu uçta da çağrılıyor
       * ve `rows` üretiyor; yalnız yanıta yazılmıyordu. Yeni sorgu YOK, yeni
       * formül YOK, yeni uç YOK — bu uç zaten `?range=gun|hafta|ay|tumzaman`
       * alıyor ve ölçüm o pencereden çıkıyor (ölçüldü: gün/hafta/ay üçünde de
       * toplamlar ve epizod sayıları pencereyle birlikte değişiyor).
       *
       * ⚠️ DASHBOARD'UN SÖZLEŞMESİYLE BİREBİR: alan adları (`ad`, `plaka`, `ms`,
       * `euro`, `olayAdedi`), sıralama (en uzun önce, `computeIdleWaste`in kendi
       * sırası), tavan ve kırpılma bayrağı aynı. Mobil İKİNCİ BİR AYRIŞTIRICI
       * yazmak zorunda kalmasın; tek fark hangi pencereden geldiği.
       *
       * ⚠️ LİTRE SATIRDA YOK: dashboard sözleşmesinde de yok. `ms`ten
       * `rolantiKatsayi.litreSaat` ile türetilir — aynı sayıyı iki kez
       * göndermek, iki farklı yuvarlamayla iki farklı litre demekti.
       */
      satirlar: idle.rows.slice(0, ROLANTI_SATIR_TAVANI).map((row) => ({
        ad: row.name,
        plaka: idlePlaka(row.key),
        ms: row.totalMs,
        euro: row.euro,
        olayAdedi: row.episodeCount,
      })),
      satirTavani: ROLANTI_SATIR_TAVANI,
      /** Tavan yüzünden listeye girmeyen şoför var mı (toplamlar TAM kalır). */
      kirpildi: idle.rows.length > ROLANTI_SATIR_TAVANI,
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

  /**
   * ═══ 🔴 CO₂ BURADAN ÇIKARILDI (28.08.2026) — ÖLÇÜMLE ══════════════════
   *
   * `co2Panosu()` bu satırda çağrılıyordu ve ekranın AÇILIŞINI rehin
   * alıyordu. Ölçüldü (HAK61 canlı, salt okuma):
   *
   *     bu uç TOPLAM        1.301 çağrı · 41,8 sn
   *       └─ co2Panosu()    1.115 çağrı · 36,7 sn   ← %86
   *
   * Sebep `lib/co2-db.ts:415` → `aylikSeri()`: son 6 ay `for` döngüsünde,
   * SIRAYLA, her ay için tam bir `buildFuelReport`. Yani 1 + 6 = 7 ardışık
   * yakıt raporu (tek rapor ölçüldü: 171 çağrı / 11,0 sn).
   *
   * Mobil istemci 14 sn ve 30 sn'de vazgeçiyordu → Analiz ekranı veriye
   * HİÇ ulaşamıyordu. Tek satırlık bir CO₂ özeti bütün ekranı düşürüyordu.
   *
   * ⚠️ VE İSRAF: bu uç `co2Panosu`nun YALNIZCA `toplam` + `ayar` + `hedef`
   * alanlarını okuyordu. `aylik`, `araclar`, `soforler`, `musteriler` hiç
   * kullanılmıyordu — yani 7 raporun 6'sı hesaplanıp ATILIYORDU.
   *
   * Yeni yer: `GET /api/mobile/analytics/co2` (aynı aralık dili, aynı yetki).
   * Ayrıntı: `docs/ANALIZ-YAVASLIK.md` · `docs/MOBIL-CO2-AYIRMA.md`.
   *
   * ═══ ALAN NEDEN SİLİNMEDİ ═════════════════════════════════════════════
   *
   * `co2` anahtarı ŞEKLİYLE duruyor, yalnız değerleri null. Silseydik
   * `data.co2.kg` okuyan bugünkü istemci PATLARDI. `kg: null` ise bu ucun
   * ZATEN belgelenmiş ve istemcide karşılanan bir durumu ("ölçülemedi").
   * Yani bu geçiş istemci güncellenmeden de güvenlidir: CO₂ satırı
   * "ölçülemedi" gösterir, ekranın geri kalanı AÇILIR.
   */
  const co2 = {
    kg: null,
    gKm: null,
    litre: null,
    esas: null,
    kapsama: { olculen: 0, toplam: 0, olculemeyenPlakalar: [] as string[] },
    hedefGKm: null,
    hedefTuttu: null,
    /**
     * 🔑 İSTEMCİ İÇİN GEÇİŞ İŞARETİ. Doluysa: "CO₂ bu uçta HESAPLANMADI,
     * ölçülemedi DEĞİL". İstemci bu alanı görüyorsa CO₂ satırını gizlemeli
     * ya da sekmeye yönlendirmeli; "0 kg" ya da "ölçülemedi" YAZMAMALI.
     */
    ayriUc: "/api/mobile/analytics/co2",
  };
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
    /**
     * CO₂ (089) — 🔴 ARTIK BU UÇTA HESAPLANMIYOR (28.08.2026).
     *
     * Alan ŞEKLİYLE duruyor ama bütün değerleri null ve `ayriUc` dolu:
     * hesap `GET /api/mobile/analytics/co2` ucuna taşındı (aynı aralık dili,
     * aynı yetki). Sebep: `co2Panosu()` bu ucun 41,8 sn'sinin 36,7'siydi ve
     * istemci 14/30 sn'de vazgeçtiği için EKRANIN TAMAMI açılmıyordu.
     *
     * ⚠️ İSTEMCİ AYRIMI YAPMALI — `ayriUc` doluysa CO₂ "ölçülemedi" DEĞİL,
     * "burada hesaplanmadı"dır. İkisini karıştırmak, ölçülemeyen bir dönemi
     * ölçülmüş gibi göstermek kadar yanlıştır.
     *
     * Yeni uçtaki `ozet` alanı bu nesnenin BİREBİR aynı şeklidir; istemcinin
     * mevcut çizim kodu oradan beslenebilir. Orada `kg` null ise ANLAMI
     * eskisi gibidir: ölçülemedi, sıfır değil.
     */
    co2,
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
    rolantiKatsayi: { litreSaat: IDLE_FUEL_L_PER_HOUR, euroLitre: FUEL_PRICE_EUR_PER_L },
  });
}
