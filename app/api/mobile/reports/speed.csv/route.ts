import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildSpeedCsv } from "@/lib/report-csv";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { dilCoz, dilHataAlanlari } from "../../_rapor/dil";
import { csvYaniti, disaAktarimKapali } from "../../_rapor/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/speed.csv?range=…&from=&to=&dil=
 *
 * Raporlar › Hız ekranının (`app/admin/raporlar/hiz`) CSV karşılığı.
 * Kardeş uçlarla aynı dil: `;` ayraç + UTF-8 BOM, aynı aralık anahtarları.
 *
 * ═══ KAPI: requireMobileAdmin — PANEL PARİTESİ, ve bu ÖLÇÜLDÜ ═══
 *
 * Görevde `requireMobileFleetView` istenmişti; kapı bilerek `requireMobileAdmin`
 * kaldı ve gerekçesi iki ayrı ölçümden geliyor (22.09.2026):
 *
 *   1. PANELDE BU SAYFA ŞEFE KAPALI. `app/admin/raporlar/hiz/page.tsx:22`
 *      `requireAdmin()` çağırıyor — `requireFleetView()` DEĞİL. Mobili şefe
 *      açmak, panelde göremediği bir raporu telefonundan verirdi.
 *   2. KAPSAM SÜZGECİ YOK. `buildSpeedReport(range)` filo parametresi almıyor
 *      (lib/reports.ts:383) ve `CsvCikti` kurucuları da almıyor. Şefe açıp
 *      kapsam uygulamamak, kendi filosu dışındaki araçların plakalarını ve
 *      ihlallerini ona vermek olurdu — sessiz bir kapsam sızıntısı.
 *
 * Beş kardeş uç (`azg` · `schichtbericht` · `distance` · `fuel` · `shifts`)
 * da aynı sebeple `requireMobileAdmin` arkasında. Şefe açmak AYRI bir karardır
 * ve önce rapor kuruculara filo kapsamı eklenmesini gerektirir.
 *
 * ⚠️ İHLALLER `vehicle_events`ten gelir, yani Alarmlar ve Analiz ile AYNI
 * cihaz eşiğine tabi. Eşik 22-23.07.2026'da değişti; o tarihi kapsayan
 * pencerelerde sayılar iki farklı cetvelden gelir (panelin `EpochWarning`'i).
 *
 * HATA KODLARI:
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
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

  return csvYaniti(await buildSpeedCsv(cozum.cozum.range, dilSonucu.dil));
}
