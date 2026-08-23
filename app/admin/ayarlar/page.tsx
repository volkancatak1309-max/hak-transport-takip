import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PageHeader } from "@/components/ui-v2";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildFuelReport } from "@/lib/reports";
import { resolveCostRates } from "@/lib/cost-rates-db";
import { audit } from "@/lib/security-log";
import { CostRatesForm } from "./CostRatesForm";

export const dynamic = "force-dynamic";

/**
 * AYARLAR — kiracının kendi rakamlarını girdiği yer.
 *
 * Bugün tek bölüm var (Maliyet Oranları); sayfa bir KAP olarak açıldı çünkü
 * "env'i biz değiştiririz" modeli dünya pazarında çalışmıyor ve bundan sonraki
 * her kiracı-ayarı buraya gelecek. Bölümü doğrudan yakıt raporunun içine
 * gömseydik ikinci ayar geldiğinde taşımak gerekirdi.
 */
export default async function AyarlarPage() {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", "/admin/ayarlar");

  const t = await getTranslations("settings");

  // ÖLÇÜLEN tüketimi göstermek için yakıt raporu OKUNUR ama yalnız tek alanı
  // kullanılır. Aralık "ay": oran ekranı bir DÖNEM raporu değil, "bugün hangi
  // sayı geçerli" ekranıdır; 30 gün ölçümün oturması için yeterli ve yakıt
  // raporunun kendi varsayılanıyla aynı pencere.
  const range = computeAnalyticsRange("ay");
  const fuel = await buildFuelReport(range);
  const cozum = await resolveCostRates(fuel.fleetLPer100Km);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <PageHeader title={t("title")} description={t("desc")} />
        <CostRatesForm
          rates={cozum.rates}
          origin={cozum.origin}
          row={cozum.row}
          tabloYok={cozum.tabloYok}
        />
      </div>
    </DashboardShell>
  );
}
