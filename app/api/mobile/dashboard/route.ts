import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { getDashboardData } from "@/lib/admin-dashboard";
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
    filo: { toplam: dash.fleet.total, durum: dash.fleet.counts },
    uyari: { toplam: dash.attention.length, tur: uyariKirilim },
    dtcAracSayisi: dash.dtc.length,
    performans7g: {
      aralik: { start: perfRange.start.toISOString(), end: perfRange.end.toISOString() },
      ortalamaSkor: perf.avgScore,
      skorlananSofor: perf.scoredCount,
      toplamVardiya: perf.totalShifts,
      toplamCalismaMs: perf.totalWorkedMs,
      toplamKm: perf.totalKm,
    },
  });
}
