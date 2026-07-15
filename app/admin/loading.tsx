import { getSession } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { StatCardsSkeleton, TableSkeleton } from "@/components/ui-v2";
import { Skeleton } from "@/components/ui/skeleton";

// Yönetici route iskeleti (DESIGN-SYSTEM §7): özet + filo + tablo yerleşimini
// taklit eder. Kabuk oturumdan; ~12 Supabase sorgusu beklerken iskelet görünür.
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
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <StatCardsSkeleton count={4} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-[16px]" />
          <Skeleton className="h-48 rounded-[16px]" />
        </div>
        <StatCardsSkeleton count={4} />
        <TableSkeleton rows={6} />
      </div>
    </DashboardShell>
  );
}
