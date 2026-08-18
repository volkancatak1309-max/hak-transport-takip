import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildFuelCsv } from "@/lib/report-csv";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { csvYaniti, disaAktarimKapali, fuelFisModuluKapali } from "../../_rapor/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/fuel.csv?range=…&from=&to=
 *
 * Raporlar › Yakıt CSV'sinin (FuelClient.tsx) sunucu karşılığı. `;` ayraç +
 * UTF-8 BOM.
 *
 * ⚠️ EKRANDA GİZLENEN SAYI CSV'YE DE GİRMEZ: güvenilmez sensörün türetilmiş
 * değerleri yerine SEBEBİ yazılır. Boş hücre Excel'de "sıfır" diye okunur,
 * sebep okunamaz (panelin kendi kuralı).
 *
 * ── FUEL_ENABLED BU UCU KAPATMAZ ──────────────────────────────────────────
 * O bayrak yakıt FİŞİ modülünü kapatıyor; bu rapor telemetri tabanlı ve
 * panelde hiçbir bayrağa bağlı değil (ölçüldü). Gerekçe app/api/mobile/_rapor/
 * csv.ts başlığında. Bayrağın durumu yine de yanıt başlığında taşınıyor:
 * `x-fuel-fis-modulu` — istemci isterse not düşer.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const kapali = disaAktarimKapali();
  if (kapali) return kapali;

  const cozum = aralikCoz(new URL(req.url));
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));

  const yanit = csvYaniti(await buildFuelCsv(cozum.cozum.range));
  yanit.headers.set("x-fuel-fis-modulu", fuelFisModuluKapali() ? "kapali" : "acik");
  return yanit;
}
