// ============================================================================
// GeoMap Studio — map.js
// Owns the MapLibre instance and every source/layer derived from the asset
// store. Nothing here decides *what* is visible — layers.js and store.js
// decide that; this module just renders whatever "effective dataset" it is
// handed via rebuildSources().
// ============================================================================
import { CATEGORY_SCHEMA, STATUS_SCHEMA, BASEMAPS, DEFAULT_VIEW, REGION_BOUNDS, TERRAIN_DEM } from './config.js';
import { store } from './store.js';
import { layerState } from './layers.js';

export let map;
export let geolocateControl;
export const highlightIds = new Set();

function categoriesOfGeom(geom) {
  return Object.entries(CATEGORY_SCHEMA).filter(([, v]) => v.geom === geom).map(([k]) => k);
}
const POINT_CATS = categoriesOfGeom('Point');
const LINE_CATS = categoriesOfGeom('LineString');
const POLY_CATS = categoriesOfGeom('Polygon');

function matchExpr(field, schema, fallback) {
  const expr = ['match', ['get', field]];
  Object.entries(schema).forEach(([k, v]) => { expr.push(k, v.color); });
  expr.push(fallback);
  return expr;
}
function opacityExpr() {
  const expr = ['match', ['get', 'category']];
  Object.keys(CATEGORY_SCHEMA).forEach((cat) => { expr.push(cat, layerState.opacity[cat] ?? 1); });
  expr.push(1);
  return expr;
}

// ---- cluster-by-type support -------------------------------------------
// clusterProperties sums, per fixed category key, how many points of that
// category fall inside each cluster (computed once by MapLibre at cluster-
// build time). The color expression then picks whichever category has the
// highest sum — a real "cluster by asset type" mode, not just decoration.
function clusterProperties() {
  const props = {};
  Object.keys(CATEGORY_SCHEMA).forEach((cat) => {
    props[`n_${cat}`] = ['+', ['case', ['==', ['get', 'category'], cat], 1, 0]];
  });
  return props;
}
let clusterByCategory = false;
function clusterColorExpr() {
  if (!clusterByCategory) {
    return ['step', ['get', 'point_count'], '#3fa9f5', 10, '#f5c542', 30, '#f5586b'];
  }
  const cats = Object.keys(CATEGORY_SCHEMA);
  const expr = ['case'];
  cats.forEach((cat) => {
    const others = cats.filter((o) => o !== cat);
    const isMax = others.map((o) => ['>=', ['get', `n_${cat}`], ['get', `n_${o}`]]);
    expr.push(['all', ...isMax, ['>', ['get', `n_${cat}`], 0]], CATEGORY_SCHEMA[cat].color);
  });
  expr.push('#3fa9f5');
  return expr;
}
export function toggleClusterByCategory(force) {
  clusterByCategory = force ?? !clusterByCategory;
  if (map.getLayer('clusters')) map.setPaintProperty('clusters', 'circle-color', clusterColorExpr());
  return clusterByCategory;
}

function isWebGLSupported() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

export function initMap(onReady) {
  if (!isWebGLSupported()) {
    const loading = document.getElementById('loadingScreen');
    if (loading) {
      loading.innerHTML = `<div class="loading-mark">GeoMap Studio</div>
        <div class="loading-sub" style="color:#f5586b;max-width:420px;text-align:center;line-height:1.5">
          This browser doesn't support WebGL, which MapLibre GL JS requires.<br/>
          Try a recent version of Chrome, Firefox, Edge, or Safari, and make sure
          hardware acceleration isn't disabled.
        </div>`;
    }
    return;
  }
  map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS.dark.style,
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: 0,
    attributionControl: { compact: true },
    maxPitch: 85,
    cooperativeGestures: false, // toggled from Settings — trackpad users can turn this on to avoid scroll-zoom hijack
  });
  window.__DEBUG_MAP__ = map; // TEMP: removed before final packaging
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  geolocateControl = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
  map.addControl(geolocateControl, 'top-right');

  let initialized = false;
  const ensureLayersReady = () => {
    if (map.getSource('points')) return; // already set up — 'load' and 'style.load' both fire on initial startup
    addEmptySources();
    addLayers();
    rebuildSources();
    restore3DState();
  };

  map.on('load', () => {
    try {
      ensureLayersReady();
      if (!initialized) {
        initialized = true;
        onReady?.();
      }
    } catch (err) {
      console.error('GeoMap Studio failed to initialize:', err);
      reportFatalInitError(err);
    }
  });

  // Basemap swaps wipe out custom sources/layers, so re-add them here too.
  // ensureLayersReady() is a no-op if they already exist (e.g. on the very
  // first style load, before the 'load' event above has even fired).
  map.on('style.load', () => {
    try {
      ensureLayersReady();
    } catch (err) {
      console.error('GeoMap Studio failed to reinitialize after a basemap change:', err);
      reportFatalInitError(err);
    }
  });

  map.on('error', (e) => {
    // MapLibre surfaces tile/network failures here too (e.g. a blocked
    // basemap host) — log them but never let them hang the loading screen.
    console.warn('Map error event:', e?.error?.message || e?.error || e);
  });

  return map;
}

function reportFatalInitError(err) {
  const loading = document.getElementById('loadingScreen');
  if (loading) {
    loading.innerHTML = `
      <div class="loading-mark">GeoMap Studio</div>
      <div class="loading-sub" style="color:#f5586b;max-width:480px;text-align:center;line-height:1.5">
        Something went wrong while starting up:<br/>${(err && err.message) || err}
        <br/><br/>Open the browser console for details, or refresh the page.
      </div>`;
  }
}

function addEmptySources() {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('points', {
    type: 'geojson', data: empty, cluster: true, clusterRadius: 55, clusterMaxZoom: 16,
    clusterProperties: clusterProperties(),
  });
  map.addSource('lines', { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource('polygons', { type: 'geojson', data: empty });
  map.addSource('heat-points', { type: 'geojson', data: empty });
  map.addSource('highlight', { type: 'geojson', data: empty });
  map.addSource('geofences', { type: 'geojson', data: empty });
  map.addSource('spider-legs', { type: 'geojson', data: empty });
  map.addSource('tracked', { type: 'geojson', data: empty });
}

function ensureHatchPattern() {
  if (map.hasImage('zone-hatch-pattern')) return;
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(180,142,242,0.9)'; // matches the "zone" category color
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size); ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2); ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5); ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  map.addImage('zone-hatch-pattern', ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

export function toggleZoneHatchPattern(force) {
  const on = force ?? map.getLayoutProperty('polygons-fill-hatch', 'visibility') !== 'visible';
  ensureHatchPattern();
  map.setLayoutProperty('polygons-fill-hatch', 'visibility', on ? 'visible' : 'none');
  return on;
}

function addLayers() {
  // ---- polygons (drawn under everything else) ----
  map.addLayer({
    id: 'polygons-fill', type: 'fill', source: 'polygons',
    paint: { 'fill-color': matchExpr('category', CATEGORY_SCHEMA, '#888'), 'fill-opacity': ['*', 0.35, opacityExpr()] },
  });
  // A hatched-pattern variant for "zone" polygons specifically — off by
  // default, toggled from Settings. Demonstrates fill-pattern (a repeating
  // generated image) as an alternative to a flat fill-color.
  ensureHatchPattern();
  map.addLayer({
    id: 'polygons-fill-hatch', type: 'fill', source: 'polygons',
    layout: { visibility: 'none' },
    filter: ['==', ['get', 'category'], 'zone'],
    paint: { 'fill-pattern': 'zone-hatch-pattern', 'fill-opacity': opacityExpr() },
  });
  map.addLayer({
    id: 'polygons-outline', type: 'line', source: 'polygons',
    paint: { 'line-color': matchExpr('category', CATEGORY_SCHEMA, '#888'), 'line-width': 2, 'line-opacity': opacityExpr() },
  });

  // ---- geofences ----
  map.addLayer({
    id: 'geofence-fill', type: 'fill', source: 'geofences',
    paint: { 'fill-color': '#f5c542', 'fill-opacity': 0.08 },
  });
  map.addLayer({
    id: 'geofence-outline', type: 'line', source: 'geofences',
    paint: { 'line-color': '#f5c542', 'line-width': 2, 'line-dasharray': [2, 2] },
  });

  // ---- pipeline flow animation (marching-ants along pipeline lines only) ----
  // Amber/gold on purpose: pipelines themselves are teal (#33c2c2), so the
  // old cyan-ish flow color barely showed up against its own line. A soft
  // wider glow underneath the sharp animated dashes makes the "energy
  // moving through the pipe" effect actually readable.
  map.addLayer({
    id: 'pipeline-flow-glow', type: 'line', source: 'lines', filter: ['==', ['get', 'category'], 'pipeline'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#ffb347', 'line-width': 9, 'line-opacity': 0.25, 'line-blur': 3 },
  });
  map.addLayer({
    id: 'pipeline-flow', type: 'line', source: 'lines', filter: ['==', ['get', 'category'], 'pipeline'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#ffd580', 'line-width': 4, 'line-dasharray': [0, 4] },
  });

  // ---- lines ----
  map.addLayer({
    id: 'lines-casing', type: 'line', source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['+', ['match', ['get', 'priority'], 'critical', 5, 'high', 4, 'medium', 3, 2], 2],
      'line-opacity': ['*', 0.55, opacityExpr()],
    },
  });
  map.addLayer({
    id: 'lines-layer', type: 'line', source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': matchExpr('category', CATEGORY_SCHEMA, '#888'),
      'line-width': ['match', ['get', 'priority'], 'critical', 5, 'high', 4, 'medium', 3, 2],
      'line-opacity': opacityExpr(),
    },
  });

  // ---- heatmap (off by default) ----
  map.addLayer({
    id: 'heat-layer', type: 'heatmap', source: 'heat-points',
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': 1,
      'heatmap-radius': 28,
      'heatmap-opacity': 0.75,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.2, '#3fa9f5', 0.4, '#33c2c2', 0.6, '#f5c542', 0.8, '#f5923a', 1, '#f5586b',
      ],
    },
  });

  // ---- spider legs (connecting lines when spiderfying a stack of points) ----
  map.addLayer({
    id: 'spider-legs-layer', type: 'line', source: 'spider-legs',
    paint: { 'line-color': '#8b93a1', 'line-width': 1.5, 'line-dasharray': [1, 1] },
  });

  // ---- clusters ----
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'points', filter: ['has', 'point_count'],
    paint: {
      'circle-color': clusterColorExpr(),
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.35)',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'points', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#0b1120' },
  });

  // ---- unclustered points ----
  map.addLayer({
    id: 'unclustered-point-halo', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 9.5,
      'circle-color': '#ffffff',
      'circle-opacity': ['*', 0.9, opacityExpr()],
    },
  });
  map.addLayer({
    id: 'unclustered-point', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 7,
      'circle-color': matchExpr('category', CATEGORY_SCHEMA, '#ccc'),
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#0b1120',
      'circle-opacity': opacityExpr(),
      'circle-stroke-opacity': opacityExpr(),
    },
  });
  map.addLayer({
    id: 'unclustered-status-ring', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 10,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
      'circle-stroke-color': matchExpr('status', STATUS_SCHEMA, '#888'),
      'circle-stroke-opacity': opacityExpr(),
    },
  });

  // ---- tracked (simulated real-time) vehicles ----
  map.addLayer({
    id: 'tracked-layer', type: 'circle', source: 'tracked',
    paint: { 'circle-radius': 6, 'circle-color': '#3ddc84', 'circle-stroke-width': 2, 'circle-stroke-color': '#0b1120' },
  });

  // ---- highlight (click / selection feedback) ----
  map.addLayer({
    id: 'highlight-line', type: 'line', source: 'highlight',
    paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'highlight-fill', type: 'fill', source: 'highlight',
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.15 },
  });
  map.addLayer({
    id: 'highlight-point', type: 'circle', source: 'highlight',
    paint: { 'circle-radius': 12, 'circle-color': 'rgba(255,255,255,0.25)', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' },
  });
}

// Rebuild every source's `data` from the store + layer visibility state.
// Called whenever assets, filters, or layer-manager toggles change.
export function rebuildSources() {
  // Guard on the sources actually existing (added synchronously inside the
  // 'load'/'style.load' handler right before this is ever called) rather
  // than map.isStyleLoaded() — that flag can still read false for a moment
  // right as 'load' fires, which silently no-ops every rebuild forever.
  if (!map || !map.getSource('points')) return;
  const visible = store.getVisibleAssets().filter((f) => layerState.visible[f.properties.category] !== false);
  const points = visible.filter((f) => f.geometry.type === 'Point');
  const lines = visible.filter((f) => f.geometry.type === 'LineString');
  const polys = visible.filter((f) => f.geometry.type === 'Polygon');

  map.getSource('points')?.setData({ type: 'FeatureCollection', features: points });
  map.getSource('lines')?.setData({ type: 'FeatureCollection', features: lines });
  map.getSource('polygons')?.setData({ type: 'FeatureCollection', features: polys });
  map.getSource('heat-points')?.setData({ type: 'FeatureCollection', features: points });

  refreshOpacityPaint();
}

// Re-applies opacity paint expressions (call after layerState.opacity changes).
export function refreshOpacityPaint() {
  if (!map || !map.getLayer('unclustered-point')) return;
  const op = opacityExpr();
  map.setPaintProperty('unclustered-point', 'circle-opacity', op);
  map.setPaintProperty('unclustered-point', 'circle-stroke-opacity', op);
  map.setPaintProperty('unclustered-point-halo', 'circle-opacity', ['*', 0.9, op]);
  map.setPaintProperty('unclustered-status-ring', 'circle-stroke-opacity', op);
  map.setPaintProperty('lines-layer', 'line-opacity', op);
  map.setPaintProperty('lines-casing', 'line-opacity', ['*', 0.55, op]);
  map.setPaintProperty('polygons-outline', 'line-opacity', op);
  map.setPaintProperty('polygons-fill', 'fill-opacity', ['*', 0.35, op]);
}

export function setHighlight(features) {
  map.getSource('highlight')?.setData({ type: 'FeatureCollection', features: features || [] });
}

// ---- basemap switching -----------------------------------------------
export function setBasemap(key) {
  const def = BASEMAPS[key];
  if (!def) return;
  map.setStyle(def.style);
}

// ---- 3D buildings + globe ----------------------------------------------
// The "Streets" (Liberty) vector basemap ships its own native fill-extrusion
// building layer (id "building-3d", real OSM footprints + height data) — we
// just toggle its visibility rather than adding a second, redundant one.
// Raster basemaps (Dark/Positron/Satellite/etc.) have no per-building vector
// geometry at all, so there is nothing to extrude on those; we tell the user
// rather than silently doing nothing.
let is3D = false;
let isGlobe = false;
export function toggle3DBuildings(force) {
  is3D = force ?? !is3D;
  const nativeLayer = map.getLayer('building-3d');
  if (nativeLayer) {
    map.setLayoutProperty('building-3d', 'visibility', is3D ? 'visible' : 'none');
  } else if (is3D) {
    import('./notifications.js').then(({ pushNotification }) =>
      pushNotification('3D buildings need real building geometry — switch the basemap to "Streets" in Settings first.', 'warn'));
  }
  map.easeTo({ pitch: is3D ? 55 : 0, duration: 600 });
  return is3D;
}
export function toggleGlobe(force) {
  isGlobe = force ?? !isGlobe;
  try {
    const style = map.getStyle();
    map.setStyle({ ...style, projection: { type: isGlobe ? 'globe' : 'mercator' } });
  } catch (err) {
    console.warn('Globe projection toggle failed:', err);
  }
  return isGlobe;
}
export function isGlobeActive() { return isGlobe; }

// ---- Clustering on/off — MapLibre can't flip a source's `cluster` option
// live, so this removes and re-adds the 'points' source (and every layer
// that reads from it) with the new setting, then repopulates from the store.
let clusteringEnabled = true;
export function toggleClustering(force) {
  clusteringEnabled = force ?? !clusteringEnabled;
  const dependentLayers = ['clusters', 'cluster-count', 'unclustered-point-halo', 'unclustered-point', 'unclustered-status-ring'];
  const layerDefs = dependentLayers.map((id) => map.getLayer(id) && map.getStyle().layers.find((l) => l.id === id)).filter(Boolean);
  dependentLayers.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('points')) map.removeSource('points');
  map.addSource('points', {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: clusteringEnabled, clusterRadius: 55, clusterMaxZoom: 16,
    clusterProperties: clusterProperties(),
  });
  layerDefs.forEach((def) => map.addLayer(def));
  rebuildSources();
  return clusteringEnabled;
}

// ---- Generic WMS overlay — works with any standards-compliant WMS
// endpoint (e.g. ISRO Bhuvan's WMS services — some require free registration
// at bhuvan.nrsc.gov.in for an access key; substitute your own URL/layer
// there if the default needs one). Uses MapLibre's {bbox-epsg-3857} template
// token, the standard way to back a raster source with a WMS GetMap request.
let wmsActive = false;
export function toggleWMSLayer(force, { url, layerName } = {}) {
  wmsActive = force ?? !wmsActive;
  if (wmsActive && url && layerName) {
    if (map.getLayer('wms-layer')) map.removeLayer('wms-layer');
    if (map.getSource('wms-source')) map.removeSource('wms-source');
    const tileUrl = `${url}${url.includes('?') ? '&' : '?'}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layerName)}&STYLES=&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&FORMAT=image/png&TRANSPARENT=true`;
    try {
      map.addSource('wms-source', { type: 'raster', tiles: [tileUrl], tileSize: 256 });
      map.addLayer({ id: 'wms-layer', type: 'raster', source: 'wms-source', paint: { 'raster-opacity': 0.75 } });
    } catch (err) {
      console.warn('WMS layer failed to add:', err);
      return false;
    }
  } else if (!wmsActive && map.getLayer('wms-layer')) {
    map.setLayoutProperty('wms-layer', 'visibility', 'none');
  } else if (wmsActive && map.getLayer('wms-layer')) {
    map.setLayoutProperty('wms-layer', 'visibility', 'visible');
  }
  return wmsActive;
}

function restore3DState() {
  if (is3D) toggle3DBuildings(true);
  if (isGlobe) toggleGlobe(true);
  if (isTerrain) toggleTerrain(true);
}

// A single "2D View / 3D View" switch for the common case — combines
// building extrusion + terrain/hillshade + the camera tilt into one action,
// matching the spec's "seamless switching between 2D and 3D view". The
// granular checkboxes in Settings still work independently for anyone who
// wants just buildings, or just terrain, without the other.
export function isImmersive3DActive() { return is3D && isTerrain; }
export function toggleImmersive3D(force) {
  const next = force ?? !(is3D && isTerrain);
  toggle3DBuildings(next);
  toggleTerrain(next);
  return next;
}

// ---- 3D Terrain + hillshade + sky/atmosphere ------------------------------
// Uses free, key-less Terrarium-encoded DEM tiles (AWS Open Data). This is
// the direct equivalent of MapLibre's "3D Terrain" / "Sky, Fog, Terrain" /
// "Add a hillshade layer" examples, wired to real elevation data.
let isTerrain = false;
function ensureDemSource() {
  if (!map.getSource('dem')) {
    map.addSource('dem', TERRAIN_DEM);
  }
  if (!map.getLayer('hillshade-layer')) {
    map.addLayer({
      id: 'hillshade-layer', type: 'hillshade', source: 'dem',
      layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.6, 'hillshade-illumination-direction': 335 },
    }, 'polygons-fill');
  }
  // A second illumination source from a different direction, blended with
  // the first — the standard technique for "multidirectional" hillshading
  // (single-direction hillshade can hide terrain features whose slope faces
  // away from the light; a second light from a different angle fills those in).
  if (!map.getLayer('hillshade-layer-2')) {
    map.addLayer({
      id: 'hillshade-layer-2', type: 'hillshade', source: 'dem',
      layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.4, 'hillshade-illumination-direction': 115 },
    }, 'polygons-fill');
  }
}
let isMultidirectional = false;
export function toggleMultidirectionalHillshade(force) {
  isMultidirectional = force ?? !isMultidirectional;
  ensureDemSource();
  if (map.getLayer('hillshade-layer-2')) {
    map.setLayoutProperty('hillshade-layer-2', 'visibility', (isMultidirectional && isTerrain) ? 'visible' : 'none');
  }
  return isMultidirectional;
}
export function toggleTerrain(force) {
  ensureDemSource();
  isTerrain = force ?? !isTerrain;
  if (isTerrain) {
    map.setTerrain({ source: 'dem', exaggeration: 1.3 });
    map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');
    map.setLayoutProperty('hillshade-layer-2', 'visibility', isMultidirectional ? 'visible' : 'none');
    try {
      map.setSky({
        'sky-color': '#0b1120',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#1c2333',
        'horizon-fog-blend': 0.5,
        'fog-color': '#1c2333',
        'fog-ground-blend': 0.3,
      });
    } catch { /* older MapLibre builds without setSky — terrain still works fine */ }
  } else {
    map.setTerrain(null);
    map.setLayoutProperty('hillshade-layer', 'visibility', 'none');
    map.setLayoutProperty('hillshade-layer-2', 'visibility', 'none');
  }
  return isTerrain;
}

// ---- pipeline flow animation (marching ants along pipeline lines) --------
let flowIntervalId = null;
export function togglePipelineFlow(force) {
  const on = force ?? map.getLayoutProperty('pipeline-flow', 'visibility') !== 'visible';
  map.setLayoutProperty('pipeline-flow', 'visibility', on ? 'visible' : 'none');
  map.setLayoutProperty('pipeline-flow-glow', 'visibility', on ? 'visible' : 'none');
  if (on && !flowIntervalId) {
    let step = 0;
    const totalSteps = 12;
    flowIntervalId = setInterval(() => {
      step = (step + 1) % totalSteps;
      map.setPaintProperty('pipeline-flow', 'line-dasharray', [step, totalSteps - step]);
    }, 60);
  } else if (!on && flowIntervalId) {
    clearInterval(flowIntervalId);
    flowIntervalId = null;
  }
  return on;
}

// ---- misc native-MapLibre settings toggles (see settings.js for the UI) --
export function setRestrictPanning(on) {
  map.setMaxBounds(on ? REGION_BOUNDS : null);
}
export function setRotationLocked(on) {
  if (on) { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); }
  else { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); }
}
export function setRenderWorldCopies(on) {
  map.setRenderWorldCopies(on);
}
export function setCooperativeGestures(on) {
  if (map.cooperativeGestures && typeof map.cooperativeGestures.enable === 'function') {
    on ? map.cooperativeGestures.enable() : map.cooperativeGestures.disable();
  } else {
    console.warn('This MapLibre build has no cooperativeGestures handler.');
  }
}

// ---- Presentation / non-interactive mode — disables every UI handler at
// once (drag, zoom, rotate, keyboard, double-click), for a static "kiosk"
// display of the map without any risk of the viewer nudging it off-target.
export function setInteractive(on) {
  const handlers = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];
  handlers.forEach((h) => { on ? map[h]?.enable() : map[h]?.disable(); });
}
