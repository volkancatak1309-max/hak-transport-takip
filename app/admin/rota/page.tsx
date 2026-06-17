import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { RouteReplay } from "@/components/RouteReplay";
import { getWorkerRoute } from "@/lib/route-history";
import { viennaDayKey } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WorkerRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string; date?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const t = await getTranslations("route");

  const workerId = sp.worker;
  if (!workerId) notFound();

  const date = sp.date || viennaDayKey(new Date());
  const route = await getWorkerRoute(workerId, date);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("title")}
    >
      <RouteReplay
        route={route}
        backHref={`/admin/workers/${workerId}`}
        backLabel={route.driverName ?? t("back")}
      />
    </DashboardShell>
  );
}
