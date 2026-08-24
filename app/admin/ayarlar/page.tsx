import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PageHeader } from "@/components/ui-v2";
import { resolveCostRates } from "@/lib/cost-rates-db";
import { audit } from "@/lib/security-log";
import { CostRatesForm } from "./CostRatesForm";
import { ConsumptionRow, ConsumptionRowSkeleton } from "./ConsumptionRow";

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

  // ⚠️ `null` GEÇİLİYOR, yakıt raporu ÇAĞRILMIYOR — bilerek.
  //
  // Ölçülen L/100km'nin tek kaynağı `buildFuelReport` ve o çağrı canlıda
  // 40-60 saniye sürüyor. Sayfa onu doğrudan bekliyordu ve ölçüldü: ayarlar
  // ekranı 43 saniyede açılıyor, veritabanı yavaşladığında ise 200 dönüp
  // İÇERİKSİZ render oluyordu. Düzenlenebilir üç parasal oran yakıt raporuna
  // hiç ihtiyaç duymuyor (bkz. lib/cost-rates-db.ts zinciri); tek bağımlı
  // parça tüketim satırıydı ve o artık Suspense arkasında akıyor.
  //
  // Buradaki `null`, YALNIZ bu çağrının lPer100 alanını etkiler ve o alan
  // forma HİÇ geçmiyor — tüketim satırı kendi çözümünü kendi yapıyor.
  const cozum = await resolveCostRates(null);

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
          consumptionSlot={
            <Suspense fallback={<ConsumptionRowSkeleton label={t("rate_l100_loading")} />}>
              <ConsumptionRow />
            </Suspense>
          }
        />
      </div>
    </DashboardShell>
  );
}
