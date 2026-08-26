import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getTakografDetay } from "@/app/actions/takograf";
import { TakografDetayClient } from "./TakografDetayClient";

export const dynamic = "force-dynamic";

/**
 * /admin/takograf/[id] — TEK DOSYANIN HAM VERİSİ (migration 091).
 *
 * ⚠️ İHLAL ANALİZİ YOK (Volkan kararı). Bu ekran dosyanın içinde ne yazdığını
 * gösterir, ne anlama geldiğini yorumlamaz. 561/2006 ihlal motoru ayrı bir
 * turun işi.
 */
export default async function TakografDetaySayfasi({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const [detay, t] = await Promise.all([getTakografDetay(id), getTranslations("tacho")]);
  if (!detay.dosya) notFound();

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
        <TakografDetayClient detay={detay} />
      </div>
    </DashboardShell>
  );
}
