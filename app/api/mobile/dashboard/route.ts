import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { getDashboardData, type AttentionItem } from "@/lib/admin-dashboard";
import { buildPerformanceReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
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
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { fleetScope, isChief, fleet } = guard.actor;

  const start = startOfTodayVienna();
  const end = endOfTodayVienna();
  const perfRange = computeAnalyticsRange("hafta");

  const [dash, perf] = await Promise.all([
    getDashboardData(start.toISOString(), end.toISOString(), fleetScope),
    buildPerformanceReport(perfRange),
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
    },
    uyari: {
      toplam: dash.attention.length,
      tur: uyariKirilim,
      kalemTavani: UYARI_KALEM_TAVANI,
      /** Tavan yüzünden listeye girmeyen kalem var mı (sayılar `tur`'da tam). */
      kirpildi: kalemler.length < dash.attention.length,
      kalemler,
    },
    dtcAracSayisi: dash.dtc.length,
    // Arıza satırları (FleetDtcRow) olduğu gibi. Tavansız: satır sayısı filo
    // büyüklüğüyle sınırlı (araç başına EN FAZLA bir satır), 30 aracın üstüne
    // çıkamaz.
    dtc: dash.dtc.map((d) => ({
      aracId: d.vehicle_id,
      plaka: d.plate,
      aktifKod: d.count,
      enEskiKod: d.oldest_code,
      enEskiAn: d.oldest_since,
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
  /** Vardiyanın başlangıç anı (undelivered.date / manualStart.started_at). */
  an?: string;
  /** Ödenmemiş ceza tutarı; hiçbiri fiyatlanmamışsa null. */
  tutar?: number | null;
  /** Mesaiyi elle başlatan filo şefi (manualStart.by_name). */
  baslatan?: string;
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
      };
    case "break45":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        sureMs: a.ms,
        molaDk: a.breakMin,
        gerekenMolaDk: a.requiredMin,
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
      return { tur: a.kind, id: a.id, plaka: a.plate, adet: a.count, tutar: a.amount };
    case "license":
      return { tur: a.kind, id: a.id, sofor: a.worker_name, sonTarih: a.due, kalanGun: a.days };
    case "silent":
      return { tur: a.kind, id: a.id, plaka: a.plate, saat: a.hours };
    case "movingNoShift":
    case "unassignedMoving":
      return { tur: a.kind, id: a.id, plaka: a.plate };
    case "driverless":
      return { tur: a.kind, id: a.id, plaka: a.plate, sofor: a.worker_name };
    case "locationUnverified":
    case "startEstimated":
    case "vehicleIdle":
      return { tur: a.kind, id: a.id, sofor: a.worker_name };
    case "manualStart":
      return {
        tur: a.kind,
        id: a.id,
        sofor: a.worker_name,
        baslatan: a.by_name,
        an: a.started_at,
      };
  }
  // Yeni bir Dikkat türü eklenip buraya yazılmazsa DERLEME kırılır (`a` artık
  // `never` değildir). Sessizce alansız kalem dönmemesi için bilinçli kapı.
  const eksik: never = a;
  return { tur: (eksik as AttentionItem).kind, id: (eksik as AttentionItem).id };
}
