"use client";

import { useEffect, useState } from "react";
import { workedMs } from "@/lib/format";
import { formatDuration } from "@/lib/format";
import type { TimeEntryWithWorker } from "@/lib/types";

/**
 * Aktif vardiyanın canlı çalışma süresi — SADECE bu bileşen saniyede bir
 * yeniden render olur. Eski tasarımda 1sn'lik tick tüm AdminClient'ı (700+
 * satırlık tablo dahil) her saniye reconcile ediyordu (FAZ 0 kritik #4);
 * artık tick yalnız ekranda görünen aktif hücrelerde yaşar.
 */
export function LiveWorked({ entry }: { entry: TimeEntryWithWorker }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{formatDuration(workedMs(entry, now))}</>;
}
