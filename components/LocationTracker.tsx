"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, MapPinOff } from "lucide-react";
import { recordLocation } from "@/app/actions/location";

type PermState = "pending" | "granted" | "denied";

const INTERVAL_MS = 60_000;

/**
 * Collects GPS while a shift is ACTIVE — breaks included.
 *
 * Legal guarantee (signed worker consent): location is gathered for the entire
 * duration of the shift clock, which keeps running through breaks (the driver is
 * still on duty). The parent unmounts this component the moment no shift is
 * active, which tears down the watch/interval/listener immediately so nothing is
 * sent afterwards. The `recordLocation` server action additionally refuses to
 * persist any point when there is no active shift (ended_at set) — a hard
 * backstop against stray timers or beacons after the shift ends.
 */
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
      if (cancelled) return;
      lastSentRef.current = { lat, lng, accuracy };
      try {
        await recordLocation({ lat, lng, accuracy });
      } catch {
        // network failure — silently ignore, next tick retries
      }
    }

    function capture() {
      if (cancelled) return;
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

    // Best-effort final ping on unload (uses last known position). Removed on
    // cleanup so a shift end never leaves a beacon behind. The server still
    // rejects it if the shift is over.
    function onUnload() {
      if (cancelled) return;
      const last = lastSentRef.current;
      if (!last) return;
      const body = JSON.stringify({
        lat: last.lat,
        lng: last.lng,
        accuracy: last.accuracy,
      });
      navigator.sendBeacon?.("/api/location-beacon", body);
    }
    window.addEventListener("beforeunload", onUnload);

    return () => {
      // Runs on: shift end (unmount) or shiftId change. Stops every timer and
      // listener so NO further point is captured once the shift is over.
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("beforeunload", onUnload);
    };
    // shiftId in deps: a new shift restarts tracking; unmount tears it down.
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
