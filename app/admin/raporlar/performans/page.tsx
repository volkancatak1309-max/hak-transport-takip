import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildPerformanceReport, rangeLabel } from "@/lib/reports";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { PerformanceClient } from "./PerformanceClient";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function PerformanceReportPage({
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
  const report = await buildPerformanceReport(range);
  const t = await getTranslations("reports");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("perf_title")}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <ReportPageShell
          title={t("perf_title")}
          description={t("perf_page_desc")}
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
        >
          <PerformanceClient report={report} period={rangeLabel(range)} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
