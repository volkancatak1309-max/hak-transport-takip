"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, MapPinOff } from "lucide-react";
import { recordLocation } from "@/app/actions/location";

type PermState = "pending" | "granted" | "denied";

const INTERVAL_MS = 60_000;

export function LocationTracker({ shiftId }: { shiftId: string }) {
  const t = useTranslations("map");
  const [perm, setPerm] = useState<PermState>("pending");
  const lastSentRef = useRef<{ lat: number; lng: number; accuracy: number | null } | null>(
    null
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPerm("denied");
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function send(lat: number, lng: number, accuracy: number | null) {
      lastSentRef.current = { lat, lng, accuracy };
      try {
        await recordLocation({ lat, lng, accuracy });
      } catch {
        // network failure — silently ignore, next tick retries
      }
    }

    function capture() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setPerm("granted");
          send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
        },
        (err) => {
          if (cancelled) return;
          if (err.code === err.PERMISSION_DENIED) setPerm("denied");
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
      );
    }

    capture();
    intervalId = setInterval(capture, INTERVAL_MS);

    // Best-effort final ping on unload (uses last known position)
    function onUnload() {
      const last = lastSentRef.current;
      if (!last) return;
      const body = JSON.stringify({
        lat: last.lat,
        lng: last.lng,
        accuracy: last.accuracy,
      });
      // sendBeacon survives page teardown; endpoint is best-effort
      navigator.sendBeacon?.("/api/location-beacon", body);
    }
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("beforeunload", onUnload);
    };
    // shiftId in deps so a new shift restarts tracking
  }, [shiftId]);

  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      {perm === "granted" ? (
        <>
          <MapPin className="size-3.5 text-primary" />
          {t("location_sharing")}
        </>
      ) : (
        <>
          <MapPinOff className="size-3.5" />
          {t("location_off")}
        </>
      )}
    </p>
  );
}
