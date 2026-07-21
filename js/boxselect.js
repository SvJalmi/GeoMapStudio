// ============================================================================
// GeoMap Studio — boxselect.js
// Shift-drag a box on the map to multi-select every asset inside it, using
// MapLibre's boxZoomEnd callback the same way the official "Select features
// with a boxZoomEnd callback" example does — but selecting features into the
// asset list instead of just zooming.
// ============================================================================
import { map } from './map.js';
import { store } from './store.js';

export function initBoxSelect() {
  map.boxZoom.disable(); // we hijack the shift-drag gesture for selection instead of zoom
  let start = null;
  const box = document.createElement('div');
  box.className = 'box-select-rect';
  box.style.display = 'none';
  document.getElementById('map').appendChild(box);

  const canvas = map.getCanvasContainer();
  canvas.addEventListener('mousedown', (e) => {
    if (!e.shiftKey) return;
    start = mousePos(e);
    box.style.display = 'block';
    updateBox(start, start);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  function onMove(e) {
    if (!start) return;
    updateBox(start, mousePos(e));
  }
  function onUp(e) {
    if (!start) return;
    const end = mousePos(e);
    box.style.display = 'none';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const bbox = [[Math.min(start.x, end.x), Math.min(start.y, end.y)], [Math.max(start.x, end.x), Math.max(start.y, end.y)]];
    start = null;
    if (Math.abs(bbox[1][0] - bbox[0][0]) < 4 && Math.abs(bbox[1][1] - bbox[0][1]) < 4) return; // treat as a click, not a drag
    const hits = map.queryRenderedFeatures(bbox, { layers: ['unclustered-point', 'lines-layer', 'polygons-fill'] });
    const ids = [...new Set(hits.map((f) => f.properties.id).filter((id) => store.assets.has(id)))];
    if (ids.length) store.setSelection(ids);
  }

  function mousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function updateBox(a, b) {
    box.style.left = `${Math.min(a.x, b.x)}px`;
    box.style.top = `${Math.min(a.y, b.y)}px`;
    box.style.width = `${Math.abs(b.x - a.x)}px`;
    box.style.height = `${Math.abs(b.y - a.y)}px`;
  }
}
