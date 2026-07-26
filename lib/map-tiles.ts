// Base map for every Leaflet map (FleetMap, RouteMap, RouteReplayMap,
// GeofencePickerMap) — rendered by <VectorBaseLayer />.
//
// OpenFreeMap vector tiles (free, commercial use allowed, no API key) with
// their hosted "liberty" style: colorful classic-OSM look (green landuse,
// yellow/white roads, orange-red motorways, readable labels). Alternative
// ready-made styles (e.g. "bright") are a one-word swap here. Attribution is
// MANDATORY per the OSM data licence — VectorBaseLayer must keep passing
// MAP_ATTRIBUTION.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * KOYU TEMA TABANI (27.07.2026). Authkit DNA'sında kanvas #05060f; onun
 * ortasındaki parlak beyaz-yeşil bir harita ekranın tek ışık kaynağı oluyordu
 * ve gece kullanımda göz yakıyordu. OpenFreeMap'in kendi "dark" stili — CSS
 * invert/hue-rotate hilesi DEĞİL: filtre yolları ve etiketleri de bozar,
 * gerçek stil doğru renkleri baştan çizer.
 *
 * Marker/rota katmanları Leaflet pane'lerinde, GL kanvasının ÜSTÜNDE durur;
 * taban değişimi onlara dokunmaz.
 */
export const MAP_STYLE_URL_DARK = "https://tiles.openfreemap.org/styles/dark";

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
