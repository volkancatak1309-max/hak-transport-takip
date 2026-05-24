"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { countPending } from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-aware";

export function OfflineBadge() {
  const t = useTranslations("offline");
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setPending(await countPending());
    } catch {
      /* ignore */
    }
  }, []);

  const doFlush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const sent = await flushQueue();
      await refresh();
      if (sent > 0) {
        toast.success(t("flushed_toast"));
        router.refresh();
      }
    } finally {
      flushing.current = false;
    }
  }, [refresh, router, t]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    refresh();

    const onOnline = () => {
      setIsOnline(true);
      void doFlush();
    };
    const onOffline = () => setIsOnline(false);

    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "hak-flush") void doFlush();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    navigator.serviceWorker?.addEventListener?.("message", onSwMessage);
    const iv = setInterval(refresh, 5000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker?.removeEventListener?.("message", onSwMessage);
      clearInterval(iv);
    };
  }, [refresh, doFlush]);

  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
        <WifiOff className="size-3.5" />
        {t("offline_with_count", { count: pending })}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        {pending}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground/60 transition-opacity hover:text-muted-foreground"
      )}
    >
      <Wifi className="size-3.5" />
      <span className="hidden lg:inline">{t("online")}</span>
    </span>
  );
}
