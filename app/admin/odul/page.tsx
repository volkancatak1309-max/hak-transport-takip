import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getOdulPanosu } from "@/app/actions/odul";
import { OdulClient } from "./OdulClient";

export const dynamic = "force-dynamic";

/**
 * /admin/odul — LİDERLİK VE DÖNEM SONU ÖZETİ (migration 088).
 *
 * ═══ NEDEN AYRI EKRAN ═══
 *
 * `/admin/raporlar` performans raporu bir ÖLÇÜM belgesi: her şoförün km'si,
 * saati, skoru. Bu ekran bir KARAR ekranı: kimi ödüllendirmeli, kim düşüşte.
 * İkisi aynı sayılardan beslenir ama farklı sorulara cevap verir — ve bu
 * ekranın çıktısı yöneticinin yapacağı bir konuşmadır.
 *
 * ═══ İSİM GÖRÜNÜRLÜĞÜ AYARI BURADA ═══
 *
 * Ayar ŞOFÖRLERİN BİRBİRİNİ görmesini düzenler; yöneticide isimler her zaman
 * açıktır. Varsayılan KAPALI — § 87 Abs. 1 Nr. 6 BetrVG (gerekçe:
 * docs/SOFOR-ODUL.md).
 */
export default async function OdulSayfasi() {
  const { session } = await requireFleetView();

  const [pano, t] = await Promise.all([getOdulPanosu(), getTranslations("odul")]);

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
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <OdulClient pano={pano} yonetici={Boolean(session.is_admin)} />
      </div>
    </DashboardShell>
  );
}
