import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { getDashboardData, type AttentionItem } from "@/lib/admin-dashboard";
import { buildPerformanceReport } from "@/lib/reports";
import {
  computeAnalyticsRange,
  computeIdleWaste,
  listVehiclesAndWorkers,
} from "@/lib/analytics";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
} from "@/lib/telemetry";
import { alarmKademe } from "@/lib/event-ui";
import { listPendingLeaves, type PendingLeave } from "@/lib/leaves";
import { LEAVES_ENABLED } from "@/lib/features";
import { listActiveSnoozes, ERTELEME_LISTE_TAVANI } from "@/lib/action-snoozes-db";
import { lookupDtc } from "@/lib/dtc-codes";
import { DEFAULT_LOCALE } from "@/i18n/request";
import { startOfTodayVienna, endOfTodayVienna } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/dashboard — açılış özeti.
 *
 * KAPI: requireMobileFleetView ↔ /admin sayfasının requireFleetView()'i.
 * HESAP YOK: sayıların tamamı getDashboardData() ve buildPerformanceReport()
 * çıktısından olduğu gibi taşınır — panelin okuduğu iki fonksiyonun aynısı.
 * Burada tek bir toplama/bölme yapılmaz, aksi hâlde panel ile app ayrışırdı.
 *
 * Pencere: pano bugünün penceresiyle (Viyana günü) beslenir — app/admin/page.tsx
 * varsayılanı "today" ile aynı. Performans kutuları ayrı ve KAYAN 7 gün
 * (computeAnalyticsRange("hafta")) — /admin/raporlar/performans varsayılanının
 * birebir aynısı.
 *
 * ── GERİYE UYUMLULUK (10.08.2026) ─────────────────────────────────────────
 * Uç üç kurulumda canlı (HAK61, Sendigo, galzura-demo). Bu turda YALNIZ ALAN
 * EKLENDİ: `uyari.kalemler`, `uyari.kalemTavani`, `uyari.kirpildi`,
 * `filo.sinyalYok`, `performans7g.gunluk`, `dtc`. Mevcut alanların hiçbirinin
 * adı, tipi ya da değeri değişmedi (`dtcAracSayisi` dahil — yeni `dtc` dizisi
 * onun YERİNE değil YANINA geldi). Eski istemci bilmediği anahtarı yok sayar.
 *
 * ── GERİYE UYUMLULUK, 2. TUR (10.08.2026 — komuta merkezi) ────────────────
 * Yine YALNIZ ALAN EKLENDİ: `roster` (+`rosterTavani`/`rosterKirpildi`),
 * `rolanti`, `alarm`, `onayBekleyen`, `filo.vardiyaliArac`,
 * `uyari.kalemler[].an`, `dtc[].kodlar` (+`kodKirpildi`, üst düzey
 * `dtcKodTavani`). Mevcut alanların adı/tipi/değeri değişmedi.
 *
 * ── GERİYE UYUMLULUK, 3. TUR (11.08.2026 — erteleme, migration 058) ───────
 * Yine YALNIZ ALAN EKLENDİ: `ertelemeler`, `ertelemeDurumu`, `ertelemeToplam`,
 * `ertelemeTavani`, `ertelemeKirpildi`. Mevcut alanların adı/tipi/değeri
 * değişmedi ve `uyari.kalemler` ile `onayBekleyen.izin` SÜZÜLMEDİ — erteleme
 * bir GÖRÜNÜM kararıdır ve istemcide uygulanır.
 *
 * YETKİ (panel paritesi, lib/mobile-scope.ts kuralı): `rolanti` ve `alarm`
 * PATRON verisidir — panel karşılıkları /admin/analiz ve /admin/alarmlar
 * requireAdmin() ile şefe KAPALI. Filo şefinde bu iki alan `null` döner
 * (0 değil: 0 "rölanti yok" derdi, null "bu veri sana açık değil" der).
 * `onayBekleyen.izin` şefte adet:0 — şef kendi açtığı talebi onaylayamaz,
 * çanına onay işi düşmez (Volkan kararı, görev tanımı 10.08.2026).
 *
 * `alarm.acik` TANIMI (ölçüldü, 10.08.2026): vehicle_events/idle_episodes'ta
 * çözüm/kapatma durumu YOK (şemada resolved kolonu yalnız driver_reports'ta).
 * "Açık alarm" = alarm ekranının VARSAYILAN penceresindeki (kayan 7 gün,
 * lib/mobile-list.ts parseRange varsayılanı) alarm sayısı — karttaki sayı,
 * karta dokununca açılan /api/mobile/alarms listesiyle birebir aynı olsun diye.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { fleetScope, isChief, fleet } = guard.actor;

  const start = startOfTodayVienna();
  const end = endOfTodayVienna();
  const perfRange = computeAnalyticsRange("hafta");
  // Rölanti "bugün" penceresi — Analiz sayfasının "Bugün" seçiminin aynısı.
  const gunRange = computeAnalyticsRange("gun");

  const [dash, perf, patron, ertelemeler] = await Promise.all([
    getDashboardData(start.toISOString(), end.toISOString(), fleetScope),
    buildPerformanceReport(perfRange),
    // Patron blokları (rölanti + alarm + onay bekleyen izin) — şefte hiç
    // sorgulanmaz (panel paritesi; boşuna veri de çekilmez).
    isChief ? Promise.resolve(null) : loadPatronBlocks(gunRange, perfRange),
    listActiveSnoozes(),
  ]);

  // Açık uyarı sayısı türü kırılımıyla — telefonda "12 uyarı" tek başına
  // eyleme dönüşmüyor, hangi türden kaç tane olduğu lazım.
  const uyariKirilim: Record<string, number> = {};
  for (const a of dash.attention) uyariKirilim[a.kind] = (uyariKirilim[a.kind] ?? 0) + 1;

  // Kalemlerin kendisi de taşınır ama TAVANLI: 30 araçlık bir filoda tek bir
  // belge turu 60 kalem üretebiliyor ve tavansız bir dizi yanıtı telefon
  // bağlantısında şişirirdi. Tavan TÜR BAŞINA: en kalabalık tür diğerlerini
  // listeden atamaz. Kırpılan sayı gizlenmiyor — `uyariKirilim` her türün
  // GERÇEK toplamını taşımaya devam ediyor, `kirpildi` de bunu açıkça söylüyor.
  const alinan: Record<string, number> = {};
  const kalemler: UyariKalemi[] = [];
  for (const a of dash.attention) {
    const n = alinan[a.kind] ?? 0;
    if (n >= UYARI_KALEM_TAVANI) continue;
    alinan[a.kind] = n + 1;
    kalemler.push(uyariKalemi(a));
  }

  /**
   * ── ETKİN ERTELEMELER (migration 058) — ŞEFTE DARALTILIR ────────────────
   * Erteleme YAZMA ucu requireMobileAdmin: şef erteleme yapamaz. Ama patronun
   * ertelediği bir DİKKAT KALEMİ şefin listesinde de durmamalı — yoksa iki
   * yönetici aynı filoyu iki farklı listeyle yönetir, ki cihazda erteleme
   * yapılmamasının sebebi tam olarak buydu.
   *
   * Şefe YALNIZ kendi dikkat listesinde karşılığı olan `attention` ertelemeleri
   * döner. `alarm` ve `leave` blokları şefte zaten null/0 (panel paritesi);
   * o kaynakların ertelemelerini taşımak, şefe GÖREMEDİĞİ kalemlerin
   * kimliklerini sızdırmak olurdu. Kapsam ikinci bir sorguyla değil, ELDEKİ
   * `dash.attention` kümesiyle kuruluyor — kapsam zaten orada uygulanmış
   * (getDashboardData fleetScope alıyor), ikinci bir kapsam tanımı ayrışırdı.
   *
   * KİMLİK: istemci kaynak önekini ("dikkat:") KENDİ tarafında ekliyor;
   * `kalemId` burada kaynağın HAM kimliğidir (AttentionItem.id), çünkü tür
   * zaten `kaynak` alanında yazılı.
   */
  const kendiKalemleri = new Set(dash.attention.map((a) => a.id));
  const gorunurErtelemeler = isChief
    ? ertelemeler.satirlar.filter(
        (e) => e.kaynak === "attention" && kendiKalemleri.has(e.kalemId)
      )
    : ertelemeler.satirlar;

  return Response.json({
    ok: true,
    kapsam: { isChief, fleet },
    bugun: {
      aralik: { start: start.toISOString(), end: end.toISOString() },
      aktifVardiya: dash.todayOps.driversInField,
      yoldakiArac: dash.todayOps.vehiclesDelivering,
      molada: dash.todayOps.onBreak,
      bugunVardiya: dash.todayOps.shiftsToday,
      toplamKm: dash.todayOps.totalKmToday,
      paket: {
        alinan: dash.todayOps.loaded,
        teslim: dash.todayOps.delivered,
        teslimEdilemeyen: dash.todayOps.undelivered,
      },
      azg: { tavanAsan: dash.todayOps.overLimit, mola45Gereken: dash.todayOps.needsBreak45 },
    },
    filo: {
      toplam: dash.fleet.total,
      durum: dash.fleet.counts,
      // 24 sa+ hiç telemetri göndermeyen araç sayısı. Panelin kullandığı
      // türetmenin AYNISI (app/admin/AdminClient.tsx): Dikkat listesindeki
      // `silent` kalemleri sayılır — ikinci bir eşik/sorgu kurulmaz, yoksa
      // iki yüzey aynı filo için farklı sayı gösterebilirdi.
      sinyalYok: dash.attention.filter((a) => a.kind === "silent").length,
      // "SAHADA n/N" halkasının PAYI: şu an AÇIK VARDİYASI olan araç sayısı
      // (openVehicleIds.size — lib/admin-dashboard.ts). Ne `bugun.aktifVardiya`
      // (açık VARDİYA sayısı; aynı araca iki vardiya açılabilir) ne
      // `filo.durum.sevkiyatta` (canlı kontak/hız durumu; vardiyalı araç park
      // hâlinde olabilir) — üç sayı bilinçli ayrıdır, karıştırma bu genişlemenin
      // çıkış sebebiydi.
      vardiyaliArac: dash.openVehicleCount,
    },
    // ── GÜNÜN PANOSU (roster) ─────────────────────────────────────────────
    // buildTodayRoster'ın SERİALİZE edilmiş hâli — hesap yok, sıralama panelin
    // kendisi (AÇMADI → SAHADA → KAPANDI → İZİNLİ). Tavan: satır sayısı aktif
    // şoför sayısıdır; 60, bugünkü filoların iki katından fazla. Kırpılırsa
    // bayrak söyler — `bugun.*` sayaçları her koşulda TAM kalır.
    roster: dash.roster.slice(0, ROSTER_TAVANI).map((r) => ({
      personelId: r.workerId,
      ad: r.name,
      // Satırın vardiyası — /api/mobile/shifts/{id} ile detaya gidilir.
      // Vardiya açmamış ve izinli satırlarda null (boş dizge DEĞİL).
      vardiyaId: r.entryId,
      plaka: r.plate,
      model: r.model,
      kullanilanPlaka: r.usedPlate,
      aracDurum: r.vehicleStatus,
      durum: r.status,
      baslangic: r.startedAt,
      bitis: r.endedAt,
      alinanPaket: r.loadedPackages,
      telemetriYasMs: r.telemetryAgeMs,
      telemetriBayat: r.telemetryStale,
    })),
    rosterTavani: ROSTER_TAVANI,
    rosterKirpildi: dash.roster.length > ROSTER_TAVANI,
    // ── RÖLANTİ İSRAFI — patron bloğu (şefte null, bkz. üst yorum) ────────
    rolanti: patron
      ? {
          bugun: {
            toplamMs: patron.idleGun.totalMs,
            toplamEuro: patron.idleGun.totalEuro,
          },
          gun7: {
            toplamMs: patron.idle7.totalMs,
            toplamEuro: patron.idle7.totalEuro,
            // En uzun süre önce (computeIdleWaste zaten öyle sıralıyor).
            // Kırpılan satırların süresi/tutarı toplamlarda KALIR.
            satirlar: patron.idle7.rows
              .slice(0, ROLANTI_SATIR_TAVANI)
              .map((row) => ({
                ad: row.name,
                plaka: patron.plateForIdleKey(row.key),
                ms: row.totalMs,
                euro: row.euro,
                olayAdedi: row.episodeCount,
              })),
          },
          satirTavani: ROLANTI_SATIR_TAVANI,
          kirpildi: patron.idle7.rows.length > ROLANTI_SATIR_TAVANI,
        }
      : null,
    // ── AÇIK ALARM — patron bloğu (şefte null) ────────────────────────────
    alarm: patron ? { acik: patron.alarmAcik, kritik: patron.alarmKritik } : null,
    // ── BİLDİRİM ÇANI: onay bekleyen izin talepleri ───────────────────────
    // Şefte HER ZAMAN adet:0 (kendi açtığı talebi onaylayamaz); patron yoksa
    // LEAVES kapalıysa da 0 — çan rozeti sıfırsa görünmez.
    onayBekleyen: {
      izin: {
        adet: patron?.pendingLeaves.length ?? 0,
        kalemler: (patron?.pendingLeaves ?? [])
          .slice(0, IZIN_TAVANI)
          .map((l) => ({
            id: l.id,
            personelId: l.worker_id,
            ad: l.worker_name,
            tur: l.leave_type,
            baslangic: l.start_date,
            bitis: l.end_date,
            gun: leaveDaysInclusive(l.start_date, l.end_date),
            talepAni: l.created_at,
          })),
      },
      tavan: IZIN_TAVANI,
      kirpildi: (patron?.pendingLeaves.length ?? 0) > IZIN_TAVANI,
    },
    // ── ETKİN ERTELEMELER (migration 058) ─────────────────────────────────
    // Süzmeyi İSTEMCİ yapıyor: `uyari.kalemler` ve `onayBekleyen.izin`
    // SÜZÜLMEDEN dönüyor. Sunucuda süzmek "Ertelenen" sekmesinin göstereceği
    // kalemi de yok ederdi (bkz. /api/mobile/alarms aynı notu).
    ertelemeler: gorunurErtelemeler,
    /** `var` · `tablo_yok` (058 uygulanmamış) · `hata` — boş liste üç ayrı şey. */
    ertelemeDurumu: ertelemeler.durum,
    /** Bu ÇAĞIRANA görünen etkin erteleme sayısı (şefte daraltılmış küme). */
    ertelemeToplam: isChief ? gorunurErtelemeler.length : ertelemeler.toplam,
    ertelemeTavani: ERTELEME_LISTE_TAVANI,
    /** Tavan ALTTAKİ küme için aşıldı mı — şef süzgecinden ÖNCEKİ okuma. */
    ertelemeKirpildi: ertelemeler.kirpildi,
    uyari: {
      toplam: dash.attention.length,
      tur: uyariKirilim,
      kalemTavani: UYARI_KALEM_TAVANI,
      /** Tavan yüzünden listeye girmeyen kalem var mı (sayılar `tur`'da tam). */
      kirpildi: kalemler.length < dash.attention.length,
      kalemler,
    },
    dtcAracSayisi: dash.dtc.length,
    /** Araç başına taşınan en fazla DTC kodu (dtc[].kodlar tavanı). */
    dtcKodTavani: DTC_KOD_TAVANI,
    // Arıza satırları (FleetDtcRow) olduğu gibi. Satır sayısı tavansız: araç
    // başına EN FAZLA bir satır, 30 aracın üstüne çıkamaz. KODLAR tavanlı:
    // araç başına 10 kod (en eski önce — enEskiKod her zaman listede), fazlası
    // `kodKirpildi` ile söylenir; `aktifKod` GERÇEK toplam kalır.
    dtc: dash.dtc.map((d) => ({
      aracId: d.vehicle_id,
      plaka: d.plate,
      aktifKod: d.count,
      enEskiKod: d.oldest_code,
      enEskiAn: d.oldest_since,
      kodKirpildi: d.codes.length > DTC_KOD_TAVANI,
      kodlar: d.codes.slice(0, DTC_KOD_TAVANI).map((c) => ({
        kod: c.code,
        ilkGoruldu: c.first_seen,
        // Panel sözlüğü (lib/dtc-codes.ts) — araç detayının kullandığı kaynağın
        // aynısı, kurulumun varsayılan dilinde (mobil dil kuralı,
        // lib/mobile-labels.ts). Sözlükte olmayan kod → null, tanım UYDURULMAZ.
        aciklama: lookupDtc(c.code, DEFAULT_LOCALE)?.title ?? null,
      })),
    })),
    performans7g: {
      aralik: { start: perfRange.start.toISOString(), end: perfRange.end.toISOString() },
      ortalamaSkor: perf.avgScore,
      skorlananSofor: perf.scoredCount,
      toplamVardiya: perf.totalShifts,
      toplamCalismaMs: perf.totalWorkedMs,
      toplamKm: perf.totalKm,
      // Gün kırılımı — yukarıdaki toplamların TÜREVİ, ayrı bir ölçüm değil
      // (lib/reports.ts buildPerformanceDaily). Σ gunluk === toplam*.
      gunluk: perf.daily.map((d) => ({
        gun: d.day,
        vardiya: d.shifts,
        km: d.km,
        calismaMs: d.workedMs,
      })),
    },
  });
}

/** Dikkat listesinde TÜR BAŞINA taşınacak en fazla kalem. */
const UYARI_KALEM_TAVANI = 20;
/** Günün Panosu satır tavanı — aktif şoför sayısının ~2 katı (bugün en büyük filo 30). */
const ROSTER_TAVANI = 60;
/** Rölanti dökümünde taşınacak en fazla satır (en uzun süre önce). */
const ROLANTI_SATIR_TAVANI = 20;
/** Bildirim çanında taşınacak en fazla izin talebi (adet her zaman gerçek toplam). */
const IZIN_TAVANI = 20;
/** Araç başına taşınacak en fazla DTC kodu (aktifKod gerçek toplam kalır). */
const DTC_KOD_TAVANI = 10;

/**
 * Patron blokları — rölanti israfı (Analiz sayfasının yolu: listVehiclesAndWorkers
 * + listIdleEpisodesInRange + computeIdleWaste, app/admin/analiz/page.tsx:64-162
 * ile aynı çağrı zinciri), açık alarm sayısı (alarm listesinin yolu:
 * listEventsInRange + listIdleEpisodesInRange — app/admin/alarmlar/page.tsx:139)
 * ve onay bekleyen izinler. İKİNCİ BİR FORMÜL YOK: pencere de fonksiyon da
 * panelinkiler.
 *
 * hafta penceresindeki epizod kümesi HEM rölanti gun7'yi HEM alarm sayacını
 * besler — aynı pencere, tek okuma.
 */
async function loadPatronBlocks(
  gunRange: { start: Date; end: Date },
  perfRange: { start: Date; end: Date }
) {
  const [vw, epGun, ep7, ev7, pendingLeaves] = await Promise.all([
    listVehiclesAndWorkers(),
    listIdleEpisodesInRange(
      gunRange.start.toISOString(),
      gunRange.end.toISOString()
    ),
    listIdleEpisodesInRange(
      perfRange.start.toISOString(),
      perfRange.end.toISOString()
    ),
    listEventsInRange(
      perfRange.start.toISOString(),
      perfRange.end.toISOString()
    ),
    LEAVES_ENABLED ? listPendingLeaves() : Promise.resolve([] as PendingLeave[]),
  ]);

  const vehiclesById = new Map(vw.vehicles.map((v) => [v.id, v]));
  const workersById = new Map(vw.workers.map((w) => [w.id, w]));
  const idleGun = computeIdleWaste(epGun, vehiclesById, workersById);
  const idle7 = computeIdleWaste(ep7, vehiclesById, workersById);

  // IdleWasteRow plaka taşımaz (panel tablosunda da yok); satıra iliştirme
  // SUNUM işidir, metrik hesabı değil. key = workerId → atanmış aracın plakası;
  // key = "unassigned:<vehicleId>" → o aracın plakası.
  const plateByWorker = new Map<string, string>();
  for (const v of vw.vehicles) {
    if (v.assigned_worker_id && !plateByWorker.has(v.assigned_worker_id)) {
      plateByWorker.set(v.assigned_worker_id, v.plate);
    }
  }
  const plateForIdleKey = (key: string): string | null =>
    key.startsWith("unassigned:")
      ? vehiclesById.get(key.slice("unassigned:".length))?.plate ?? null
      : plateByWorker.get(key) ?? null;

  // Kademe tek kaynağı lib/event-ui.ts ALARM_KADEME. Rölanti epizodları
  // "idling" = rutin — kritik sayacına katkısı yok, açık toplama girer.
  const alarmAcik = ev7.length + ep7.length;
  const alarmKritik = ev7.filter(
    (e) => alarmKademe(e.event_type) === "kritik"
  ).length;

  return {
    idleGun,
    idle7,
    plateForIdleKey,
    alarmAcik,
    alarmKritik,
    pendingLeaves,
  };
}

/**
 * İzin gün sayısı — başlangıç ve bitiş DAHİL takvim günü (YYYY-MM-DD, date
 * kolonları; UTC parse kesin). Bozuk tarihte null — sayı uydurulmaz.
 */
function leaveDaysInclusive(startYmd: string, endYmd: string): number | null {
  const a = Date.parse(startYmd);
  const b = Date.parse(endYmd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Dikkat/Aksiyon kaleminin mobil karşılığı. Alanlar İSİMCE Türkçeleşir, DEĞERCE
 * değişmez; `tur` bilinçli olarak `kind`'ın kendisidir (İngilizce) — `uyari.tur`
 * kırılımının anahtarları da o değerler, ikisi eşleşmeli.
 *
 * Alanlar türe göre dolar (bkz. AttentionItem); bir türde anlamı olmayan alan
 * yanıtta hiç görünmez.
 */
type UyariKalemi = {
  tur: AttentionItem["kind"];
  id: string;
  /** Araç kalemleri. */
  plaka?: string;
  /** Şoför kalemleri (worker_name). */
  sofor?: string;
  /** Belge/ehliyet bitiş tarihi (due). */
  sonTarih?: string;
  /** Bitişe kalan gün; negatif = süresi geçmiş (days). */
  kalanGun?: number;
  /**
   * ŞOFÖR BELGESİ türünün ETİKETİ (078) — ör. "SRC Belgesi", "Aufenthaltstitel".
   *
   * ⚠️ ÇEVRİLMEZ ve mobil sözlüğe girmez: kiracının tanımladığı bir veridir,
   * ürün metni değil. Uygulama bunu olduğu gibi basar; aksi hâlde her yeni
   * belge türü mobil sürüm çıkmayı gerektirirdi.
   */
  belgeTuru?: string;
  /** Adet — teslim edilemeyen paket ya da ödenmemiş ceza sayısı (count). */
  adet?: number;
  /** Son telemetriden bu yana geçen saat (hours). */
  saat?: number;
  /** Çalışılan süre (ms) — AZG kalemleri. */
  sureMs?: number;
  /** O vardiyaya uygulanan günlük tavan (ms); gece vardiyasında düşer. */
  tavanMs?: number;
  /** Vardiya gece penceresine değdi mi (tavanı belirler). */
  gece?: boolean;
  /** Kaydedilen mola (dk) ve yasanın istediği mola (dk). */
  molaDk?: number;
  gerekenMolaDk?: number;
  /** Düzeltme kısayolu için vardiya kaydının id'si (undelivered). */
  vardiyaId?: string;
  /**
   * KALEMİN ZAMANI — "en yeni üstte" sıralaması ve satırdaki saat için
   * (10.08.2026). Türe göre kaynağı değişir, tek formül YOK:
   *   overLimit/break45/undelivered/locationUnverified/startEstimated/
   *   vehicleIdle/manualStart → üretici vardiyanın started_at'i
   *   silent/movingNoShift/unassignedMoving → tetikleyen telemetri fix'inin
   *   recorded_at'i · penalty → EN YENİ ödenmemiş cezanın penalty_date'i ·
   *   driverless → şoförün terminated_at'i (girilmemişse alan YOK).
   * inspection/insurance/license OLAY DEĞİL VADE'dir: `an` bu üç türde HİÇ
   * bulunmaz (sahte zaman basılmaz) — vade zaten sonTarih + kalanGun'da.
   */
  an?: string;
  /** Ödenmemiş ceza tutarı; hiçbiri fiyatlanmamışsa null. */
  tutar?: number | null;
  /** Mesaiyi elle başlatan filo şefi (manualStart.by_name). */
  baslatan?: string;
  /** Günün TOPLAM çalışma süresi (dk) — secondShift kalemi. */
  toplamDk?: number;
};

function uyariKalemi(a: AttentionItem): UyariKalemi {
  switch (a.kind) {
    case "overLimit":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        sureMs: a.ms,
        tavanMs: a.capMs,
        gece: a.night,
        an: a.started_at,
      };
    case "break45":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        sureMs: a.ms,
        molaDk: a.breakMin,
        gerekenMolaDk: a.requiredMin,
        an: a.started_at,
      };
    case "inspection":
    case "insurance":
      return { tur: a.kind, id: a.id, plaka: a.plate, sonTarih: a.due, kalanGun: a.days };
    case "undelivered":
      return {
        tur: a.kind,
        id: a.id,
        vardiyaId: a.entry_id,
        sofor: a.worker_name,
        adet: a.count,
        an: a.date,
      };
    case "penalty":
      return {
        tur: a.kind,
        id: a.id,
        plaka: a.plate,
        adet: a.count,
        tutar: a.amount,
        // penalty_date girilmemişse alan hiç görünmez (undefined JSON'a yazılmaz).
        an: a.latest_date ?? undefined,
      };
    case "license":
      return { tur: a.kind, id: a.id, sofor: a.worker_name, sonTarih: a.due, kalanGun: a.days };
    case "document":
      // `belgeTuru` KİRACININ etiketi — çevrilmez, olduğu gibi taşınır.
      // Mobil tarafın sözlüğüne koymak, müşteri verisini uygulama paketine
      // gömmek olurdu ve yeni bir tür eklemek sürüm çıkmayı gerektirirdi.
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        belgeTuru: a.type_label,
        sonTarih: a.due,
        kalanGun: a.days,
      };
    case "silent":
      return { tur: a.kind, id: a.id, plaka: a.plate, saat: a.hours, an: a.at };
    case "kmUnmeasured":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        plaka: a.plate,
        // Uç sözleşmesi null taşımıyor: bilinmiyorsa alan HİÇ gönderilmez
        // (cihaz hiç konuşmamış vardiyada `saat`/`an` yok).
        ...(a.hours !== null ? { saat: a.hours } : {}),
        ...(a.last_seen !== null ? { an: a.last_seen } : {}),
      };
    case "movingNoShift":
    case "unassignedMoving":
      return { tur: a.kind, id: a.id, plaka: a.plate, an: a.at };
    case "driverless":
      return {
        tur: a.kind,
        id: a.id,
        plaka: a.plate,
        sofor: a.worker_name,
        an: a.terminated_at ?? undefined,
      };
    case "locationUnverified":
    case "startEstimated":
    case "vehicleIdle":
      return { tur: a.kind, id: a.id, sofor: a.worker_name, an: a.started_at };
    case "manualStart":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        baslatan: a.by_name,
        an: a.started_at,
      };
    case "secondShift":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        adet: a.count,
        toplamDk: Math.round(a.totalMs / 60_000),
        an: a.started_at,
      };
  }
  // Yeni bir Dikkat türü eklenip buraya yazılmazsa DERLEME kırılır (`a` artık
  // `never` değildir). Sessizce alansız kalem dönmemesi için bilinçli kapı.
  const eksik: never = a;
  return { tur: (eksik as AttentionItem).kind, id: (eksik as AttentionItem).id };
}
