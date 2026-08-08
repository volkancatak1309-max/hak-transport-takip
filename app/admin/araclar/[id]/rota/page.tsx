import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { RouteReplay } from "@/components/RouteReplay";
import { getVehicleDeviceRoute } from "@/lib/route-history";
import { viennaDayKey } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function VehicleRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/araclar/[id]/rota");
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
  // Vehicle route from the FMC003 hardware tracker (device_telemetry), not the
  // driver's phone GPS — /admin/rota & /admin/workers/[id] keep using phone GPS.
  const route = await getVehicleDeviceRoute(id, date);

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
      <RouteReplay
        route={route}
        backHref={`/admin/araclar/${id}`}
        backLabel={route.plate ?? t("back")}
        emptyLabel={t("no_device_data")}
      />
    </DashboardShell>
  );
}
