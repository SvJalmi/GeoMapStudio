// ============================================================================
// GeoMap Studio — day-night.js
// Draws the actual night hemisphere as a polygon (not a decorative tint):
// the subsolar point is computed from the current UTC time using standard
// approximate solar-position formulas, then the night region is a circle of
// 90° angular radius centered on the antisolar point — the same technique
// classic "day/night world map" widgets use. Ignores atmospheric refraction
// and the equation of time (~±4° longitude error at most), which is the
// normal, accepted approximation for a visual overlay like this.
// ============================================================================
import { map } from './map.js';

let enabled = false;
let intervalId = null;

function el(id) { return document.getElementById(id); }

export function initDayNight() {
  map.addSource('night-overlay', { type: 'geojson', data: empty() });
  map.addLayer({
    id: 'night-overlay-fill', type: 'fill', source: 'night-overlay',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#000814', 'fill-opacity': 0.45 },
  }, 'clusters');

  el('toggleDayNight')?.addEventListener('change', (e) => setEnabled(e.target.checked));
}

function empty() { return { type: 'FeatureCollection', features: [] }; }

export function setEnabled(on) {
  enabled = on;
  map.setLayoutProperty('night-overlay-fill', 'visibility', on ? 'visible' : 'none');
  if (on) {
    updateTerminator();
    if (!intervalId) intervalId = setInterval(updateTerminator, 5 * 60 * 1000); // recompute every 5 min
  } else if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  return enabled;
}

function subsolarPoint(date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86400000);
  // Solar declination (approximate, degrees).
  const declination = -23.44 * Math.cos((2 * Math.PI / 365.24) * (dayOfYear + 10));
  // Subsolar longitude: at UTC 12:00 the sun is over 0°E; each hour shifts 15° west.
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -(utcHours - 12) * 15;
  lon = ((lon + 180) % 360 + 360) % 360 - 180; // normalize to [-180, 180]
  return [lon, declination];
}

function updateTerminator() {
  const [subLon, subLat] = subsolarPoint(new Date());
  const antisolar = [((subLon + 180 + 180) % 360) - 180, -subLat];
  try {
    const nightCircle = turf.circle(antisolar, 10007.5, { steps: 128, units: 'kilometers' });
    map.getSource('night-overlay')?.setData(nightCircle);
  } catch (err) {
    console.warn('Day/Night terminator computation failed:', err);
  }
}

export function isDayNightEnabled() { return enabled; }
