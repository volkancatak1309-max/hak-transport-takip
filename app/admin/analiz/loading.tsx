import { Skeleton } from "@/components/ui/skeleton";
import { StatCardsSkeleton, TableSkeleton } from "@/components/ui-v2";

export default function AnalizLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Skeleton className="h-10 w-full max-w-md rounded-[12px]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[230px] rounded-[10px]" />
        ))}
      </div>
      <StatCardsSkeleton count={2} />
      <TableSkeleton />
      <TableSkeleton />
    </div>
  );
}
