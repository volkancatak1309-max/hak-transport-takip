import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildDistanceCsv } from "@/lib/report-csv";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { csvYaniti, disaAktarimKapali } from "../../_rapor/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/distance.csv?range=…&from=&to=
 *
 * Raporlar › Mesafe CSV'sinin (DistanceClient.tsx) sunucu karşılığı. `;` ayraç
 * + UTF-8 BOM — panelin biçimi, Excel'in Avusturya yerelinde doğrudan açılır.
 *
 * Km, aracın KENDİ odometresinin aralıktaki ilk/son okuması arasındaki fark
 * (buildDistanceReport). Ölçülemeyen km BOŞ bırakılır, 0 yazılmaz: Excel'de 0
 * "hiç gitmedi" diye okunur ve o iddia ölçülmedi.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const kapali = disaAktarimKapali();
  if (kapali) return kapali;

  const cozum = aralikCoz(new URL(req.url));
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));

  return csvYaniti(await buildDistanceCsv(cozum.cozum.range));
}
