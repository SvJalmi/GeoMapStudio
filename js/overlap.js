// ============================================================================
// GeoMap Studio — overlap.js
// This is the answer to "if a point is on a line, clicking it should show
// both". Every click on the map:
//   1. Hit-tests a small pixel box (not just the exact pixel) across every
//      interactive layer — points, lines, polygon fill — so a point sitting
//      exactly on a line/polygon boundary is caught by both.
//   2. De-duplicates by asset id (a polygon can be hit via fill AND outline).
//   3. If more than one distinct asset is under the click, shows a single
//      combined popup listing every one of them (tabs), instead of only the
//      topmost layer winning silently.
//   4. If the click actually landed on a cluster bubble, either zooms in
//      (normal case) or — when the underlying points are geographically
//      stacked at the same coordinate and zooming won't separate them —
//      "spiderfies": fans them out into a ring with connector legs so each
//      one becomes individually clickable.
// ============================================================================
import { map, setHighlight, highlightIds, rebuildSources } from './map.js';
import { store } from './store.js';
import { CLICK_HIT_TOLERANCE, SPIDERFY_PIXEL_RADIUS, CATEGORY_SCHEMA, STATUS_SCHEMA, CATEGORY_EMOJI } from './config.js';
import { showAssetDetail, openAssetForm } from './assets.js';
import { interactionState } from './interaction.js';
import { pushNotification } from './notifications.js';

const HIT_LAYERS = ['unclustered-point', 'lines-layer', 'polygons-fill', 'polygons-outline', 'tracked-layer'];
let activePopup = null;
let spiderfied = false;
let hoverPopup = null;

export function initOverlapHandling() {
  hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'gm-popup gm-popup-hover', offset: 12 });
  const hoverLayers = ['unclustered-point', 'lines-layer', 'polygons-fill'];
  hoverLayers.forEach((layerId) => {
    map.on('mousemove', layerId, (e) => {
      if (interactionState.activeTool || !e.features.length) return;
      const p = e.features[0].properties;
      hoverPopup.setLngLat(e.lngLat)
        .setHTML(`<div class="hover-tip">${CATEGORY_EMOJI[p.category] || ''} <b>${p.name}</b><br/><span class="hover-tip-sub">${p.id} · ${p.status}</span></div>`)
        .addTo(map);
    });
    map.on('mouseleave', layerId, () => hoverPopup.remove());
  });

  map.on('click', (e) => {
    if (interactionState.activeTool) return; // draw/measure tools own this click right now
    const clusterHit = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    if (clusterHit.length) {
      handleClusterClick(clusterHit[0], e);
      return;
    }
    if (spiderfied) collapseSpiderfy();

    const bbox = [
      [e.point.x - CLICK_HIT_TOLERANCE, e.point.y - CLICK_HIT_TOLERANCE],
      [e.point.x + CLICK_HIT_TOLERANCE, e.point.y + CLICK_HIT_TOLERANCE],
    ];
    const hits = map.queryRenderedFeatures(bbox, { layers: HIT_LAYERS });
    const byId = new Map();
    hits.forEach((f) => {
      const id = f.properties.id;
      if (id && !byId.has(id)) byId.set(id, f);
    });

    if (!byId.size) {
      closePopup();
      setHighlight([]);
      return;
    }
    openCombinedPopup([...byId.values()], e.lngLat);
  });

  map.on('mouseenter', 'unclustered-point', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseenter', 'lines-layer', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseenter', 'polygons-fill', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
  ['unclustered-point', 'lines-layer', 'polygons-fill', 'clusters'].forEach((l) =>
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  );
}

function closePopup() {
  activePopup?.remove();
  activePopup = null;
}

// ---- combined popup for real overlaps (point-on-line, point-in-polygon, etc.) ---
function openCombinedPopup(features, lngLat) {
  closePopup();
  hoverPopup?.remove();
  setHighlight(features);

  const root = document.createElement('div');
  root.className = 'overlap-popup';

  if (features.length === 1) {
    root.appendChild(renderAssetCard(features[0]));
  } else {
    const header = document.createElement('div');
    header.className = 'overlap-popup-header';
    header.textContent = `${features.length} overlapping features here`;
    root.appendChild(header);

    const tabBar = document.createElement('div');
    tabBar.className = 'overlap-tabs';
    const body = document.createElement('div');
    body.className = 'overlap-body';

    features.forEach((f, i) => {
      const p = f.properties;
      const tab = document.createElement('button');
      tab.className = 'overlap-tab' + (i === 0 ? ' active' : '');
      tab.innerHTML = `${CATEGORY_EMOJI[p.category] || '📍'} <span>${CATEGORY_SCHEMA[p.category]?.label || p.category}</span>`;
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('.overlap-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        body.innerHTML = '';
        body.appendChild(renderAssetCard(f));
        setHighlight([f]);
      });
      tabBar.appendChild(tab);
    });
    root.appendChild(tabBar);
    body.appendChild(renderAssetCard(features[0]));
    root.appendChild(body);
  }

  activePopup = new maplibregl.Popup({ closeButton: true, maxWidth: '340px', className: 'gm-popup' })
    .setLngLat(lngLat)
    .setDOMContent(root)
    .addTo(map);
  activePopup.on('close', () => setHighlight([]));
}

function coordLabel(feature) {
  const g = feature.geometry;
  const c = g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0];
  return `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`;
}

// MapLibre stringifies array/object feature properties when they come back
// through queryRenderedFeatures (true even for plain GeoJSON sources, not
// just vector tiles) — so p.images might be the literal string "[]" here
// rather than a real array. Parse defensively rather than assume either shape.
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.startsWith('[')) {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function renderAssetCard(feature) {
  const p = feature.properties;
  const description = p.description ?? p.notes ?? '';
  const card = document.createElement('div');
  card.className = 'overlap-card';
  const thumb = asArray(p.images)[0];
  card.innerHTML = `
    ${thumb ? `<img class="overlap-card-photo" src="${thumb}"/>` : ''}
    <div class="overlap-card-title">${CATEGORY_EMOJI[p.category] || '📍'} ${p.name}</div>
    <div class="overlap-card-id">${p.id}</div>
    <div class="pill-row">
      <span class="pill" style="--c:${STATUS_SCHEMA[p.status]?.color}">${STATUS_SCHEMA[p.status]?.label}</span>
      <span class="pill" style="--c:${CATEGORY_SCHEMA[p.category]?.color}">${p.priority}</span>
    </div>
    <div class="overlap-card-meta">
      <div><b>Type</b> ${p.type || '—'}</div>
      <div><b>Category</b> ${CATEGORY_SCHEMA[p.category]?.label || p.category}</div>
      <div><b>Owner</b> ${p.owner}</div>
      <div><b>Coordinates</b> <span class="mono">${coordLabel(feature)}</span></div>
      <div><b>Updated</b> ${p.updatedDate}</div>
      <div><b>GPS ±</b> ${p.gpsAccuracy}m</div>
      ${description ? `<div class="overlap-card-desc">${description}</div>` : ''}
    </div>
    <div class="overlap-card-actions">
      <button class="btn btn-sm" data-act="edit">Edit</button>
      <button class="btn btn-sm" data-act="navigate">Navigate</button>
      <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>
    </div>
    <button class="btn btn-sm btn-primary overlap-card-details-btn" data-act="details">Open full details</button>
  `;
  card.querySelector('[data-act="details"]').addEventListener('click', () => showAssetDetail(p.id));
  card.querySelector('[data-act="edit"]').addEventListener('click', () => {
    closePopup();
    openAssetForm(store.assets.get(p.id) || feature);
  });
  card.querySelector('[data-act="navigate"]').addEventListener('click', () => {
    const c = feature.geometry.type === 'Point' ? feature.geometry.coordinates
      : feature.geometry.type === 'LineString' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${c[1]},${c[0]}`, '_blank');
  });
  card.querySelector('[data-act="delete"]').addEventListener('click', () => {
    if (confirm(`Delete "${p.name}" permanently?`)) {
      store.deleteAsset(p.id);
      rebuildSources();
      pushNotification(`Deleted ${p.id}`, 'warn');
      closePopup();
    }
  });
  return card;
}

// ---- cluster click: zoom in, or spiderfy if points are truly stacked ----
async function handleClusterClick(clusterFeature, e) {
  const source = map.getSource('points');
  const clusterId = clusterFeature.properties.cluster_id;
  const leaves = await source.getClusterLeaves(clusterId, clusterFeature.properties.point_count, 0);

  // Are the leaves within a tight pixel radius of each other at THIS zoom?
  const screenPts = leaves.map((l) => map.project(l.geometry.coordinates));
  const cx = screenPts.reduce((s, p) => s + p.x, 0) / screenPts.length;
  const cy = screenPts.reduce((s, p) => s + p.y, 0) / screenPts.length;
  const maxDist = Math.max(...screenPts.map((p) => Math.hypot(p.x - cx, p.y - cy)));

  if (maxDist < SPIDERFY_PIXEL_RADIUS && map.getZoom() >= map.getMaxZoom() - 4) {
    spiderfy(leaves, e.lngLat);
    return;
  }
  const zoom = await source.getClusterExpansionZoom(clusterId);
  map.easeTo({ center: clusterFeature.geometry.coordinates, zoom: Math.min(zoom, 20), duration: 500 });
}

function spiderfy(leaves, center) {
  collapseSpiderfy();
  spiderfied = true;
  const centerPx = map.project(center);
  const n = leaves.length;
  const radius = 34 + n * 4;
  const legFeatures = [];
  const ringFeatures = leaves.map((leaf, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const px = { x: centerPx.x + radius * Math.cos(angle), y: centerPx.y + radius * Math.sin(angle) };
    const lngLat = map.unproject([px.x, px.y]);
    legFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [center.toArray ? center.toArray() : [center.lng, center.lat], [lngLat.lng, lngLat.lat]] }, properties: {} });
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: leaf.properties };
  });

  map.getSource('spider-legs').setData({ type: 'FeatureCollection', features: legFeatures });

  // Render spiderfied leaves as temporary DOM markers so they stay clickable
  // and visually distinct from the underlying clustered source.
  window.__spiderMarkers = ringFeatures.map((f) => {
    const el = document.createElement('div');
    el.className = 'spider-marker';
    el.style.background = CATEGORY_SCHEMA[f.properties.category]?.color || '#ccc';
    el.textContent = CATEGORY_EMOJI[f.properties.category] || '';
    el.title = f.properties.name;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openCombinedPopup([f], { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    });
    return new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(map);
  });
}

function collapseSpiderfy() {
  spiderfied = false;
  map.getSource('spider-legs')?.setData({ type: 'FeatureCollection', features: [] });
  (window.__spiderMarkers || []).forEach((m) => m.remove());
  window.__spiderMarkers = [];
}

export function highlightAssetById(id) {
  const f = store.assets.get(id);
  if (!f) return;
  setHighlight([f]);
  if (f.geometry.type === 'Point') {
    map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15), duration: 600 });
  } else {
    const coords = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 120, duration: 600, maxZoom: 17 });
  }
}
