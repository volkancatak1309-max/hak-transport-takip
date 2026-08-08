import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, StatCardsSkeleton } from "@/components/ui-v2";

/**
 * Araç detayı günün TAM telemetri izini okuyor (listVehicleTrack, yoğun araçta
 * ~3.100 satır) ve bundan 24 skaler üretiyor — hesap sunucuda, bekleme uzun.
 */
export default function AracDetayLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <Skeleton className="h-10 w-full max-w-md rounded-[12px]" />
      <LoadingState block />
      <StatCardsSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[280px] rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
