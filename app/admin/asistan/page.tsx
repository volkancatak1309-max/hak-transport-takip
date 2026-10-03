import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession, requireAdmin } from "@/lib/session";
import { sesliAcikMi } from "@/lib/asistan-sesli";
import { ASISTAN_SESLI_KAYIT } from "@/lib/tenant";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AsistanSesliClient } from "./AsistanSesliClient";

export const dynamic = "force-dynamic";

/**
 * /admin/asistan — SESLİ ASİSTAN, Faz 1 web prototipi (03.10.2026).
 *
 * Kapılar uçlarla aynı: `ASISTAN_SESLI=1` + kiracı galzura-demo + yönetici. Biri
 * eksikse sayfa YOK (404) — menüde de bağlantısı yok; adres bilinerek açılır.
 * Sayfa veri okumaz: araçları model ister, `/api/asistan/arac` çalıştırır.
 */
export default async function AsistanSesliPage() {
  if (!sesliAcikMi()) notFound();
  const oturum = await getSession();
  if (!oturum.worker_id || !oturum.is_admin) notFound();
  const session = await requireAdmin();
  const t = await getTranslations("asistanSesli");

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
        <AsistanSesliClient kayitAcik={ASISTAN_SESLI_KAYIT} />
      </div>
    </DashboardShell>
  );
}
