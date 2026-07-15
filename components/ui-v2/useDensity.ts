"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Global tablo yoğunluğu (DESIGN-SYSTEM §6): rahat 48px / sıkı 40px.
 * Tek localStorage anahtarı — tercih TÜM sayfalarda geçerli; aynı sekmedeki
 * tüm DataTable'lar senkron değişir (storage-event + yerel abonelik).
 */
export type Density = "comfortable" | "compact";

const KEY = "hak-density";
const listeners = new Set<() => void>();

function readDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDensity(): [Density, (d: Density) => void] {
  const density = useSyncExternalStore(subscribe, readDensity, () => "comfortable" as Density);
  const setDensity = useCallback((d: Density) => {
    window.localStorage.setItem(KEY, d);
    listeners.forEach((cb) => cb());
  }, []);
  return [density, setDensity];
}
