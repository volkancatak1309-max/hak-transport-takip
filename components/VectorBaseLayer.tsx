"use client";

import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import { MAP_ATTRIBUTION, MAP_STYLE_URL, MAP_STYLE_URL_DARK } from "@/lib/map-tiles";

// Vector base layer shared by all maps — replaces the old raster <TileLayer>.
// MapLibre GL draws the OpenFreeMap style onto a canvas that the
// maplibre-gl-leaflet bridge keeps in Leaflet's tile pane, so markers, popups
// and polylines stay plain Leaflet and render above it untouched.
export function VectorBaseLayer() {
  const map = useMap();
  // Tema değişince GL katmanı SÖKÜLÜP yeniden kurulur: maplibre-gl-leaflet
  // köprüsü çalışırken stil değiştirmeye izin vermiyor, effect'in bağımlılığı
  // olması gereken şey stil URL'i.
  const { resolvedTheme } = useTheme();
  const styleUrl = resolvedTheme === "dark" ? MAP_STYLE_URL_DARK : MAP_STYLE_URL;

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const gl = L.maplibreGL({
      style: styleUrl,
      // The bridge copies customAttribution into Leaflet's attribution control.
      attributionControl: { customAttribution: MAP_ATTRIBUTION },
      // Label/tile fade is the only GL-side animation; kill it when the user
      // asks for reduced motion.
      ...(reducedMotion ? { fadeDuration: 0 } : {}),
    });
    gl.addTo(map);
    return () => {
      gl.remove();
    };
  }, [map, styleUrl]);

  return null;
}
