import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getHaftalikPanel } from "@/app/actions/haftalik-aksiyon";
import { HaftalikClient } from "./HaftalikClient";

export const dynamic = "force-dynamic";

/**
 * /admin/haftalik — HAFTALIK AKSİYON PANELİ ("gölge filo müdürü", 084).
 *
 * ═══ NEDEN AYRI SAYFA, /admin'E BÖLÜM DEĞİL ═══
 *
 * `/admin` GÜNÜN panosu: bugün ne oluyor. Bu sayfa HAFTANIN yorumu ve GEÇMİŞİ
 * var ("3 hafta önce ne demişti, düzeldi mi"). İkisini tek ekrana koymak, iki
 * farklı zaman ölçeğini aynı yere sıkıştırmak olurdu — ve `/admin` 21.389 px'e
 * çıktığı için bir kez sadeleştirildi (yönetici panosu turu, 20.07).
 *
 * ═══ KAPI: requireFleetView ═══
 *
 * Şef de görür ama KAPSAMLI — kalemin öznesi kendi filosunda değilse satır
 * sunucudan HİÇ ÇIKMAZ (app/actions/haftalik-aksiyon.ts).
 */
export default async function HaftalikSayfasi({
  searchParams,
}: {
  searchParams: Promise<{ hafta?: string }>;
}) {
  const { session } = await requireFleetView();
  const { hafta } = await searchParams;

  const [panel, t] = await Promise.all([
    getHaftalikPanel(hafta && /^\d{4}-\d{2}-\d{2}$/.test(hafta) ? hafta : undefined),
    getTranslations("haftalik"),
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
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <HaftalikClient panel={panel} />
      </div>
    </DashboardShell>
  );
}
