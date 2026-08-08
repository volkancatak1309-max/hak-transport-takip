import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/ui-v2";

/**
 * Harita araç başına ayrı son-konum sorgusu atıyor (listLatestVehiclePositions,
 * 29 araç = 29 istek). Zemin karosu inmeden önce ekran tamamen boş kalıyordu.
 */
export default function HaritaLoading() {
  return (
    <div className="space-y-4 px-4 py-6 sm:px-6">
      <Skeleton className="h-10 w-full max-w-md rounded-[12px]" />
      <LoadingState block />
      <Skeleton className="h-[60vh] w-full rounded-[12px]" />
    </div>
  );
}
