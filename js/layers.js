// ============================================================================
// GeoMap Studio — layers.js
// Per-category visibility + opacity ("Layer Manager"). This is deliberately
// separate from store.filters: filters answer "which assets match my search
// criteria", the layer manager answers "which categories am I choosing to
// look at right now, and how prominent should each be". Reordering changes
// paint order by re-inserting layers before a moving target.
// ============================================================================
import { CATEGORY_SCHEMA } from './config.js';
import { rebuildSources, refreshOpacityPaint, map } from './map.js';

export const layerState = {
  visible: Object.fromEntries(Object.keys(CATEGORY_SCHEMA).map((c) => [c, true])),
  opacity: Object.fromEntries(Object.keys(CATEGORY_SCHEMA).map((c) => [c, 1])),
  order: Object.keys(CATEGORY_SCHEMA), // top-of-list draws last (on top) within its geometry group
};

export function initLayerPanel() {
  const list = document.getElementById('layerList');
  list.innerHTML = '';
  layerState.order.forEach((cat) => {
    const def = CATEGORY_SCHEMA[cat];
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.draggable = true;
    row.dataset.cat = cat;
    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="swatch" style="background:${def.color}"></span>
      <label class="layer-name">
        <input type="checkbox" data-role="vis" ${layerState.visible[cat] ? 'checked' : ''}/>
        ${def.label}
      </label>
      <input type="range" data-role="opacity" min="0" max="1" step="0.05" value="${layerState.opacity[cat]}" title="Opacity"/>
    `;
    list.appendChild(row);

    row.querySelector('[data-role="vis"]').addEventListener('change', (e) => {
      layerState.visible[cat] = e.target.checked;
      row.classList.toggle('layer-hidden', !e.target.checked);
      rebuildSources();
    });
    row.querySelector('[data-role="opacity"]').addEventListener('input', (e) => {
      layerState.opacity[cat] = parseFloat(e.target.value);
      refreshOpacityPaint();
    });
    if (!layerState.visible[cat]) row.classList.add('layer-hidden');
  });

  // Drag-to-reorder (visual only + persisted order; kept simple on purpose).
  let dragged = null;
  list.addEventListener('dragstart', (e) => { dragged = e.target.closest('.layer-row'); e.dataTransfer.effectAllowed = 'move'; });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.layer-row');
    if (!target || target === dragged) return;
    const rect = target.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    list.insertBefore(dragged, before ? target : target.nextSibling);
  });
  list.addEventListener('drop', () => {
    layerState.order = [...list.querySelectorAll('.layer-row')].map((r) => r.dataset.cat);
  });

  document.getElementById('layerShowAll').addEventListener('click', () => {
    Object.keys(layerState.visible).forEach((c) => (layerState.visible[c] = true));
    initLayerPanel();
    rebuildSources();
  });
  document.getElementById('layerHideAll').addEventListener('click', () => {
    Object.keys(layerState.visible).forEach((c) => (layerState.visible[c] = false));
    initLayerPanel();
    rebuildSources();
  });
}

export function toggleHeatmap(force) {
  const vis = map.getLayoutProperty('heat-layer', 'visibility');
  const next = force !== undefined ? force : vis !== 'visible';
  map.setLayoutProperty('heat-layer', 'visibility', next ? 'visible' : 'none');
  return next;
}
