// Base map tile layer, shared by every Leaflet map (FleetMap, RouteMap,
// RouteReplayMap, GeofencePickerMap).
//
// Stadia Alidade Smooth Dark WHEN NEXT_PUBLIC_STADIA_KEY is set; otherwise a
// clean fallback to OSM so the panel keeps working before the key arrives.
// Adding the key (+ rebuild) flips every map to the dark premium theme with no
// other change. Attribution is MANDATORY per each provider's licence — the
// TileLayer must keep rendering mapTile.attribution.
//
// `{r}` is Leaflet's retina token (resolves to "" without detectRetina) and is
// what Stadia recommends; harmless on the OSM URL path (not present there).
const STADIA_KEY = process.env.NEXT_PUBLIC_STADIA_KEY;

export const mapTile = STADIA_KEY
  ? {
      url: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${STADIA_KEY}`,
      attribution:
        '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  : {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    };
