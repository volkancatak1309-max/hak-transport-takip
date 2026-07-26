import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildFuelReport, rangeLabel } from "@/lib/reports";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { FuelClient } from "./FuelClient";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function FuelReportPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const report = await buildFuelReport(range);
  const t = await getTranslations("reports");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
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
          <FuelClient report={report} period={rangeLabel(range)} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
