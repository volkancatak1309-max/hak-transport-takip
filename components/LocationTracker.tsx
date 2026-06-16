"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, MapPinOff, PauseCircle } from "lucide-react";
import { recordLocation } from "@/app/actions/location";

type PermState = "pending" | "granted" | "denied";

const INTERVAL_MS = 60_000;

/**
 * Collects GPS only while a shift is ACTIVE and NOT paused (break).
 *
 * Legal guarantee (signed worker consent): location is gathered solely while
 * the shift clock is running. The parent unmounts this component when no shift
 * is active and passes `paused` during breaks. Either condition tears down the
 * watch/interval/listener immediately so nothing is sent afterwards. The
 * `recordLocation` server action additionally refuses to persist any point when
 * there is no active shift — a hard backstop against stray timers or beacons.
 */
export function LocationTracker({
  shiftId,
  paused = false,
}: {
  shiftId: string;
  paused?: boolean;
}) {
  const t = useTranslations("map");
  const [perm, setPerm] = useState<PermState>("pending");
  const lastSentRef = useRef<{ lat: number; lng: number; accuracy: number | null } | null>(
    null
  );

  useEffect(() => {
    // While paused (on break) we run NO setup. The cleanup of the previous
    // (unpaused) effect run has already cleared the interval and removed the
    // unload listener, so tracking is fully stopped until the break ends.
    if (paused) return;

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

    // Best-effort final ping on unload (uses last known position). Only armed
    // while actively tracking; removed on cleanup so a break or shift end never
    // leaves a beacon behind. The server still rejects it if the shift is over.
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
      // Runs on: shift end (unmount), break start (paused -> true), or shiftId
      // change. Stops every timer and listener so NO further point is captured.
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("beforeunload", onUnload);
    };
    // paused/shiftId in deps: toggling either restarts or tears down tracking.
  }, [shiftId, paused]);

  if (paused) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <PauseCircle className="size-3.5" />
        {t("location_paused")}
      </p>
    );
  }

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
