// ============================================================================
// GeoMap Studio — io.js
// File import/export. GeoJSON round-trips losslessly; CSV/KML are one-way
// simplifications (documented inline) since those formats can't carry every
// field GeoJSON can.
// ============================================================================
import { store } from './store.js';
import { map } from './map.js';
import { pushNotification } from './notifications.js';
import { CATEGORY_SCHEMA } from './config.js';

function el(id) { return document.getElementById(id); }
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function initIO() {
  el('exportGeoJSON').addEventListener('click', () => exportAll('geojson'));
  el('exportCSV').addEventListener('click', () => exportAll('csv'));
  el('exportKML').addEventListener('click', () => exportAll('kml'));
  el('exportPNG').addEventListener('click', exportPNG);
  el('exportPDF').addEventListener('click', exportPDFReport);
  el('importFileInput').addEventListener('change', onImportFile);
}

function centroidOf(feature) {
  const g = feature.geometry;
  if (g.type === 'Point') return g.coordinates;
  if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
  return g.coordinates[0][0];
}

// ---------------------------------------------------------------------------
export function exportAll(format) { exportFeatures(store.toFeatureCollection().features, format, 'geomap-assets'); }
export function exportSelection(ids, format = 'geojson') {
  if (!ids.length) { pushNotification('Select assets first to export a subset.', 'warn'); return; }
  exportFeatures(ids.map((id) => store.assets.get(id)).filter(Boolean), format, 'geomap-selection');
}

function exportFeatures(features, format, baseName) {
  if (!features.length) { pushNotification('Nothing to export.', 'warn'); return; }
  if (format === 'geojson') {
    download(`${baseName}.geojson`, JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/geo+json');
  } else if (format === 'csv') {
    download(`${baseName}.csv`, toCSV(features), 'text/csv');
  } else if (format === 'kml') {
    download(`${baseName}.kml`, toKML(features), 'application/vnd.google-earth.kml+xml');
  }
  pushNotification(`Exported ${features.length} asset(s) as ${format.toUpperCase()}`, 'success');
}

function toCSV(features) {
  const cols = ['id', 'name', 'type', 'category', 'owner', 'status', 'priority', 'createdDate', 'updatedDate', 'gpsAccuracy', 'description', 'geometryType', 'lng', 'lat'];
  const rows = features.map((f) => {
    const c = centroidOf(f);
    const p = f.properties;
    return cols.map((col) => {
      if (col === 'geometryType') return f.geometry.type;
      if (col === 'lng') return c[0].toFixed(6);
      if (col === 'lat') return c[1].toFixed(6);
      const v = p[col] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
}

function toKML(features) {
  const placemarks = features.map((f) => {
    const p = f.properties;
    const g = f.geometry;
    let geomXML = '';
    if (g.type === 'Point') geomXML = `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>`;
    else if (g.type === 'LineString') geomXML = `<LineString><coordinates>${g.coordinates.map((c) => c.join(',')).join(' ')}</coordinates></LineString>`;
    else if (g.type === 'Polygon') geomXML = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${g.coordinates[0].map((c) => c.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    return `<Placemark><name>${escapeXML(p.name)}</name><description>${escapeXML(`${p.id} — ${CATEGORY_SCHEMA[p.category]?.label} — ${p.status}`)}</description>${geomXML}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;
}
function escapeXML(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------------------------------------------------------------------------
function exportPNG() {
  map.once('render', () => {
    const canvas = map.getCanvas();
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'geomap-snapshot.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  });
  map.triggerRepaint();
  pushNotification('Map snapshot exported as PNG', 'success');
}

function exportPDFReport() {
  const stats = computeQuickStats();
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>GeoMap Studio Report</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:32px;color:#111}
      h1{margin-bottom:4px} .sub{color:#666;margin-top:0}
      table{border-collapse:collapse;width:100%;margin-top:16px}
      td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px}
      th{background:#f2f2f2}
    </style></head><body>
      <h1>GeoMap Studio — Asset Report</h1>
      <p class="sub">Generated ${new Date().toLocaleString()}</p>
      <table>
        <tr><th>Total assets</th><td>${stats.total}</td></tr>
        <tr><th>Active</th><td>${stats.active}</td></tr>
        <tr><th>Under maintenance</th><td>${stats.maintenance}</td></tr>
        <tr><th>Critical priority</th><td>${stats.critical}</td></tr>
      </table>
      <h2>By category</h2>
      <table><tr><th>Category</th><th>Count</th></tr>
        ${Object.entries(stats.byCategory).map(([k, v]) => `<tr><td>${CATEGORY_SCHEMA[k]?.label || k}</td><td>${v}</td></tr>`).join('')}
      </table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function computeQuickStats() {
  const feats = [...store.assets.values()];
  const byCategory = {};
  let active = 0, maintenance = 0, critical = 0;
  feats.forEach((f) => {
    byCategory[f.properties.category] = (byCategory[f.properties.category] || 0) + 1;
    if (f.properties.status === 'active') active++;
    if (f.properties.status === 'maintenance') maintenance++;
    if (f.properties.priority === 'critical') critical++;
  });
  return { total: feats.length, active, maintenance, critical, byCategory };
}

// ---------------------------------------------------------------------------
async function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    let fc;
    const name = file.name.toLowerCase();
    if (name.endsWith('.json') || name.endsWith('.geojson')) {
      fc = JSON.parse(text);
    } else if (name.endsWith('.csv')) {
      fc = csvToFeatureCollection(text);
    } else if (name.endsWith('.kml')) {
      fc = kmlToFeatureCollection(text);
    } else if (name.endsWith('.gpx')) {
      fc = gpxToFeatureCollection(text);
    } else {
      pushNotification('Supported import formats: GeoJSON, CSV, KML, GPX.', 'warn');
      return;
    }
    let imported = 0;
    fc.features.forEach((f) => {
      if (!f.properties?.id) f.properties = { ...f.properties, id: `IMP-${Date.now().toString(36)}-${imported}` };
      if (!f.properties.category || !CATEGORY_SCHEMA[f.properties.category]) f.properties.category = guessCategory(f.geometry.type);
      f.properties.createdDate ||= new Date().toISOString().slice(0, 10);
      f.properties.updatedDate ||= new Date().toISOString().slice(0, 10);
      f.properties.status ||= 'active';
      f.properties.priority ||= 'medium';
      f.properties.owner ||= 'Municipal Corporation';
      store.addAsset(f, { record: false });
      imported++;
    });
    store.emit('assets:changed', { reason: 'import' });
    pushNotification(`Imported ${imported} feature(s)`, 'success');
  } catch (err) {
    console.error(err);
    pushNotification('Import failed — the file may not be valid GeoJSON/CSV.', 'warn');
  }
  e.target.value = '';
}

function guessCategory(geomType) {
  return Object.entries(CATEGORY_SCHEMA).find(([, v]) => v.geom === geomType)?.[0] || 'zone';
}

function csvToFeatureCollection(text) {
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.replace(/"/g, '').trim());
  const latIdx = headers.indexOf('lat');
  const lngIdx = headers.indexOf('lng');
  const features = lines.filter(Boolean).map((line) => {
    const cells = line.match(/(".*?"|[^,]+)/g).map((c) => c.replace(/^"|"$/g, ''));
    const props = {};
    headers.forEach((h, i) => { props[h] = cells[i]; });
    const lat = parseFloat(props.lat ?? cells[latIdx]);
    const lng = parseFloat(props.lng ?? cells[lngIdx]);
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props };
  }).filter((f) => Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1]));
  return { type: 'FeatureCollection', features };
}

// KML → GeoJSON using the browser's built-in XML parser (no external library,
// so there's no third-party parsing behaviour to get wrong). Covers the
// Point/LineString/Polygon placemark shapes this app itself exports.
function kmlToFeatureCollection(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Malformed KML/XML');
  const features = [...doc.querySelectorAll('Placemark')].map((pm) => {
    const name = pm.querySelector('name')?.textContent?.trim() || 'Imported feature';
    const description = pm.querySelector('description')?.textContent?.trim() || '';
    const parseCoords = (str) => str.trim().split(/\s+/).map((triplet) => {
      const [lng, lat] = triplet.split(',').map(Number);
      return [lng, lat];
    });

    let geometry = null;
    const point = pm.querySelector('Point coordinates');
    const line = pm.querySelector('LineString coordinates');
    const poly = pm.querySelector('Polygon outerBoundaryIs coordinates, Polygon coordinates');
    if (point) geometry = { type: 'Point', coordinates: parseCoords(point.textContent)[0] };
    else if (line) geometry = { type: 'LineString', coordinates: parseCoords(line.textContent) };
    else if (poly) geometry = { type: 'Polygon', coordinates: [parseCoords(poly.textContent)] };
    if (!geometry) return null;
    return { type: 'Feature', geometry, properties: { name, description } };
  }).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

// GPX → GeoJSON. Waypoints (<wpt>) become points; each <trk>/<rte> becomes a
// single line built from its trkpt/rtept sequence.
function gpxToFeatureCollection(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Malformed GPX/XML');
  const features = [];

  doc.querySelectorAll('wpt').forEach((wpt) => {
    const lng = parseFloat(wpt.getAttribute('lon'));
    const lat = parseFloat(wpt.getAttribute('lat'));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const name = wpt.querySelector('name')?.textContent?.trim() || 'Waypoint';
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name } });
  });

  doc.querySelectorAll('trk, rte').forEach((track, i) => {
    const points = [...track.querySelectorAll('trkpt, rtept')].map((pt) => [
      parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat')),
    ]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (points.length < 2) return;
    const name = track.querySelector('name')?.textContent?.trim() || `Track ${i + 1}`;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: { name } });
  });

  return { type: 'FeatureCollection', features };
}
