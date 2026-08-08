import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, StatCardsSkeleton, TableSkeleton } from "@/components/ui-v2";

/**
 * Yakıt raporu EN YAVAŞ yüzey: report_fuel_stats 7 günde 3,7 sn, 30 günde
 * statement timeout'a kadar gidiyor (ölçüldü 09.08.2026). Göstergesiz boş
 * ekran burada en çok yanıltıyordu.
 */
export default function YakitLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Skeleton className="h-10 w-full max-w-md rounded-[12px]" />
      <LoadingState block />
      <StatCardsSkeleton count={4} />
      <TableSkeleton />
    </div>
  );
}
