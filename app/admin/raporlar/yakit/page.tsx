import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildFuelReport, buildCostReport, rangeLabel } from "@/lib/reports";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { FuelClient } from "./FuelClient";
import { audit } from "@/lib/security-log";
import { saklamaAyari } from "@/lib/saklama-db";
import { kesimTarihi, pencereKapsami } from "@/lib/saklama";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function FuelReportPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/raporlar/yakit");
  const sp = await searchParams;
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const report = await buildFuelReport(range);
  // MALİYET RAPORU yakıt raporunun ÜSTÜNE biner: ölçülen filo L/100km'yi ve
  // ölçülen litreyi ondan alır. Ayrı çağırsaydık canlıda ~60 sn'lik RPC turu
  // ikiye katlanırdı (23.08.2026 ölçümü).
  const cost = await buildCostReport(range, {
    fleetLPer100Km: report.fleetLPer100Km,
    /**
     * 🔴 `measured > 0` KAPISI (090). Eskiden yalnız `available` bakılıyordu
     * ve ÖLÇÜLEN ARAÇ SIFIRKEN 0 litre geçiyordu — maliyet raporu da onu
     * "0,00 €" diye basıyordu.
     *
     * ÖLÇÜLDÜ (HAK61 canlı, 26.08.2026, veri OLMAYAN pencere 01.03→01.04):
     *   buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç,
     *                     hasData=true olan 0
     *   buildCostReport → totalEur:0 · fuelEur:0
     *   co2Panosu       → kg:null · 29 plaka "ölçülemedi"   ← DOĞRU olan bu
     *
     * Ölçülmemiş bir dönemi 0 diye basmak "ölçülemedi ≠ 0" kuralının tam
     * ihlali. Saklama politikası (090) açıldığında bu kusur, gerçek veriyi
     * uydurma sıfıra çeviren bir makineye dönüşürdü.
     */
    measuredLiters: report.available && report.measured > 0 ? report.totalConsumedLiters : null,
  });

  // Pencere saklama sınırını aşıyor mu — aşıyorsa ekran SÖYLER, sayı uydurmaz.
  const ayar = await saklamaAyari();
  const kapsam = pencereKapsami(range.start, range.end, kesimTarihi(ayar.hamGun));

  const t = await getTranslations("reports");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("fuel_title")}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <ReportPageShell
          title={t("fuel_title")}
          description={t("fuel_page_desc")}
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
        >
          <FuelClient report={report} cost={cost} period={rangeLabel(range)} kapsam={kapsam} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
