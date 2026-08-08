import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getAssignments } from "@/app/actions/assignments";
import { AdminAssignmentsClient } from "./AdminAssignmentsClient";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/seferler");

  const assignments = await getAssignments();

  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  // driver-scoped: sefer ataması bir ŞOFÖR görevidir; yönetici hesapları
  // seçicide çıkmamalı (seçilirse gerçek bir atama satırı doğar ve sefer
  // sayıları yöneticiye yazılır). Şefler is_admin=false → seçilebilir kalır.
  const { data: workers } = await onlyDrivers(
    withoutTestRows(
      supabaseAdmin
        .from("workers")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      "id",
      scope.workerIds
    ),
    "id",
    driverScope
  );
  const workerOpts = (workers ?? []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
  }));
  const t = await getTranslations("assignments");

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
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <AdminAssignmentsClient assignments={assignments} workers={workerOpts} />
      </div>
    </DashboardShell>
  );
}
