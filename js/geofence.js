// ============================================================================
// GeoMap Studio — geofence.js
// Draw one or more geofence polygons; every asset (and the simulated tracked
// vehicle from tracking.js) is checked against them with turf.booleanPointInPolygon.
// ============================================================================
import { map } from './map.js';
import { store } from './store.js';
import { pushNotification } from './notifications.js';
import { interactionBus, claimInteraction, interactionState } from './interaction.js';

let fences = []; // { id, name, geometry }
let drawing = false;
let draftPoints = [];
const breachState = new Map(); // assetId -> Set(fenceId) currently inside

function el(id) { return document.getElementById(id); }

export function initGeofence() {
  el('geofenceDrawBtn').addEventListener('click', () => {
    drawing = !drawing;
    draftPoints = [];
    claimInteraction(drawing ? 'geofence' : null);
    el('geofenceDrawBtn').classList.toggle('active', drawing);
    el('geofenceHint').style.display = drawing ? '' : 'none';
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  });
  el('geofenceClearBtn').addEventListener('click', () => {
    fences = [];
    map.getSource('geofences').setData({ type: 'FeatureCollection', features: [] });
    renderList();
  });

  map.on('click', (e) => {
    if (!drawing) return;
    draftPoints.push([e.lngLat.lng, e.lngLat.lat]);
    if (draftPoints.length >= 3) {
      const first = map.project(draftPoints[0]);
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 10) { finishFence(); return; }
    }
    renderDraft();
  });
  map.on('dblclick', () => { if (drawing) finishFence(); });

  interactionBus.addEventListener('changed', (e) => {
    if (e.detail !== 'geofence' && drawing) { drawing = false; draftPoints = []; el('geofenceDrawBtn').classList.remove('active'); el('geofenceHint').style.display = 'none'; map.getCanvas().style.cursor = ''; }
  });

  store.addEventListener('assets:changed', checkBreaches);
  setInterval(checkBreaches, 4000);
}

function renderDraft() {
  const feats = draftPoints.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
  if (draftPoints.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: draftPoints }, properties: {} });
  map.getSource('geofences').setData({ type: 'FeatureCollection', features: [...fences.map((f) => f.geometry && toFeature(f)), ...feats].filter(Boolean) });
}

function toFeature(fence) { return { type: 'Feature', geometry: fence.geometry, properties: { name: fence.name } }; }

function finishFence() {
  drawing = false;
  claimInteraction(null);
  el('geofenceDrawBtn').classList.remove('active');
  el('geofenceHint').style.display = 'none';
  map.getCanvas().style.cursor = '';
  if (draftPoints.length < 3) { draftPoints = []; renderAll(); return; }
  const ring = [...draftPoints, draftPoints[0]];
  const fence = { id: `GEO-${fences.length + 1}`, name: `Zone ${fences.length + 1}`, geometry: { type: 'Polygon', coordinates: [ring] } };
  fences.push(fence);
  draftPoints = [];
  renderAll();
  renderList();
  pushNotification(`Geofence "${fence.name}" created`, 'success');
}

function renderAll() {
  map.getSource('geofences')?.setData({ type: 'FeatureCollection', features: fences.map(toFeature) });
}

function renderList() {
  const list = el('geofenceList');
  if (!fences.length) { list.innerHTML = `<div class="empty-state">No geofences yet — draw one on the map.</div>`; return; }
  list.innerHTML = fences.map((f) => `<div class="geofence-row"><b>${f.name}</b> <button class="btn btn-sm" data-id="${f.id}">Remove</button></div>`).join('');
  list.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    fences = fences.filter((f) => f.id !== btn.dataset.id);
    renderAll(); renderList();
  }));
}

function checkBreaches() {
  if (!fences.length) return;
  store.assets.forEach((feature, id) => {
    const pt = feature.geometry.type === 'Point' ? feature.geometry
      : { type: 'Point', coordinates: feature.geometry.type === 'LineString' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0] };
    const currentlyInside = new Set();
    fences.forEach((fence) => {
      try {
        if (turf.booleanPointInPolygon(pt, fence.geometry)) currentlyInside.add(fence.id);
      } catch { /* ignore malformed geometry */ }
    });
    const prevInside = breachState.get(id) || new Set();
    currentlyInside.forEach((fid) => {
      if (!prevInside.has(fid)) {
        const fence = fences.find((f) => f.id === fid);
        pushNotification(`${feature.properties.name} entered ${fence.name}`, 'warn');
      }
    });
    prevInside.forEach((fid) => {
      if (!currentlyInside.has(fid)) {
        const fence = fences.find((f) => f.id === fid);
        pushNotification(`${feature.properties.name} left ${fence?.name || fid}`, 'info');
      }
    });
    breachState.set(id, currentlyInside);
  });
}

export function checkPointAgainstFences(lngLat, label) {
  if (!fences.length) return;
  fences.forEach((fence) => {
    try {
      if (turf.booleanPointInPolygon({ type: 'Point', coordinates: lngLat }, fence.geometry)) {
        // Rate-limited by tracking.js caller; kept simple here.
      }
    } catch { /* ignore */ }
  });
}
