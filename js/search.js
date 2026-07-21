// ============================================================================
// GeoMap Studio — search.js
// Layers autosuggest + recent-search memory + "search nearby" on top of the
// plain input that sidebar-list.js already wires to store.setSearch().
// ============================================================================
import { store, fuzzyMatch } from './store.js';
import { CATEGORY_EMOJI } from './config.js';
import { highlightAssetById } from './overlap.js';
import { showAssetDetail } from './assets.js';
import { map } from './map.js';

const RECENTS_KEY = 'geomap.recentSearches';
let geocodeDebounceId = null;
let geocodeResults = [];

function el(id) { return document.getElementById(id); }
function getRecents() { try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch { return []; } }
function pushRecent(term) {
  if (!term) return;
  const list = [term, ...getRecents().filter((t) => t !== term)].slice(0, 6);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

export function initSearch() {
  const input = el('assetSearchInput');
  const dropdown = el('searchSuggestions');

  input.addEventListener('input', () => {
    renderSuggestions(input.value);
    scheduleGeocode(input.value);
  });
  input.addEventListener('focus', () => renderSuggestions(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { pushRecent(input.value.trim()); dropdown.classList.remove('open'); }
    if (e.key === 'Escape') dropdown.classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) dropdown.classList.remove('open');
  });

  el('searchNearMeBtn').addEventListener('click', searchNearMe);
}

// ---- Real place/location geocoding via OpenStreetMap's Nominatim, free and
// key-less. Debounced and low-volume (one interactive search at a time), in
// line with Nominatim's usage policy for light client use.
function scheduleGeocode(term) {
  clearTimeout(geocodeDebounceId);
  const q = term.trim();
  if (q.length < 3) { geocodeResults = []; return; }
  geocodeDebounceId = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('geocoding request failed');
      geocodeResults = await res.json();
    } catch {
      geocodeResults = [];
    }
    renderSuggestions(el('assetSearchInput').value);
  }, 450);
}

function renderSuggestions(term) {
  const dropdown = el('searchSuggestions');
  const q = term.trim().toLowerCase();
  dropdown.innerHTML = '';

  if (!q) {
    const recents = getRecents();
    if (!recents.length) { dropdown.classList.remove('open'); return; }
    dropdown.innerHTML = `<div class="suggest-heading">Recent searches</div>`;
    recents.forEach((r) => dropdown.appendChild(makeRow(r, null, () => setSearchTerm(r))));
    dropdown.classList.add('open');
    return;
  }

  const matches = [...store.assets.values()]
    .filter((f) => fuzzyMatch(q, `${f.properties.id} ${f.properties.name}`.toLowerCase()))
    .slice(0, 8);
  if (!matches.length && !geocodeResults.length) {
    dropdown.innerHTML = `<div class="suggest-empty">No assets or places match "${term}"</div>`;
  } else {
    if (matches.length) dropdown.innerHTML += `<div class="suggest-heading">Assets</div>`;
    matches.forEach((f) => dropdown.appendChild(makeRow(f.properties.name, f.properties, () => {
      setSearchTerm(f.properties.name);
      pushRecent(f.properties.name);
      highlightAssetById(f.properties.id);
      showAssetDetail(f.properties.id);
      dropdown.classList.remove('open');
    })));
    if (geocodeResults.length) {
      const heading = document.createElement('div');
      heading.className = 'suggest-heading';
      heading.textContent = 'Places';
      dropdown.appendChild(heading);
      geocodeResults.forEach((place) => {
        const row = document.createElement('div');
        row.className = 'suggest-row';
        row.innerHTML = `📍 <span>${place.display_name}</span>`;
        row.addEventListener('click', () => {
          const lng = parseFloat(place.lon), lat = parseFloat(place.lat);
          map.flyTo({ center: [lng, lat], zoom: 13, duration: 1000 });
          pushRecent(place.display_name);
          dropdown.classList.remove('open');
        });
        dropdown.appendChild(row);
      });
    }
  }
  dropdown.classList.add('open');
}

function makeRow(label, props, onClick) {
  const row = document.createElement('div');
  row.className = 'suggest-row';
  row.innerHTML = props ? `${CATEGORY_EMOJI[props.category] || '📍'} <span>${label}</span><span class="suggest-id">${props.id}</span>` : `🕓 <span>${label}</span>`;
  row.addEventListener('click', onClick);
  return row;
}

function setSearchTerm(term) {
  el('assetSearchInput').value = term;
  store.setSearch(term);
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180, lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function searchNearMe() {
  if (!navigator.geolocation) { alert('Geolocation is not available in this browser.'); return; }
  el('searchNearMeBtn').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el('searchNearMeBtn').textContent = '📍 Near me';
      const me = [pos.coords.longitude, pos.coords.latitude];
      map.flyTo({ center: me, zoom: 14 });
      const within = [...store.assets.values()].filter((f) => {
        const c = f.geometry.type === 'Point' ? f.geometry.coordinates : (f.geometry.type === 'LineString' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]);
        return haversineKm(me, c) <= 2;
      });
      store.setSelection(within.map((f) => f.properties.id));
      setSearchTerm('');
    },
    () => { el('searchNearMeBtn').textContent = '📍 Near me'; alert('Could not get your location. Falling back to the demo area (Goa) center.'); },
    { timeout: 6000 }
  );
}
