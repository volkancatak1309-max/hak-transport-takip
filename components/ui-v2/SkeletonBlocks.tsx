import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Route-düzeyi loading.tsx iskeletleri (DESIGN-SYSTEM §7). İskelet gerçek
 * yerleşimi taklit eder: StatCard sırası + filtre çubuğu + tablo satırları.
 * Her admin route'una loading.tsx zorunlu — FAZ 4'te sayfalarla birlikte gelir.
 */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-card rounded-[16px] p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("surface-card overflow-hidden rounded-[16px]", className)}>
      <div className="border-b border-border/60 px-4 py-3">
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Standart liste sayfası iskeleti: kartlar + filtre + tablo. */
export function ListPageSkeleton() {
  return (
    <div className="space-y-6">
      <StatCardsSkeleton />
      <Skeleton className="h-10 w-full rounded-[12px]" />
      <TableSkeleton />
    </div>
  );
}
