// ============================================================================
// GeoMap Studio — camera-tour.js
// "Tour Goa Assets" — a scripted flythrough visiting a spread of demo assets
// in sequence using chained flyTo calls, with a flag marker + info popup at
// each stop so it's clear what's being shown, not just the camera moving.
// "Orbit Selected" — continuously rotates the camera bearing around the
// currently-selected asset's coordinates while holding the center fixed.
// ============================================================================
import { map } from './map.js';
import { store } from './store.js';
import { CATEGORY_SCHEMA, STATUS_SCHEMA, CATEGORY_EMOJI } from './config.js';

let touring = false;
let tourTimeoutId = null;
let orbiting = false;
let orbitIntervalId = null;
let tourMarker = null;
let tourPopup = null;

function el(id) { return document.getElementById(id); }

export function initCameraTour() {
  populateTourCategorySelect();
  el('tourAssetsBtn')?.addEventListener('click', toggleTour);
  el('orbitSelectedBtn')?.addEventListener('click', toggleOrbit);
}

function populateTourCategorySelect() {
  const select = el('tourCategorySelect');
  if (!select) return;
  select.innerHTML = `<option value="">All asset types</option>` +
    Object.entries(CATEGORY_SCHEMA).map(([key, def]) => `<option value="${key}">${CATEGORY_EMOJI[key] || ''} ${def.label}</option>`).join('');
}

function pickTourStops(count = 6) {
  const selectedCategory = el('tourCategorySelect')?.value || '';
  const pool = [...store.assets.values()].filter((f) => !selectedCategory || f.properties.category === selectedCategory);
  if (!pool.length) return [];
  // Spread picks across the list rather than the first N, so the tour
  // covers different parts of the dataset instead of one cluster.
  const step = Math.max(1, Math.floor(pool.length / count));
  const stops = [];
  for (let i = 0; i < pool.length && stops.length < count; i += step) stops.push(pool[i]);
  return stops;
}

function centroidOf(f) {
  const g = f.geometry;
  return g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0];
}

// A small flag pin (DOM marker) planted at whichever stop the tour is
// currently visiting — separate from the info popup, so there's a clear
// persistent "you are here" marker even if the popup gets dismissed.
function plantFlag(coords, stopNumber, total) {
  removeFlag();
  const el = document.createElement('div');
  el.className = 'tour-flag';
  el.innerHTML = `<span class="tour-flag-pole"></span><span class="tour-flag-banner">${stopNumber}/${total}</span>`;
  tourMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords).addTo(map);
}
function removeFlag() {
  tourMarker?.remove();
  tourMarker = null;
}

function showStopPopup(feature, coords) {
  closeStopPopup();
  const p = feature.properties;
  const root = document.createElement('div');
  root.className = 'tour-popup-card';
  root.innerHTML = `
    <div class="tour-popup-title">${CATEGORY_EMOJI[p.category] || '📍'} ${p.name}</div>
    <div class="tour-popup-id">${p.id}</div>
    <div class="pill-row">
      <span class="pill" style="--c:${STATUS_SCHEMA[p.status]?.color}">${STATUS_SCHEMA[p.status]?.label || p.status}</span>
      <span class="pill" style="--c:${CATEGORY_SCHEMA[p.category]?.color}">${p.priority}</span>
    </div>
    <div class="tour-popup-meta">${CATEGORY_SCHEMA[p.category]?.label || p.category} · ${p.owner || '—'}</div>
  `;
  tourPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 28, className: 'gm-popup tour-popup' })
    .setLngLat(coords)
    .setDOMContent(root)
    .addTo(map);
}
function closeStopPopup() {
  tourPopup?.remove();
  tourPopup = null;
}

function toggleTour() {
  if (touring) { stopTour(); return; }
  const stops = pickTourStops();
  if (!stops.length) {
    import('./notifications.js').then(({ pushNotification }) =>
      pushNotification('No assets of that type to tour — try "All asset types" or pick a different one.', 'warn'));
    return;
  }
  touring = true;
  stopOrbit();
  el('tourAssetsBtn').textContent = '⏸ Pause tour';
  el('tourAssetsBtn').classList.add('active');

  let i = 0;
  const visitNext = () => {
    if (!touring) return;
    if (i >= stops.length) { stopTour(); return; }
    const f = stops[i];
    const coords = centroidOf(f);
    map.flyTo({
      center: coords, zoom: 16, pitch: 55, bearing: (i * 47) % 360,
      duration: 2600, essential: true,
    });
    plantFlag(coords, i + 1, stops.length);
    showStopPopup(f, coords);
    i++;
    tourTimeoutId = setTimeout(visitNext, 3200);
  };
  visitNext();
}

function stopTour() {
  touring = false;
  clearTimeout(tourTimeoutId);
  tourTimeoutId = null;
  removeFlag();
  closeStopPopup();
  if (el('tourAssetsBtn')) {
    el('tourAssetsBtn').textContent = '▶ Tour Goa Assets';
    el('tourAssetsBtn').classList.remove('active');
  }
}

function toggleOrbit() {
  if (orbiting) { stopOrbit(); return; }
  const id = store.selectedId ?? [...store.assets.keys()][0];
  const f = id && store.assets.get(id);
  if (!f) { return; }
  orbiting = true;
  stopTour();
  el('orbitSelectedBtn').textContent = '⏸ Stop orbit';
  el('orbitSelectedBtn').classList.add('active');
  const center = centroidOf(f);
  map.easeTo({ center, zoom: Math.max(map.getZoom(), 16), pitch: 55, duration: 800 });
  let bearing = map.getBearing();
  orbitIntervalId = setInterval(() => {
    bearing = (bearing + 1.2) % 360;
    map.jumpTo({ center, bearing });
  }, 40);
}

function stopOrbit() {
  orbiting = false;
  clearInterval(orbitIntervalId);
  orbitIntervalId = null;
  if (el('orbitSelectedBtn')) {
    el('orbitSelectedBtn').textContent = '🔄 Orbit Selected';
    el('orbitSelectedBtn').classList.remove('active');
  }
}
