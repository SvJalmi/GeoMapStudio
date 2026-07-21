// ============================================================================
// GeoMap Studio — app.js
// Bootstraps everything in dependency order: map first (everyone needs it),
// then store data, then every panel/tool module, most of which just need
// the map + store to already exist.
// ============================================================================
import { initMap, rebuildSources, toggleImmersive3D } from './map.js';
import { store } from './store.js';
import { buildDemoDataset } from './seed.js';
import { initOverlapHandling } from './overlap.js';
import { initAssetModal } from './assets.js';
import { initAssetList } from './sidebar-list.js';
import { initFilterPanel } from './filters.js';
import { initSearch } from './search.js';
import { initLayerPanel } from './layers.js';
import { initDrawTools } from './draw.js';
import { initMeasureTool } from './measure.js';
import { initNotifications, pushNotification } from './notifications.js';
import { initIO } from './io.js';
import { initAIPanel } from './ai.js';
import { initGeofence } from './geofence.js';
import { initRouting } from './routing.js';
import { initTimeline } from './timeline.js';
import { initTracking } from './tracking.js';
import { initSettings } from './settings.js';
import { initHashRouter } from './hashrouter.js';
import { initAnalytics } from './analytics.js';
import { initGeoStatus } from './geo-status.js';
import { initBoxSelect } from './boxselect.js';
import { initDayNight } from './day-night.js';
import { initOfflinePMTiles } from './offline-pmtiles.js';
import { initCameraTour } from './camera-tour.js';

function el(id) { return document.getElementById(id); }

initMap(() => {
  try {
    store.loadCollection(buildDemoDataset());

    initOverlapHandling();
    initAssetModal();
    initAssetList();
    initFilterPanel();
    initSearch();
    initLayerPanel();
    initDrawTools();
    initMeasureTool();
    initNotifications();
    initIO();
    initAIPanel();
    initGeofence();
    initRouting();
    initTimeline();
    initTracking();
    initSettings();
    initHashRouter();
    initAnalytics();
    initGeoStatus();
    initBoxSelect();
    initDayNight();
    initOfflinePMTiles();
    initCameraTour();

    rebuildSources();
    wireGlobalButtons();
    pushNotification('GeoMap Studio loaded with demo data for Goa, India', 'success', 3000);
    document.getElementById('loadingScreen')?.remove();
  } catch (err) {
    console.error('GeoMap Studio failed during panel setup:', err);
    const loading = document.getElementById('loadingScreen');
    if (loading) {
      loading.innerHTML = `
        <div class="loading-mark">GeoMap Studio</div>
        <div class="loading-sub" style="color:#f5586b;max-width:480px;text-align:center;line-height:1.5">
          Something went wrong while starting up:<br/>${err.message}
          <br/><br/>Open the browser console for details, or refresh the page.
        </div>`;
    }
  }
});

function wireGlobalButtons() {
  el('addAssetBtn').addEventListener('click', () => {
    document.querySelector('.draw-tool-btn[data-mode="point"]')?.click();
  });
  el('sidebarToggleBtn').addEventListener('click', () => document.body.classList.toggle('sidebar-collapsed'));

  el('view3DBtn').addEventListener('click', () => {
    const on = toggleImmersive3D();
    el('view3DBtn').textContent = on ? '2D View' : '3D View';
    el('view3DBtn').classList.toggle('active', on);
    // Keep the granular Settings checkboxes (3D buildings / Terrain) truthful
    // for anyone who opens that panel after using this single switch.
    const buildingsBox = document.getElementById('toggle3DBuildings');
    const terrainBox = document.getElementById('toggleTerrain');
    if (buildingsBox) buildingsBox.checked = on;
    if (terrainBox) terrainBox.checked = on;
  });

  // Tools popover (Measure/Geofence/Route/Tracking) — a plain show/hide,
  // closed by an outside click just like the other flyouts.
  el('toolsMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    el('toolsPopover').classList.toggle('open');
    el('toolsMenuBtn').classList.toggle('active', el('toolsPopover').classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!el('toolsPopover').contains(e.target) && e.target !== el('toolsMenuBtn') && !el('mapWrap').contains(e.target)) {
      el('toolsPopover').classList.remove('open');
      el('toolsMenuBtn').classList.remove('active');
    }
  });

  // Keep the activity rail's active highlight in sync with each panel's
  // 'open' class, without every panel module needing to know about the rail.
  const RAIL_MAP = [
    ['timelineToggleBtn', 'timelinePanel'],
    ['filterToggleBtn', 'filterPanel'],
    ['aiToggleBtn', 'aiPanel'],
    ['analyticsToggleBtn', 'analyticsPanel'],
    ['settingsToggleBtn', 'settingsPanel'],
    ['notifBell', 'notifPanel'],
  ];
  document.addEventListener('click', () => {
    requestAnimationFrame(() => {
      RAIL_MAP.forEach(([btnId, panelId]) => {
        el(btnId)?.classList.toggle('active', el(panelId)?.classList.contains('open'));
      });
    });
  });

  store.addEventListener('assets:changed', rebuildSources);
  store.addEventListener('filters:changed', rebuildSources);
}
