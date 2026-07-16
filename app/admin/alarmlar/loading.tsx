import { getSession } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ListPageSkeleton } from "@/components/ui-v2";

// Route iskeleti (DESIGN-SYSTEM §7). Kabuk oturumdan; içerik veri beklerken
// iskelet. (Kalıcı çözüm: admin layout — FAZ 4 sonrası konsolidasyon.)
export default async function Loading() {
  const session = await getSession();
  return (
    <DashboardShell
      user={{
        id: session.worker_id ?? "",
        name: session.name ?? "",
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <ListPageSkeleton />
      </div>
    </DashboardShell>
  );
}
