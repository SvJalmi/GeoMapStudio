// ============================================================================
// GeoMap Studio — settings.js
// Basemap gallery, unified 2D/3D/Globe view mode, the full Overlays list
// (terrain, buildings, clustering on/off, heatmap, cluster-by-type, pipeline
// flow, day/night, live tracking, WMS, URL hash routing), and native
// MapLibre interaction settings.
// ============================================================================
import { BASEMAPS } from './config.js';
import {
  setBasemap, toggle3DBuildings, toggleGlobe, toggleTerrain, togglePipelineFlow,
  setRestrictPanning, setRotationLocked, setRenderWorldCopies, setCooperativeGestures,
  toggleClusterByCategory,
  toggleClustering, toggleWMSLayer, isGlobeActive, toggleMultidirectionalHillshade,
  setInteractive, toggleZoneHatchPattern,
} from './map.js';
import { toggleHeatmap } from './layers.js';
import { setHashRoutingEnabled } from './hashrouter.js';

function el(id) { return document.getElementById(id); }

export function initSettings() {
  el('settingsToggleBtn').addEventListener('click', () => el('settingsPanel').classList.toggle('open'));
  el('settingsCloseBtn').addEventListener('click', () => el('settingsPanel').classList.remove('open'));

  initBasemapGallery();
  initViewMode();

  bindToggle('toggle3DBuildings', (on) => { toggle3DBuildings(on); syncViewModeButtons(); });
  bindToggle('toggleTerrain', (on) => { toggleTerrain(on); syncViewModeButtons(); });
  bindToggle('toggleClusteringSetting', (on) => toggleClustering(on), true);
  bindToggle('toggleHeatmapSetting', (on) => toggleHeatmap(on));
  bindToggle('toggleClusterByCategory', (on) => toggleClusterByCategory(on));
  bindToggle('togglePipelineFlowSetting', (on) => togglePipelineFlow(on));
  bindToggle('toggleTrackingSetting', (on) => el('trackingToggleBtn')?.click());
  bindToggle('toggleHashRouting', (on) => setHashRoutingEnabled(on), true);
  bindToggle('toggleMultidirectionalHillshade', (on) => toggleMultidirectionalHillshade(on));
  bindToggle('toggleZoneHatch', (on) => toggleZoneHatchPattern(on));
  bindToggle('togglePresentationMode', (on) => setInteractive(!on));
  bindToggle('toggleRestrictPanning', (on) => setRestrictPanning(on));
  bindToggle('toggleRotationLock', (on) => setRotationLocked(on));
  bindToggle('toggleWorldCopies', (on) => setRenderWorldCopies(on), true);
  bindToggle('toggleCooperativeGestures', (on) => setCooperativeGestures(on));

  el('toggleWMS').addEventListener('change', (e) => {
    el('wmsFields').style.display = e.target.checked ? '' : 'none';
    if (e.target.checked) {
      toggleWMSLayer(true, { url: el('wmsUrlInput').value.trim(), layerName: el('wmsLayerInput').value.trim() });
    } else {
      toggleWMSLayer(false);
    }
  });
  ['wmsUrlInput', 'wmsLayerInput'].forEach((id) => {
    el(id).addEventListener('change', () => {
      if (el('toggleWMS').checked) toggleWMSLayer(true, { url: el('wmsUrlInput').value.trim(), layerName: el('wmsLayerInput').value.trim() });
    });
  });

  el('themeSelect').addEventListener('change', (e) => {
    document.documentElement.dataset.theme = e.target.value;
  });
  el('unitsSelect').addEventListener('change', (e) => {
    document.documentElement.dataset.units = e.target.value; // read by measure.js-adjacent formatting if extended later
  });

  syncViewModeButtons();
}

function initBasemapGallery() {
  const gallery = el('basemapGallery');
  gallery.innerHTML = Object.entries(BASEMAPS).map(([key, def]) => `
    <button class="basemap-card" data-key="${key}" title="${def.label}">
      <span class="basemap-thumb" style="background:${def.thumb}"></span>
      <span class="basemap-name">${def.label}</span>
    </button>`).join('');
  gallery.querySelectorAll('.basemap-card').forEach((card) => {
    card.addEventListener('click', () => {
      setBasemap(card.dataset.key);
      gallery.querySelectorAll('.basemap-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
  });
  gallery.querySelector('[data-key="dark"]')?.classList.add('active');
}

function initViewMode() {
  el('viewMode2D').addEventListener('click', () => { toggle3DBuildings(false); toggleTerrain(false); toggleGlobe(false); syncViewModeButtons(); });
  el('viewMode3D').addEventListener('click', () => { toggleGlobe(false); toggle3DBuildings(true); toggleTerrain(true); syncViewModeButtons(); });
  el('viewModeGlobe').addEventListener('click', () => { toggle3DBuildings(false); toggleTerrain(false); toggleGlobe(true); syncViewModeButtons(); });
}
function syncViewModeButtons() {
  const buildingsOn = el('toggle3DBuildings')?.checked;
  const terrainOn = el('toggleTerrain')?.checked;
  ['viewMode2D', 'viewMode3D', 'viewModeGlobe'].forEach((id) => el(id).classList.remove('active'));
  if (isGlobeActive()) el('viewModeGlobe').classList.add('active');
  else if (buildingsOn || terrainOn) el('viewMode3D').classList.add('active');
  else el('viewMode2D').classList.add('active');
}

function bindToggle(id, handler, defaultOn = false) {
  const input = el(id);
  if (!input) return;
  input.checked = defaultOn;
  if (defaultOn) handler(true);
  input.addEventListener('change', () => handler(input.checked));
}
