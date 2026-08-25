import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getCO2Panosu } from "@/app/actions/co2";
import { CO2Client } from "./CO2Client";

export const dynamic = "force-dynamic";

const GUN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /admin/co2 — CO₂ PANOSU (migration 089).
 *
 * ═══ 🔴 BAYRAK YOK — BİLİNÇLİ ═══
 *
 * CO₂ raporu bugüne kadar `/admin/yakit` içindeydi ve o sayfa `FUEL_ENABLED`
 * tanımsızken `/admin`e yönlendiriyordu: üretimde ERİŞİLEMEZDİ. Yakıt GİRİŞİ
 * kapalı olabilir; CO₂ RAPORU müşterinin ihale için bugün istediği belgedir.
 * Aynı ders `app/api/mobile/_rapor/csv.ts`te de yazılı.
 *
 * ═══ NEDEN AYRI SAYFA ═══
 *
 * `/admin/raporlar/yakit` bir OPERASYON ekranı (kim ne kadar yakıyor).
 * Bu sayfa bir BEYAN ekranı: dışarıya verilecek sayı, esası ve metodolojisiyle.
 */
export default async function CO2Sayfasi({
  searchParams,
}: {
  searchParams: Promise<{ bas?: string; bit?: string }>;
}) {
  const { session } = await requireFleetView();
  const { bas, bit } = await searchParams;

  const [pano, t] = await Promise.all([
    getCO2Panosu(bas && GUN.test(bas) ? bas : undefined, bit && GUN.test(bit) ? bit : undefined),
    getTranslations("co2"),
  ]);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: Boolean(session.is_admin),
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <CO2Client pano={pano} yonetici={Boolean(session.is_admin)} />
      </div>
    </DashboardShell>
  );
}
