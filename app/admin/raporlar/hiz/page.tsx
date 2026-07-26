import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { getLatestConfigEpoch, rangeStartsBeforeEpoch } from "@/lib/config-epoch";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildSpeedReport } from "@/lib/reports";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { SpeedClient } from "./SpeedClient";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function SpeedReportPage({
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
  // Hız ihlalleri vehicle_events'ten geliyor (lib/reports.ts buildSpeedReport),
  // yani Alarmlar ve Analiz ile AYNI eşik sınırına tabi. Aynı uyarı burada da.
  const [report, epoch] = await Promise.all([
    buildSpeedReport(range),
    getLatestConfigEpoch(),
  ]);
  const t = await getTranslations("reports");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("speed_title")}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <ReportPageShell
          title={t("speed_title")}
          description={t("speed_page_desc")}
          notice={
            <EpochWarning
              epochISO={epoch ? epoch.changedAt.toISOString() : null}
              show={rangeStartsBeforeEpoch(range.start, epoch)}
            />
          }
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
        >
          <SpeedClient report={report} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
