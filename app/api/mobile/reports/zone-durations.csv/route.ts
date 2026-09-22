import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildZoneDurationsCsv } from "@/lib/report-csv";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { dilCoz, dilHataAlanlari } from "../../_rapor/dil";
import { csvYaniti, disaAktarimKapali } from "../../_rapor/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/zone-durations.csv?range=…&from=&to=&dil=
 *
 * Raporlar › Bölge Süreleri CSV'sinin (`ZoneVisitsClient.tsx` `exportCsv`)
 * sunucu ikizi — sekiz sütun, aynı sıra, aynı dosya adı deseni.
 *
 * ⚠️ BU DOSYA MÜŞTERİ FATURASININ EKİNE GİRİYOR. Panelin ekranındaki iki
 * belirsizlik rozeti (`sinyal` = cihaz sustu · `bolge` = ölçümü biz durdurduk)
 * CSV'ye de taşınır; ekranı görmeyen muhasebeci farkı ancak orada okuyabilir.
 *
 * ═══ KAPI: requireMobileAdmin — PANEL PARİTESİ ═══
 * Panelde sayfa `requireAdmin()` arkasında (`bolge-sureleri/page.tsx:26`) ve
 * `buildZoneVisitReport(range)` filo kapsamı almıyor. Gerekçenin tamamı
 * kardeş `speed.csv` ucunun başlığında.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required
 *   400 invalid_range · invalid_tarih · invalid_dil
 *   409 feature_disabled (EXPORT_ENABLED)
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const kapali = disaAktarimKapali();
  if (kapali) return kapali;

  const url = new URL(req.url);

  const dilSonucu = dilCoz(url);
  if (!dilSonucu.ok) return mobileError(400, dilSonucu.kod, dilHataAlanlari());

  const cozum = aralikCoz(url);
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));

  return csvYaniti(await buildZoneDurationsCsv(cozum.cozum.range, dilSonucu.dil));
}
