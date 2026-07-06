// Base map for every Leaflet map (FleetMap, RouteMap, RouteReplayMap,
// GeofencePickerMap) — rendered by <VectorBaseLayer />.
//
// OpenFreeMap vector tiles (free, commercial use allowed, no API key) with our
// own dark style hosted in public/. The style JSON pins OpenFreeMap's real
// glyph/sprite/tile URLs; only the colors are ours. Attribution is MANDATORY
// per the OSM data licence — VectorBaseLayer must keep passing MAP_ATTRIBUTION.
export const MAP_STYLE_URL = "/map-style-dark.json";

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
