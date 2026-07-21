// ============================================================================
// GeoMap Studio — offline-pmtiles.js
// Genuine offline map support: the user supplies their own .pmtiles archive
// (a single-file tile package — free tools like https://protomaps.com let
// anyone build one for any region), and this loads it as a basemap with zero
// network requests once picked. This is the honest way to do "offline maps"
// client-side — there's no bundled sample file (that would just be another
// network dependency), so the person must bring their own .pmtiles export.
//
// Best-effort note: this wires up the documented pmtiles.js + MapLibre
// integration (custom protocol + addProtocol), but hasn't been exercised
// against a real .pmtiles file in this build environment (no network access
// to fetch a sample). If a particular archive's internal layer names differ
// from what's assumed here, the vector style may need its layer names
// adjusted — errors are caught and surfaced as a notification rather than
// crashing the app.
// ============================================================================
import { map } from './map.js';
import { pushNotification } from './notifications.js';

let protocolRegistered = false;

function el(id) { return document.getElementById(id); }

export function initOfflinePMTiles() {
  el('offlinePmtilesInput')?.addEventListener('change', onFileSelected);
}

async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (typeof pmtiles === 'undefined') throw new Error('pmtiles.js failed to load (no internet on first load?)');

    if (!protocolRegistered) {
      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      window.__pmtilesProtocol = protocol;
      protocolRegistered = true;
    }

    const source = new pmtiles.FileSource(file);
    const archive = new pmtiles.PMTiles(source);
    window.__pmtilesProtocol.add(archive);

    const header = await archive.getHeader();
    const isVector = header.tileType === pmtiles.TileType.Mvt;
    const sourceUrl = `pmtiles://${archive.source.getKey ? archive.source.getKey() : file.name}`;

    if (isVector) {
      const meta = await archive.getMetadata();
      const layerNames = (meta?.vector_layers || []).map((l) => l.id);
      map.addSource('offline-pmtiles', { type: 'vector', url: sourceUrl });
      layerNames.forEach((name, i) => {
        map.addLayer({
          id: `offline-pmtiles-${name}`, type: 'fill', source: 'offline-pmtiles', 'source-layer': name,
          paint: { 'fill-color': '#2a3d52', 'fill-opacity': 0.5, 'fill-outline-color': '#4fd8c4' },
        });
      });
    } else {
      map.addSource('offline-pmtiles', { type: 'raster', url: sourceUrl, tileSize: 256 });
      map.addLayer({ id: 'offline-pmtiles-raster', type: 'raster', source: 'offline-pmtiles' });
    }

    const bounds = header.maxLon ? [[header.minLon, header.minLat], [header.maxLon, header.maxLat]] : null;
    if (bounds) map.fitBounds(bounds, { padding: 40, duration: 500 });

    pushNotification(`Loaded offline basemap "${file.name}" — no network needed for this layer now.`, 'success');
  } catch (err) {
    console.error('Offline PMTiles load failed:', err);
    pushNotification(`Could not load that .pmtiles file: ${err.message}`, 'warn');
  }
  e.target.value = '';
}
