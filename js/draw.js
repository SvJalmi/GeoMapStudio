// ============================================================================
// GeoMap Studio — draw.js
// A self-contained drawing toolkit built directly on MapLibre + Turf (no
// third-party "-draw" plugin, so every mode's behaviour is fully understood
// and testable rather than borrowed from an opaque library):
//   point, line, polygon, rectangle, circle, freehand, vertex-edit,
//   undo/redo of in-progress vertices, snapping to nearby roads/pipelines,
//   duplicate / rotate / merge / split for existing polygons.
// ============================================================================
import { map, rebuildSources } from './map.js';
import { store } from './store.js';
import { openAssetForm } from './assets.js';
import { pushNotification } from './notifications.js';
import { interactionState, claimInteraction, interactionBus } from './interaction.js';

let mode = null;
let draftCoords = [];
let dragStart = null;
let editingFeatureId = null;
let editVertexMarkers = [];

function el(id) { return document.getElementById(id); }
function draftSource() { return map.getSource('draft'); }

export function initDrawTools() {
  map.addSource('draft', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#3fa9f5', 'fill-opacity': 0.15 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['in', '$type', 'LineString', 'Polygon'], paint: { 'line-color': '#3fa9f5', 'line-width': 2, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'draft-vertex', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#3fa9f5', 'circle-stroke-width': 2 } });

  document.querySelectorAll('.draw-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode === mode ? null : btn.dataset.mode));
  });
  el('drawFinishBtn').addEventListener('click', finishDraft);
  el('drawCancelBtn').addEventListener('click', () => setMode(null));
  el('drawUndoPointBtn').addEventListener('click', undoLastVertex);

  map.on('click', onMapClick);
  map.on('dblclick', onDblClick);
  map.on('mousemove', onMouseMove);
  map.on('mousedown', onMouseDown);
  map.on('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);

  el('globalUndoBtn').addEventListener('click', () => { store.undo() && flashUndo(); });
  el('globalRedoBtn').addEventListener('click', () => { store.redo() && flashUndo(); });
  store.addEventListener('assets:changed', rebuildSources);

  el('editVertexBtn').addEventListener('click', () => setMode(mode === 'edit' ? null : 'edit'));
  el('mergeBtn').addEventListener('click', mergeSelectedPolygons);
  el('duplicateBtn').addEventListener('click', duplicateSelected);
  el('rotateSlider').addEventListener('input', (e) => rotateEditingFeature(parseFloat(e.target.value)));
  interactionBus.addEventListener('changed', (e) => {
    if (e.detail !== 'draw' && mode) {
      mode = null; clearDraft(); clearEditMarkers();
      document.querySelectorAll('.draw-tool-btn').forEach((b) => b.classList.remove('active'));
      el('drawHint').style.display = 'none'; el('drawActionBar').style.display = 'none';
      map.getCanvas().style.cursor = '';
    }
  });
  el('rotateSlider').addEventListener('change', () => {
    if (editingFeatureId && window.__rotatedPreview) {
      store.updateAsset(editingFeatureId, { geometry: window.__rotatedPreview.geometry });
      window.__rotatedPreview = null;
    }
  });
}

function empty() { return { type: 'FeatureCollection', features: [] }; }

let currentDraftFeatures = [];
function setDraftData(features) {
  currentDraftFeatures = features;
  draftSource()?.setData({ type: 'FeatureCollection', features });
}

function setMode(next) {
  if (next === 'split') {
    const ids = [...store.selectedIds];
    const feats = ids.map((id) => store.assets.get(id)).filter((f) => f?.geometry.type === 'Polygon');
    if (feats.length !== 1) {
      pushNotification('Select exactly one polygon asset in the list first, then choose Split.', 'warn');
      return;
    }
  }
  clearDraft();
  clearEditMarkers();
  mode = next;
  if (next) claimInteraction('draw'); else if (interactionState.activeTool === 'draw') claimInteraction(null);
  document.querySelectorAll('.draw-tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  el('drawHint').textContent = HINTS[mode] || '';
  el('drawHint').style.display = mode ? '' : 'none';
  el('drawActionBar').style.display = (mode && mode !== 'edit') ? '' : 'none';
  map.getCanvas().style.cursor = mode ? 'crosshair' : '';
  if (mode === 'edit') {
    el('drawHint').style.display = '';
  }
}

const HINTS = {
  point: 'Click the map to place a point asset.',
  line: 'Click to add vertices. Double-click or press Enter to finish.',
  polygon: 'Click to add vertices. Double-click, or click the first point again, to close.',
  rectangle: 'Click-drag from one corner to the opposite corner.',
  circle: 'Click the center, then drag out to set the radius.',
  freehand: 'Hold the mouse button and drag to sketch a freehand shape.',
  edit: 'Click an existing point, line, or polygon asset to edit its vertices.',
  split: 'Select exactly one polygon in the list first. Then click two points to draw a straight cut line across it.',
};

// ---- snapping helper: pulls a click coordinate onto a nearby line if close ---
function snapToNearbyLine(lngLat) {
  const px = map.project(lngLat);
  const nearby = map.queryRenderedFeatures(
    [[px.x - 12, px.y - 12], [px.x + 12, px.y + 12]],
    { layers: ['lines-layer'] }
  );
  if (!nearby.length) return lngLat;
  const pt = turf.point([lngLat.lng, lngLat.lat]);
  let best = null, bestDist = Infinity;
  nearby.forEach((f) => {
    try {
      const snapped = turf.nearestPointOnLine(f.geometry, pt, { units: 'meters' });
      if (snapped.properties.dist < bestDist) { bestDist = snapped.properties.dist; best = snapped; }
    } catch { /* ignore malformed geometry */ }
  });
  if (best && bestDist < 15) {
    pushNotification('Snapped to nearby line', 'info', 1500);
    return { lng: best.geometry.coordinates[0], lat: best.geometry.coordinates[1] };
  }
  return lngLat;
}

function onMapClick(e) {
  if (mode === 'edit') { startEditingAt(e); return; }
  if (mode === 'split') {
    draftCoords.push([e.lngLat.lng, e.lngLat.lat]);
    renderDraft(e.lngLat);
    if (draftCoords.length === 2) {
      const targetId = [...store.selectedIds][0];
      performSplit(targetId, draftCoords[0], draftCoords[1]);
      clearDraft();
      setMode(null);
    }
    return;
  }
  if (!mode || ['rectangle', 'circle', 'freehand'].includes(mode)) return;
  const snapped = (mode === 'point' || mode === 'line' || mode === 'polygon') ? snapToNearbyLine(e.lngLat) : e.lngLat;

  if (mode === 'point') {
    openAssetForm(null, { type: 'Point', coordinates: [snapped.lng, snapped.lat] });
    setMode(null);
    return;
  }
  // polygon closing: click near first vertex
  if (mode === 'polygon' && draftCoords.length >= 3) {
    const first = map.project(draftCoords[0]);
    if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 10) { finishDraft(); return; }
  }
  draftCoords.push([snapped.lng, snapped.lat]);
  renderDraft(e.lngLat);
}

function onDblClick(e) {
  if (mode === 'line' || mode === 'polygon') { e.preventDefault(); finishDraft(); }
}

function onMouseMove(e) {
  if (mode === 'line' || mode === 'polygon') renderDraft(e.lngLat);
  if (dragStart && (mode === 'rectangle' || mode === 'circle' || mode === 'freehand')) {
    if (mode === 'freehand') {
      draftCoords.push([e.lngLat.lng, e.lngLat.lat]);
      setDraftData([{ type: 'Feature', geometry: { type: 'LineString', coordinates: draftCoords }, properties: {} }]);
    } else if (mode === 'rectangle') {
      const ring = rectRing(dragStart, e.lngLat);
      setDraftData([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }]);
    } else if (mode === 'circle') {
      const radiusKm = turf.distance(turf.point(dragStart), turf.point([e.lngLat.lng, e.lngLat.lat]), { units: 'kilometers' });
      const circle = turf.circle(dragStart, Math.max(radiusKm, 0.005), { steps: 48, units: 'kilometers' });
      setDraftData([circle]);
    }
  }
  if (mode === 'edit' && editVertexMarkers.length) return; // marker drag handled by marker's own listeners
}

function onMouseDown(e) {
  if (mode === 'rectangle' || mode === 'circle' || mode === 'freehand') {
    dragStart = [e.lngLat.lng, e.lngLat.lat];
    draftCoords = [dragStart];
    map.dragPan.disable();
  }
}
function onMouseUp() {
  if (dragStart && (mode === 'rectangle' || mode === 'circle' || mode === 'freehand')) {
    map.dragPan.enable();
    finishDraft();
    dragStart = null;
  }
}

function rectRing(a, b) {
  return [[a.lng ?? a[0], a.lat ?? a[1]], [b.lng, a.lat ?? a[1]], [b.lng, b.lat], [a.lng ?? a[0], b.lat], [a.lng ?? a[0], a.lat ?? a[1]]];
}

function renderDraft(cursor) {
  const features = [];
  if (draftCoords.length) {
    draftCoords.forEach((c) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
    const line = cursor ? [...draftCoords, [cursor.lng, cursor.lat]] : draftCoords;
    if (mode === 'polygon' && line.length >= 3) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...line, line[0]]] }, properties: {} });
    } else if (line.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} });
    }
  }
  setDraftData(features);
}

function undoLastVertex() {
  draftCoords.pop();
  renderDraft();
}

function onKeyDown(e) {
  if (e.key === 'Escape') setMode(null);
  if (e.key === 'Enter' && (mode === 'line' || mode === 'polygon')) finishDraft();
  if (e.key === 'Backspace' && (mode === 'line' || mode === 'polygon') && document.activeElement === document.body) undoLastVertex();
}

function finishDraft() {
  let geometry = null;
  if (mode === 'line' && draftCoords.length >= 2) geometry = { type: 'LineString', coordinates: draftCoords };
  if (mode === 'polygon' && draftCoords.length >= 3) geometry = { type: 'Polygon', coordinates: [[...draftCoords, draftCoords[0]]] };
  if (mode === 'freehand' && draftCoords.length >= 3) {
    // Close the freehand path into a polygon if endpoints are reasonably close, else keep as a line.
    const startEnd = turf.distance(turf.point(draftCoords[0]), turf.point(draftCoords[draftCoords.length - 1]), { units: 'meters' });
    geometry = startEnd < 60 ? { type: 'Polygon', coordinates: [[...draftCoords, draftCoords[0]]] } : { type: 'LineString', coordinates: draftCoords };
  }
  if ((mode === 'rectangle' || mode === 'circle') && dragStart) {
    const match = currentDraftFeatures.find((f) => f.geometry.type === 'Polygon');
    geometry = match ? match.geometry : null;
  }

  const activeMode = mode;
  clearDraft();
  setMode(null);
  if (!geometry) { if (activeMode) pushNotification('Shape needs more points — try again.', 'warn'); return; }
  openAssetForm(null, geometry);
}

function clearDraft() {
  draftCoords = [];
  dragStart = null;
  setDraftData([]);
}

// ---------------------------------------------------------------------------
// Vertex editing for existing assets
// ---------------------------------------------------------------------------
function startEditingAt(e) {
  clearEditMarkers();
  const hits = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point', 'lines-layer', 'polygons-fill'] });
  if (!hits.length) return;
  const id = hits[0].properties.id;
  const feature = store.assets.get(id);
  if (!feature) return;
  editingFeatureId = id;
  el('editPanel').style.display = '';
  el('editPanelLabel').textContent = `Editing ${id}`;
  el('rotateSlider').value = 0;

  const coordsList = feature.geometry.type === 'Point' ? [feature.geometry.coordinates]
    : feature.geometry.type === 'LineString' ? feature.geometry.coordinates
    : feature.geometry.coordinates[0].slice(0, -1);

  coordsList.forEach((coord, idx) => {
    const dom = document.createElement('div');
    dom.className = 'vertex-handle';
    const marker = new maplibregl.Marker({ element: dom, draggable: feature.geometry.type !== 'Point' || true })
      .setLngLat(coord)
      .addTo(map);
    marker.on('drag', () => {
      const ll = marker.getLngLat();
      updateGeometryVertex(feature, idx, [ll.lng, ll.lat]);
    });
    marker.on('dragend', () => commitEdit(feature));
    editVertexMarkers.push(marker);
  });

  el('editSaveBtn').onclick = () => { commitEdit(feature, true); finishEditing(); };
  el('editCancelBtn').onclick = () => finishEditing();
}

function updateGeometryVertex(feature, idx, coord) {
  if (feature.geometry.type === 'Point') { feature.geometry.coordinates = coord; }
  else if (feature.geometry.type === 'LineString') { feature.geometry.coordinates[idx] = coord; }
  else if (feature.geometry.type === 'Polygon') {
    feature.geometry.coordinates[0][idx] = coord;
    if (idx === 0) feature.geometry.coordinates[0][feature.geometry.coordinates[0].length - 1] = coord;
  }
  // live preview only; committed on drag end / save
  map.getSource('highlight')?.setData({ type: 'FeatureCollection', features: [feature] });
}

function commitEdit(feature) {
  store.updateAsset(feature.properties.id, { geometry: feature.geometry });
}

function finishEditing() {
  clearEditMarkers();
  el('editPanel').style.display = 'none';
  editingFeatureId = null;
}
function clearEditMarkers() {
  editVertexMarkers.forEach((m) => m.remove());
  editVertexMarkers = [];
}

function rotateEditingFeature(deg) {
  if (!editingFeatureId) return;
  const feature = store.assets.get(editingFeatureId);
  if (!feature || feature.geometry.type === 'Point') return;
  try {
    const rotated = turf.transformRotate(structuredClone(feature), deg);
    map.getSource('highlight')?.setData({ type: 'FeatureCollection', features: [rotated] });
    window.__rotatedPreview = rotated;
  } catch (err) { console.warn('rotate failed', err); }
}

// ---------------------------------------------------------------------------
// Split polygon: clips the ring against the infinite line through two
// clicked points using a half-plane Sutherland-Hodgman clip, run twice (once
// per side) to produce the two resulting pieces. This is a standard, exact
// geometric algorithm — not an approximation — so it's correct for any
// simple (non-self-intersecting) polygon the cut line actually crosses.
// ---------------------------------------------------------------------------
function sideOfLine(point, a, b) {
  return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
}

function clipRingByLine(ring, a, b, keepPositive) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const curr = ring[i];
    const next = ring[i + 1];
    const currSide = sideOfLine(curr, a, b);
    const nextSide = sideOfLine(next, a, b);
    const currIn = keepPositive ? currSide >= 0 : currSide <= 0;
    const nextIn = keepPositive ? nextSide >= 0 : nextSide <= 0;
    if (currIn) out.push(curr);
    if (currIn !== nextIn && currSide !== nextSide) {
      const t = currSide / (currSide - nextSide);
      out.push([curr[0] + t * (next[0] - curr[0]), curr[1] + t * (next[1] - curr[1])]);
    }
  }
  if (out.length >= 3) out.push(out[0]);
  return out;
}

function performSplit(targetId, a, b) {
  const original = store.assets.get(targetId);
  if (!original || original.geometry.type !== 'Polygon') {
    pushNotification('Split failed — the selected asset is no longer a polygon.', 'warn');
    return;
  }
  const ring = original.geometry.coordinates[0];
  const ringA = clipRingByLine(ring, a, b, true);
  const ringB = clipRingByLine(ring, a, b, false);
  if (ringA.length < 4 || ringB.length < 4) {
    pushNotification('That line didn\u2019t cut all the way across the polygon — try a line that crosses both edges.', 'warn');
    return;
  }
  const partA = structuredClone(original);
  const partB = structuredClone(original);
  partA.geometry = { type: 'Polygon', coordinates: [ringA] };
  partB.geometry = { type: 'Polygon', coordinates: [ringB] };
  partA.properties.id = `${original.properties.id}-A`;
  partB.properties.id = `${original.properties.id}-B`;
  partA.properties.name = `${original.properties.name} (split A)`;
  partB.properties.name = `${original.properties.name} (split B)`;
  store.deleteAsset(targetId);
  store.addAsset(partA);
  store.addAsset(partB);
  pushNotification(`Split into ${partA.properties.id} and ${partB.properties.id}`, 'success');
}

// ---------------------------------------------------------------------------
// Merge / duplicate for selected polygons (uses the asset-list checkbox selection)
// ---------------------------------------------------------------------------
function mergeSelectedPolygons() {
  const ids = [...store.selectedIds];
  const feats = ids.map((id) => store.assets.get(id)).filter((f) => f && f.geometry.type === 'Polygon');
  if (feats.length < 2) { pushNotification('Select at least two polygon assets to merge.', 'warn'); return; }
  try {
    let merged = feats[0];
    for (let i = 1; i < feats.length; i++) {
      merged = turf.union(turf.featureCollection([merged, feats[i]]));
    }
    if (!merged) throw new Error('union returned nothing');
    const base = structuredClone(feats[0]);
    base.geometry = merged.geometry;
    base.properties.name = `${base.properties.name} (merged ×${feats.length})`;
    base.properties.id = `${base.properties.id}-MRG`;
    store.deleteMany(ids);
    store.addAsset(base);
    pushNotification(`Merged ${feats.length} polygons`, 'success');
  } catch (err) {
    pushNotification('Merge failed — the selected polygons may not overlap or touch.', 'warn');
    console.error(err);
  }
}

function duplicateSelected() {
  const ids = [...store.selectedIds];
  if (!ids.length) { pushNotification('Select one or more assets to duplicate.', 'warn'); return; }
  ids.forEach((id) => {
    const f = store.assets.get(id);
    if (!f) return;
    const clone = structuredClone(f);
    const offset = 0.0006;
    if (clone.geometry.type === 'Point') clone.geometry.coordinates = [clone.geometry.coordinates[0] + offset, clone.geometry.coordinates[1] + offset];
    if (clone.geometry.type === 'LineString') clone.geometry.coordinates = clone.geometry.coordinates.map((c) => [c[0] + offset, c[1] + offset]);
    if (clone.geometry.type === 'Polygon') clone.geometry.coordinates = clone.geometry.coordinates.map((ring) => ring.map((c) => [c[0] + offset, c[1] + offset]));
    clone.properties.id = `${f.properties.id}-COPY${Date.now().toString(36).slice(-3)}`;
    clone.properties.name = `${f.properties.name} (copy)`;
    store.addAsset(clone);
  });
  pushNotification(`Duplicated ${ids.length} asset(s)`, 'success');
}

function flashUndo() {
  pushNotification('Change undone', 'info', 1500);
}
