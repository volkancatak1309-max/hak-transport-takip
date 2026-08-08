import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ReportPageShell } from "@/components/admin/ReportPageShell";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildDistanceReport } from "@/lib/reports";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";
import { DistanceClient } from "./DistanceClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const RANGE_KEYS: AnalyticsRangeKey[] = ["gun", "hafta", "ay", "ozel", "tumzaman"];

export default async function DistanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ aralik?: string; baslangic?: string; bitis?: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/raporlar/mesafe");
  const sp = await searchParams;
  // Aralık anahtarları Analiz sayfasıyla AYNI (?aralik/?baslangic/?bitis) —
  // yönetici iki ekran arasında geçerken filtre kavramı değişmesin.
  const rangeKey = (
    RANGE_KEYS.includes(sp.aralik as AnalyticsRangeKey) ? sp.aralik : "hafta"
  ) as AnalyticsRangeKey;
  const range = computeAnalyticsRange(rangeKey, sp.baslangic, sp.bitis);
  const report = await buildDistanceReport(range);
  const t = await getTranslations("reports");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("distance_title")}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <ReportPageShell
          title={t("distance_title")}
          description={t("distance_page_desc")}
          rangeKey={rangeKey}
          customFrom={sp.baslangic ?? null}
          customTo={sp.bitis ?? null}
        >
          <DistanceClient report={report} />
        </ReportPageShell>
      </div>
    </DashboardShell>
  );
}
