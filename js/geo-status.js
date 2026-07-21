// ============================================================================
// GeoMap Studio — geo-status.js
// Small always-on readouts, direct equivalents of MapLibre's "Get coordinates
// of the mouse pointer" and "Display Map Performance Metrics" examples.
// ============================================================================
import { map } from './map.js';

function el(id) { return document.getElementById(id); }

export function initGeoStatus() {
  map.on('mousemove', (e) => {
    el('coordReadout').textContent = `${e.lngLat.lng.toFixed(5)}, ${e.lngLat.lat.toFixed(5)}`;
  });
  map.on('move', () => {
    el('cameraReadout').textContent = `z${map.getZoom().toFixed(1)} · p${map.getPitch().toFixed(0)}° · b${map.getBearing().toFixed(0)}°`;
  });

  // Rolling FPS estimate from consecutive 'render' events.
  let last = performance.now();
  let frames = 0;
  let fps = 0;
  map.on('render', () => {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      fps = frames;
      frames = 0;
      last = now;
      el('fpsReadout').textContent = `${fps} fps`;
    }
  });
}
