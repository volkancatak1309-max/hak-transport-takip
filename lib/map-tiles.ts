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

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
