import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildZoneVisitReport } from "@/lib/zone-visit-report";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { ZoneVisitsClient } from "./ZoneVisitsClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

/**
 * BÖLGE SÜRELERİ — "faturalama kanıtı" raporu (FAZ C).
 *
 * Aralık anahtarları diğer raporlarla AYNI (?aralik/?baslangic/?bitis):
 * yönetici ekranlar arası geçerken filtre kavramı değişmesin.
 */
export default async function ZoneVisitsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", "/admin/raporlar/bolge-sureleri");
  const sp = await searchParams;
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const report = await buildZoneVisitReport(range);
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
      title={t("zone_title")}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <ReportPageShell
          title={t("zone_title")}
          description={t("zone_page_desc")}
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
        >
          <ZoneVisitsClient report={report} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
