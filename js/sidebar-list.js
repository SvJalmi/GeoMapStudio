// ============================================================================
// GeoMap Studio — sidebar-list.js
// The Asset List panel. Two independent multi-select mechanisms live here:
//   (1) category CHIPS at the top — toggling "Water Tank" + "Pipeline" narrows
//       both the list AND the map to just those types (store.filters.categories).
//   (2) row CHECKBOXES — for picking specific assets to bulk zoom/export/delete,
//       independent of which categories are currently shown.
// ============================================================================
import { store } from './store.js';
import { CATEGORY_SCHEMA, CATEGORY_EMOJI, STATUS_SCHEMA, PRIORITY_SCHEMA } from './config.js';
import { highlightAssetById } from './overlap.js';
import { showAssetDetail } from './assets.js';
import { exportSelection } from './io.js';
import { pushNotification } from './notifications.js';
import { map } from './map.js';

function el(id) { return document.getElementById(id); }

export function initAssetList() {
  renderCategoryChips();
  renderList();
  el('assetSearchInput').addEventListener('input', (e) => store.setSearch(e.target.value));
  el('chipsClearBtn').addEventListener('click', () => { store.filters.categories.clear(); store.emit('filters:changed'); });

  el('bulkZoom').addEventListener('click', () => zoomToSelection());
  el('bulkExport').addEventListener('click', () => exportSelection([...store.selectedIds]));
  el('bulkDelete').addEventListener('click', () => {
    if (!store.selectedIds.size) return;
    if (confirm(`Delete ${store.selectedIds.size} selected asset(s)?`)) {
      const ids = [...store.selectedIds];
      store.deleteMany(ids);
      pushNotification(`Deleted ${ids.length} assets`, 'warn');
    }
  });
  el('bulkClear').addEventListener('click', () => store.clearSelection());

  store.addEventListener('assets:changed', renderList);
  store.addEventListener('filters:changed', () => { renderCategoryChips(); renderList(); });
  store.addEventListener('selection:changed', renderList);
}

function renderCategoryChips() {
  const wrap = el('categoryChips');
  wrap.innerHTML = '';
  Object.entries(CATEGORY_SCHEMA).forEach(([cat, def]) => {
    const active = store.filters.categories.has(cat);
    const chip = document.createElement('button');
    chip.className = 'chip' + (active ? ' chip-active' : '');
    chip.style.setProperty('--chip-color', def.color);
    chip.innerHTML = `${CATEGORY_EMOJI[cat]} ${def.label}`;
    chip.addEventListener('click', () => store.toggleFilter('categories', cat));
    wrap.appendChild(chip);
  });
  el('chipsClearBtn').style.display = store.filters.categories.size ? '' : 'none';
}

function renderList() {
  const listEl = el('assetListBody');
  const assets = store.getVisibleAssets().sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  el('assetCountLabel').textContent = `${assets.length} of ${store.assets.size} assets`;

  listEl.innerHTML = '';
  if (!assets.length) {
    listEl.innerHTML = `<div class="empty-state">No assets match the current filters.<br/>Try clearing a category chip or the search box.</div>`;
  }
  assets.forEach((f) => {
    const p = f.properties;
    const row = document.createElement('div');
    row.className = 'asset-row' + (store.selectedIds.has(p.id) ? ' asset-row-selected' : '');
    row.innerHTML = `
      <input type="checkbox" class="asset-row-check" ${store.selectedIds.has(p.id) ? 'checked' : ''}/>
      <span class="asset-row-icon" style="background:${CATEGORY_SCHEMA[p.category]?.color}">${CATEGORY_EMOJI[p.category] || ''}</span>
      <span class="asset-row-main">
        <span class="asset-row-name">${p.name}</span>
        <span class="asset-row-sub">${p.id} · ${p.owner}</span>
      </span>
      <span class="status-dot" style="background:${STATUS_SCHEMA[p.status]?.color}" title="${STATUS_SCHEMA[p.status]?.label}"></span>
    `;
    row.querySelector('.asset-row-check').addEventListener('change', (e) => {
      e.stopPropagation();
      store.toggleSelected(p.id);
    });
    row.addEventListener('click', () => {
      highlightAssetById(p.id);
      showAssetDetail(p.id);
    });
    listEl.appendChild(row);
  });

  const bulkBar = el('bulkActionsBar');
  bulkBar.classList.toggle('visible', store.selectedIds.size > 0);
  el('bulkCount').textContent = `${store.selectedIds.size} selected`;
}

function zoomToSelection() {
  const feats = [...store.selectedIds].map((id) => store.assets.get(id)).filter(Boolean);
  if (!feats.length) return;
  let bounds = null;
  feats.forEach((f) => {
    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates]
      : f.geometry.type === 'LineString' ? f.geometry.coordinates
      : f.geometry.coordinates[0];
    coords.forEach((c) => {
      if (!bounds) bounds = new maplibregl.LngLatBounds(c, c);
      else bounds.extend(c);
    });
  });
  if (bounds) map.fitBounds(bounds, { padding: 100, duration: 600, maxZoom: 17 });
}
