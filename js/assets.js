// ============================================================================
// GeoMap Studio — assets.js
// The create/edit form modal and the read-only detail drawer. Both work off
// the same store.assets Map so every other panel (list, popups, AI insights)
// stays in sync automatically via the 'assets:changed' event.
// ============================================================================
import { store } from './store.js';
import { CATEGORY_SCHEMA, STATUS_SCHEMA, PRIORITY_SCHEMA, OWNERS, CATEGORY_EMOJI, ASSET_TYPES, CITIES } from './config.js';
import { highlightAssetById } from './overlap.js';
import { pushNotification } from './notifications.js';

let editingId = null;
let pendingGeometry = null;

function el(id) { return document.getElementById(id); }

export function initAssetModal() {
  el('assetForm').addEventListener('submit', onSubmit);
  el('assetModalClose').addEventListener('click', closeAssetModal);
  el('assetDeleteBtn').addEventListener('click', () => {
    if (editingId && confirm('Delete this asset permanently?')) {
      store.deleteAsset(editingId);
      pushNotification(`Deleted ${editingId}`, 'warn');
      closeAssetModal();
    }
  });
  el('assetCategory').addEventListener('change', populateCategoryOptions);
  el('assetImages').addEventListener('change', async () => {
    const files = [...el('assetImages').files].slice(0, 4 - el('assetImagesPreview').children.length);
    (await readFilesAsDataUrls(files)).forEach((src) => addImagePreview(src));
    el('assetImages').value = '';
  });
  el('assetDocuments').addEventListener('change', async () => {
    const files = [...el('assetDocuments').files];
    const docs = await Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: (await readFilesAsDataUrls([f]))[0] })));
    docs.forEach((d) => addDocumentRow(d));
    el('assetDocuments').value = '';
  });
  populateStaticSelects();

  el('detailClose').addEventListener('click', () => el('detailDrawer').classList.remove('open'));
  el('detailEditBtn').addEventListener('click', () => {
    const id = el('detailDrawer').dataset.id;
    if (id) openAssetForm(store.assets.get(id));
  });
  el('detailDeleteBtn').addEventListener('click', () => {
    const id = el('detailDrawer').dataset.id;
    if (id && confirm('Delete this asset permanently?')) {
      store.deleteAsset(id);
      pushNotification(`Deleted ${id}`, 'warn');
      el('detailDrawer').classList.remove('open');
    }
  });
}

function populateStaticSelects() {
  el('assetType').innerHTML = ASSET_TYPES.map((t) => `<option>${t}</option>`).join('');
  el('assetOwner').innerHTML = OWNERS.map((o) => `<option>${o}</option>`).join('');
  el('assetCity').innerHTML = CITIES.map((c) => `<option>${c}</option>`).join('');
  el('assetStatus').innerHTML = Object.entries(STATUS_SCHEMA).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  el('assetPriority').innerHTML = Object.entries(PRIORITY_SCHEMA).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
}

function populateCategoryOptions() {
  // category select is locked while editing an existing asset's geometry type,
  // but on create, offer only categories matching the drawn geometry type.
  const geomType = pendingGeometry?.type;
  const opts = Object.entries(CATEGORY_SCHEMA).filter(([, v]) => !geomType || toGeomName(geomType) === v.geom);
  el('assetCategory').innerHTML = opts.map(([k, v]) => `<option value="${k}">${CATEGORY_EMOJI[k]} ${v.label}</option>`).join('');
}
function toGeomName(t) { return t; }

export function openAssetForm(feature = null, geometry = null) {
  editingId = feature ? feature.properties.id : null;
  pendingGeometry = geometry || feature?.geometry || null;
  populateCategoryOptions();

  el('assetModalTitle').textContent = feature ? `Edit ${feature.properties.id}` : 'New Asset';
  el('assetDeleteBtn').style.display = feature ? '' : 'none';
  const p = feature?.properties || {};
  el('assetName').value = p.name || '';
  el('assetType').value = p.type || ASSET_TYPES[0];
  el('assetCategory').value = p.category || el('assetCategory').options[0]?.value || '';
  el('assetOwner').value = p.owner || OWNERS[0];
  el('assetCity').value = p.city || CITIES[0];
  el('assetStatus').value = p.status || 'active';
  el('assetPriority').value = p.priority || 'medium';
  el('assetGps').value = p.gpsAccuracy || 3;
  el('assetDescription').value = p.description ?? p.notes ?? '';

  el('assetImagesPreview').innerHTML = '';
  (p.images || []).forEach((src) => addImagePreview(src));
  el('assetImages').value = '';

  el('assetDocumentsList').innerHTML = '';
  (p.documents || []).forEach((doc) => addDocumentRow(doc));
  el('assetDocuments').value = '';

  el('assetModal').classList.add('open');
}

function addImagePreview(src) {
  const wrap = document.createElement('div');
  wrap.className = 'asset-img-wrap';
  wrap.innerHTML = `<img src="${src}" class="asset-img-thumb"/><button type="button" class="asset-img-remove" title="Remove photo">×</button>`;
  wrap.querySelector('.asset-img-remove').addEventListener('click', () => wrap.remove());
  el('assetImagesPreview').appendChild(wrap);
}

function addDocumentRow(doc) {
  const row = document.createElement('div');
  row.className = 'asset-doc-row';
  row.dataset.name = doc.name;
  row.dataset.url = doc.dataUrl;
  row.innerHTML = `<span class="asset-doc-name">📄 ${doc.name}</span><button type="button" class="link-btn link-danger" title="Remove document">Remove</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  el('assetDocumentsList').appendChild(row);
}

function closeAssetModal() {
  el('assetModal').classList.remove('open');
  editingId = null;
  pendingGeometry = null;
}

function readFilesAsDataUrls(files) {
  return Promise.all(files.map((f) => new Promise((res) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.readAsDataURL(f);
  })));
}

async function onSubmit(e) {
  e.preventDefault();
  const images = [...el('assetImagesPreview').querySelectorAll('img')].map((i) => i.src).slice(0, 4);
  const documents = [...el('assetDocumentsList').querySelectorAll('.asset-doc-row')].map((row) => ({ name: row.dataset.name, dataUrl: row.dataset.url }));

  const props = {
    name: el('assetName').value.trim() || 'Untitled asset',
    type: el('assetType').value,
    category: el('assetCategory').value,
    owner: el('assetOwner').value,
    city: el('assetCity').value,
    status: el('assetStatus').value,
    priority: el('assetPriority').value,
    gpsAccuracy: parseFloat(el('assetGps').value) || 3,
    description: el('assetDescription').value,
    images,
    documents,
  };

  if (editingId) {
    store.updateAsset(editingId, { properties: props });
    pushNotification(`Updated ${editingId}`, 'info');
  } else {
    if (!pendingGeometry) { alert('Draw the asset location on the map first (use the drawing toolbar).'); return; }
    const id = `${props.category.slice(0, 3).toUpperCase()}-${String(store.assets.size + 1).padStart(4, '0')}-${Date.now().toString(36).slice(-3)}`;
    const feature = {
      type: 'Feature',
      geometry: pendingGeometry,
      properties: { id, createdDate: new Date().toISOString().slice(0, 10), updatedDate: new Date().toISOString().slice(0, 10), ...props },
    };
    store.addAsset(feature);
    pushNotification(`Created ${id}`, 'success');
  }
  closeAssetModal();
}

function coordLabel(feature) {
  const g = feature.geometry;
  const c = g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0];
  return `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`;
}

export function showAssetDetail(id) {
  const f = store.assets.get(id);
  if (!f) return;
  const p = f.properties;
  const description = p.description ?? p.notes ?? '';
  const drawer = el('detailDrawer');
  drawer.dataset.id = id;
  el('detailTitle').textContent = `${CATEGORY_EMOJI[p.category] || ''} ${p.name}`;
  el('detailBody').innerHTML = `
    <div class="detail-id">${p.id}</div>
    <div class="pill-row">
      <span class="pill" style="--c:${STATUS_SCHEMA[p.status]?.color}">${STATUS_SCHEMA[p.status]?.label}</span>
      <span class="pill" style="--c:${PRIORITY_SCHEMA[p.priority]?.color}">${PRIORITY_SCHEMA[p.priority]?.label} priority</span>
    </div>
    <table class="detail-table">
      <tr><th>Type</th><td>${p.type || '—'}</td></tr>
      <tr><th>Category</th><td>${CATEGORY_SCHEMA[p.category]?.label}</td></tr>
      <tr><th>Owner</th><td>${p.owner}</td></tr>
      <tr><th>City</th><td>${p.city || '—'}</td></tr>
      <tr><th>Coordinates</th><td class="mono">${coordLabel(f)}</td></tr>
      <tr><th>Created</th><td>${p.createdDate}</td></tr>
      <tr><th>Last updated</th><td>${p.updatedDate}</td></tr>
      <tr><th>GPS accuracy</th><td>±${p.gpsAccuracy} m</td></tr>
    </table>
    ${description ? `<div class="detail-notes">${description}</div>` : ''}
    ${(p.images || []).length ? `<div class="detail-gallery">${p.images.map((s) => `<img src="${s}"/>`).join('')}</div>` : ''}
    ${(p.documents || []).length ? `<div class="detail-documents">${p.documents.map((d) => `<a href="${d.dataUrl}" download="${d.name}">📄 ${d.name}</a>`).join('')}</div>` : ''}
    <div class="detail-actions-row">
      <button class="btn btn-sm" id="detailStreetView">Open in Street View ↗</button>
    </div>
  `;
  const coord = f.geometry.type === 'Point' ? f.geometry.coordinates : (f.geometry.type === 'LineString' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]);
  const svBtn = document.getElementById('detailStreetView');
  svBtn?.addEventListener('click', () => window.open(`https://www.google.com/maps?q&layer=c&cbll=${coord[1]},${coord[0]}`, '_blank'));

  drawer.classList.add('open');
  highlightAssetById(id);
}
