// ============================================================================
// GeoMap Studio — routing.js
// Click a start point, then any number of stops; "Finish route" computes a
// path through all of them. With more than two points, the intermediate
// stops are reordered by a real nearest-neighbor heuristic before asking
// OSRM for real road-based distance/ETA. Supports Drive/Walk/Cycle profiles;
// the public OSRM demo server only actually hosts driving-profile data, so
// walking/cycling gracefully fall back to a straight-line estimate at a
// mode-appropriate speed if the profile request fails — same honest pattern
// as the existing "no internet" fallback, just parameterized by mode.
// ============================================================================
import { map } from './map.js';
import { interactionState, claimInteraction, interactionBus } from './interaction.js';

let picking = false;
let points = [];
let mode = 'driving'; // 'driving' | 'walking' | 'cycling'
let lastRouteGeometry = null;
let animId = null;

const MODE_SPEED_KMH = { driving: 30, walking: 5, cycling: 15 };

function el(id) { return document.getElementById(id); }

export function initRouting() {
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#f5923a', 'line-width': 4 } });
  map.addLayer({ id: 'route-points', type: 'circle', source: 'route', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#f5923a' } });
  map.addSource('route-vehicle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-vehicle-layer', type: 'circle', source: 'route-vehicle', paint: { 'circle-radius': 7, 'circle-color': '#59d98e', 'circle-stroke-width': 2, 'circle-stroke-color': '#0b1120' } });

  ['driving', 'walking', 'cycling'].forEach((m) => {
    el(`routeMode${cap(m)}`)?.addEventListener('click', () => setMode(m));
  });
  setMode('driving', { silent: true });

  el('routeStartBtn').addEventListener('click', () => {
    picking = !picking;
    points = [];
    stopAnimation();
    claimInteraction(picking ? 'route' : null);
    el('routeStartBtn').classList.toggle('active', picking);
    el('routeFinishBtn').style.display = picking ? '' : 'none';
    el('routeHint').style.display = picking ? '' : 'none';
    el('routeHint').textContent = 'Click a start point, then each stop to visit. Use "Finish route" when done (2+ points).';
    if (el('routeStartInput')) el('routeStartInput').value = '';
    if (el('routeEndInput')) el('routeEndInput').value = '';
    map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  });
  el('routeFinishBtn').addEventListener('click', finishPicking);
  el('routeClearBtn').addEventListener('click', clearRoute);
  el('routeAnimateBtn')?.addEventListener('click', toggleAnimateVehicle);

  map.on('click', (e) => {
    if (!picking) return;
    points.push([e.lngLat.lng, e.lngLat.lat]);
    map.getSource('route').setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })),
    });
    if (points.length === 1 && el('routeStartInput')) el('routeStartInput').value = coordLabel(points[0]);
    if (points.length >= 2 && el('routeEndInput')) el('routeEndInput').value = coordLabel(points[points.length - 1]);
    el('routeHint').textContent = points.length === 1
      ? 'Now click each stop to visit, then "Finish route".'
      : `${points.length} point(s) — click to add more, or "Finish route".`;
  });

  interactionBus.addEventListener('changed', (e) => {
    if (e.detail !== 'route' && picking) {
      picking = false; points = [];
      el('routeStartBtn').classList.remove('active');
      el('routeFinishBtn').style.display = 'none';
      el('routeHint').style.display = 'none';
      map.getCanvas().style.cursor = '';
    }
  });
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function coordLabel(p) { return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`; }
function isImperial() { return document.documentElement.dataset.units === 'imperial'; }
function formatKm(km) {
  if (!isImperial()) return `${km.toFixed(2)} km`;
  return `${(km * 0.621371).toFixed(2)} mi`;
}

function setMode(next, { silent } = {}) {
  mode = next;
  ['driving', 'walking', 'cycling'].forEach((m) => el(`routeMode${cap(m)}`)?.classList.toggle('active', m === mode));
  if (!silent && lastRouteGeometry) {
    // Re-run with the same waypoints under the new mode if a route is already up.
    computeRoute(lastRouteGeometry.waypoints);
  }
}

function finishPicking() {
  if (points.length < 2) { el('routeHint').textContent = 'Add at least a start and one stop first.'; return; }
  picking = false;
  claimInteraction(null);
  el('routeStartBtn').classList.remove('active');
  el('routeFinishBtn').style.display = 'none';
  map.getCanvas().style.cursor = '';

  const start = points[0];
  const stops = points.slice(1);
  const ordered = stops.length > 1 ? nearestNeighborOrder(start, stops) : stops;
  computeRoute([start, ...ordered]);
}

// A real (if approximate) route-optimization heuristic: repeatedly jump to
// whichever remaining stop is closest to the current position. This is the
// standard nearest-neighbor TSP heuristic — simple, explainable, and
// genuinely reorders stops for a shorter overall path, though it isn't
// guaranteed globally optimal (true TSP is NP-hard).
function nearestNeighborOrder(start, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = start;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((pt, i) => {
      const d = turf.distance(turf.point(current), turf.point(pt), { units: 'kilometers' });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

function clearRoute() {
  points = [];
  lastRouteGeometry = null;
  stopAnimation();
  map.getSource('route')?.setData({ type: 'FeatureCollection', features: [] });
  el('routeHint').style.display = 'none';
  el('routeResult').style.display = 'none';
  if (el('routeStartInput')) el('routeStartInput').value = '';
  if (el('routeEndInput')) el('routeEndInput').value = '';
}

async function computeRoute(waypoints) {
  el('routeHint').style.display = 'none';
  el('routeResult').style.display = '';
  el('routeResult').textContent = 'Calculating route…';
  const coordStr = waypoints.map((p) => `${p[0]},${p[1]}`).join(';');
  try {
    const url = `https://router.project-osrm.org/route/v1/${mode}/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM request failed');
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error('No route found');
    map.getSource('route').setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: route.geometry, properties: {} },
        ...waypoints.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })),
      ],
    });
    lastRouteGeometry = { geometry: route.geometry, waypoints };
    const km = (route.distance / 1000).toFixed(2);
    // Deliberately NOT using route.duration here: the public OSRM demo
    // server (router.project-osrm.org) only actually hosts driving-profile
    // data, so a /walking/ or /cycling/ request can still return 200 OK
    // with real road-network distance but a duration computed at car
    // speed — which is exactly why Drive/Walk/Cycle were showing identical
    // times. The real road distance is trustworthy; the ETA is computed
    // ourselves from that distance at each mode's realistic average speed.
    const speed = MODE_SPEED_KMH[mode];
    const mins = Math.round((parseFloat(km) / speed) * 60);
    const stopsNote = waypoints.length > 2 ? ` · ${waypoints.length - 1} stop(s), order optimized` : '';
    el('routeResult').textContent = `${cap(mode)} route: ${formatKm(parseFloat(km))} · ETA ${mins} min${stopsNote}`;
    map.fitBounds(turf.bbox(route.geometry), { padding: 80, duration: 500 });
  } catch (err) {
    // Graceful fallback: straight-line great-circle distance through each leg,
    // at a speed assumption matching the chosen travel mode, clearly labeled.
    const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints }, properties: {} };
    map.getSource('route').setData({
      type: 'FeatureCollection',
      features: [line, ...waypoints.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))],
    });
    lastRouteGeometry = { geometry: line.geometry, waypoints };
    const km = turf.length(line, { units: 'kilometers' }).toFixed(2);
    const speed = MODE_SPEED_KMH[mode];
    const estMins = Math.round((km / speed) * 60);
    const stopsNote = waypoints.length > 2 ? ` across ${waypoints.length - 1} stop(s)` : '';
    el('routeResult').textContent = `${cap(mode)} router unavailable — straight-line estimate${stopsNote}: ${formatKm(parseFloat(km))} · ~${estMins} min at ${speed} km/h`;
    map.fitBounds(turf.bbox(line), { padding: 80, duration: 500 });
  }
}

// ---- Animate Vehicle: moves a marker along the last computed route -------
function toggleAnimateVehicle() {
  if (animId) { stopAnimation(); return; }
  if (!lastRouteGeometry) { el('routeResult').textContent = 'Calculate a route first.'; el('routeResult').style.display = ''; return; }
  const line = lastRouteGeometry.geometry;
  const totalKm = turf.length({ type: 'Feature', geometry: line, properties: {} }, { units: 'kilometers' });
  if (!(totalKm > 0)) return;
  let progress = 0;
  const speedKmh = MODE_SPEED_KMH[mode];
  el('routeAnimateBtn').textContent = '⏸ Pause vehicle';
  const tick = () => {
    progress += (speedKmh / 3600) * 0.25; // ~0.25s of travel per animation tick
    if (progress > totalKm) progress = 0;
    const along = turf.along({ type: 'Feature', geometry: line, properties: {} }, progress, { units: 'kilometers' });
    map.getSource('route-vehicle')?.setData({ type: 'FeatureCollection', features: [along] });
    animId = requestAnimationFrame(() => setTimeout(tick, 250));
  };
  tick();
}
function stopAnimation() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  el('routeAnimateBtn') && (el('routeAnimateBtn').textContent = '▶ Animate Vehicle');
  map.getSource('route-vehicle')?.setData({ type: 'FeatureCollection', features: [] });
}
