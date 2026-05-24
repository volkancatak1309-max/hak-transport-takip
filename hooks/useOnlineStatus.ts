"use client";

import { useCallback, useEffect, useState } from "react";
import { countPending } from "@/lib/offline-queue";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await countPending());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshCount();
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refreshCount]);

  return { isOnline, pendingCount, refreshCount };
}
