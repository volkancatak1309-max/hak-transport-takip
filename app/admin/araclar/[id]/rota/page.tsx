import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { RouteReplay } from "@/components/RouteReplay";
import { getVehicleRoute } from "@/lib/route-history";
import { viennaDayKey } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function VehicleRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations("route");

  const { data: vehicle } = await supabaseAdmin
    .from("vehicles")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!vehicle) notFound();

  const date = sp.date || viennaDayKey(new Date());
  const route = await getVehicleRoute(id, date);

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
        backHref={`/admin/araclar/${id}`}
        backLabel={route.plate ?? t("back")}
      />
    </DashboardShell>
  );
}
