// ============================================================================
// GeoMap Studio — hashrouter.js
// Mirrors MapLibre's "Hash routing" example: keeps zoom/lng/lat/bearing/pitch
// in the URL fragment so a reload or a shared link restores the same view.
// ============================================================================
import { map } from './map.js';

let enabled = true;
export function setHashRoutingEnabled(on) { enabled = on; }

export function initHashRouter() {
  const parseHash = () => {
    const parts = location.hash.replace('#', '').split('/').map(Number);
    if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
      const [zoom, lat, lng, bearing = 0, pitch = 0] = parts;
      return { zoom, center: [lng, lat], bearing, pitch };
    }
    return null;
  };

  const initial = parseHash();
  if (initial) map.jumpTo(initial);

  let writing = false;
  map.on('moveend', () => {
    if (writing || !enabled) return;
    writing = true;
    const c = map.getCenter();
    const hash = `#${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}/${map.getBearing().toFixed(0)}/${map.getPitch().toFixed(0)}`;
    history.replaceState(null, '', hash);
    writing = false;
  });
}
