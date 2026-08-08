import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, StatCardsSkeleton, TableSkeleton } from "@/components/ui-v2";

export default function RaporlarLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Skeleton className="h-10 w-full max-w-md rounded-[12px]" />
      <LoadingState block />
      <StatCardsSkeleton count={3} />
      <TableSkeleton />
    </div>
  );
}
