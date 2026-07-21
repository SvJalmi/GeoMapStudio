// ============================================================================
// GeoMap Studio — measure.js
// Click-to-add-points distance/area measuring tool, independent of the asset
// drawing tools so measuring never accidentally creates an asset.
// ============================================================================
import { map } from './map.js';
import { interactionState, claimInteraction, interactionBus } from './interaction.js';

let active = false;
let points = [];
let mode = 'distance'; // or 'area'

function el(id) { return document.getElementById(id); }

export function initMeasureTool() {
  map.addSource('measure', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'measure-line', type: 'line', source: 'measure', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#3ddc84', 'line-width': 2 } });
  map.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#3ddc84', 'fill-opacity': 0.15 } });
  map.addLayer({ id: 'measure-points', type: 'circle', source: 'measure', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#3ddc84' } });

  el('measureDistanceBtn').addEventListener('click', () => toggle('distance'));
  el('measureAreaBtn').addEventListener('click', () => toggle('area'));
  el('measureClearBtn').addEventListener('click', clear);
  interactionBus.addEventListener('changed', (e) => { if (e.detail !== 'measure' && active) stop(); });

  map.on('click', (e) => {
    if (!active) return;
    points.push([e.lngLat.lng, e.lngLat.lat]);
    render();
  });
  map.on('dblclick', () => { if (active) { points = []; render(); } });
}

function empty() { return { type: 'FeatureCollection', features: [] }; }

function isImperial() { return document.documentElement.dataset.units === 'imperial'; }

function formatDistance(km) {
  if (!isImperial()) return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
  const miles = km * 0.621371;
  return miles < 0.19 ? `${(miles * 5280).toFixed(0)} ft` : `${miles.toFixed(2)} mi`;
}
function formatArea(sqm) {
  if (!isImperial()) return sqm < 10000 ? `${sqm.toFixed(0)} m²` : `${(sqm / 10000).toFixed(2)} ha`;
  const sqft = sqm * 10.7639;
  return sqft < 43560 ? `${sqft.toFixed(0)} sq ft` : `${(sqft / 43560).toFixed(2)} acres`;
}

function toggle(kind) {
  if (active && mode === kind) { stop(); return; }
  mode = kind;
  active = true;
  claimInteraction('measure');
  points = [];
  el('measureDistanceBtn').classList.toggle('active', kind === 'distance');
  el('measureAreaBtn').classList.toggle('active', kind === 'area');
  el('measureReadout').style.display = '';
  el('measureReadout').textContent = kind === 'distance' ? 'Click points along a path…' : 'Click points around an area…';
  map.getCanvas().style.cursor = 'crosshair';
}

function stop() {
  active = false;
  if (interactionState.activeTool === 'measure') claimInteraction(null);
  map.getCanvas().style.cursor = '';
  el('measureDistanceBtn').classList.remove('active');
  el('measureAreaBtn').classList.remove('active');
}

function clear() {
  stop();
  points = [];
  map.getSource('measure')?.setData(empty());
  el('measureReadout').style.display = 'none';
}

function render() {
  const features = points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
  let readout = '';
  if (points.length >= 2) {
    if (mode === 'distance') {
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: {} };
      features.push(line);
      const km = turf.length(line, { units: 'kilometers' });
      readout = formatDistance(km);
    } else if (mode === 'area' && points.length >= 3) {
      const ring = [...points, points[0]];
      const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
      features.push(poly);
      const sqm = turf.area(poly);
      readout = formatArea(sqm);
    } else {
      readout = 'Add more points…';
    }
  }
  map.getSource('measure')?.setData({ type: 'FeatureCollection', features });
  if (readout) el('measureReadout').textContent = `${mode === 'distance' ? 'Distance' : 'Area'}: ${readout}  ·  ${points.length} point(s) — double-click map to clear`;
}
