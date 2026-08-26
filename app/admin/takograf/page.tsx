import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getTakografPanosu } from "@/app/actions/takograf";
import { TakografClient } from "./TakografClient";

export const dynamic = "force-dynamic";

/**
 * /admin/takograf — .ddd ARŞİVİ (migration 091).
 *
 * ═══ NEDEN AYRI SAYFA ═══
 *
 * Bu ekran bir OPERASYON ekranı değil, bir ARŞİV. Müşteri buraya dosyalarını
 * bırakıyor ve denetimde buradan indiriyor — ürünün satış vaadi bu. Raporlar
 * menüsünün altına gömmek onu "bir rapor daha" yapardı.
 *
 * ═══ BAYRAK YOK ═══
 *
 * Arşiv bir modül değil; kapatılabilir olması anlamsız.
 */
export default async function TakografSayfasi() {
  const session = await requireAdmin();
  const [pano, t] = await Promise.all([getTakografPanosu(), getTranslations("tacho")]);

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
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <TakografClient pano={pano} />
      </div>
    </DashboardShell>
  );
}
