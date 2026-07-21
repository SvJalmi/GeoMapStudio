// ============================================================================
// GeoMap Studio — config.js
// Central configuration: category schema, color tokens, basemap styles.
// Nothing in here touches the map or DOM — pure data so every other module
// can share one source of truth.
// ============================================================================

export const CATEGORY_SCHEMA = {
  // --- point assets ---
  water_tank:      { label: 'Water Tank',       geom: 'Point',   icon: 'droplet',    color: '#3fa9f5' },
  electric_pole:   { label: 'Electric Pole',    geom: 'Point',   icon: 'zap',        color: '#f5c542' },
  substation:      { label: 'Substation',       geom: 'Point',   icon: 'radio',      color: '#f59e42' },
  streetlight:     { label: 'Streetlight',      geom: 'Point',   icon: 'lamp',       color: '#e2e8a0' },
  manhole:         { label: 'Manhole',          geom: 'Point',   icon: 'circle-dot', color: '#8b8b8b' },
  hospital:        { label: 'Hospital',         geom: 'Point',   icon: 'cross',      color: '#f5586b' },
  school:          { label: 'School',           geom: 'Point',   icon: 'book',       color: '#9b6df5' },
  // --- line assets ---
  pipeline:        { label: 'Pipeline',         geom: 'LineString', icon: 'pipe',    color: '#33c2c2' },
  road:            { label: 'Road',             geom: 'LineString', icon: 'road',    color: '#c9c9c9' },
  transmission_line:{ label: 'Transmission Line', geom: 'LineString', icon: 'power', color: '#f5a623' },
  // --- polygon assets ---
  building:        { label: 'Building',         geom: 'Polygon', icon: 'building',   color: '#5c9df5' },
  land_parcel:     { label: 'Land Parcel',      geom: 'Polygon', icon: 'map',        color: '#7bd68d' },
  zone:            { label: 'Zone',             geom: 'Polygon', icon: 'layers',     color: '#e07bf5' },
};

export const STATUS_SCHEMA = {
  active:        { label: 'Active',        color: '#3ddc84' },
  maintenance:   { label: 'Under Maintenance', color: '#f5c542' },
  inactive:      { label: 'Inactive',      color: '#8b93a1' },
  decommissioned:{ label: 'Decommissioned', color: '#f5586b' },
};

export const PRIORITY_SCHEMA = {
  low:      { label: 'Low',      weight: 1, color: '#3ddc84' },
  medium:   { label: 'Medium',   weight: 2, color: '#f5c542' },
  high:     { label: 'High',     weight: 3, color: '#f5923a' },
  critical: { label: 'Critical', weight: 4, color: '#f5586b' },
};

export const OWNERS = ['Municipal Corporation', 'PWD Goa', 'Goa Electricity Dept.', 'Water Resources Dept.', 'Private Contractor'];

// Cities within the Goa demo region, used by the new City field + filter.
export const CITIES = ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Bicholim'];

// A distinct "Type" field, independent of Category (which is the specific
// asset kind — Water Tank, Pipeline, etc. — driving icon/color on the map).
// Type is a broader operational classification asked for separately in the
// spec, so it isn't just Category by another name.
export const ASSET_TYPES = ['Public Infrastructure', 'Private Asset', 'Utility Network', 'Environmental Feature', 'Emergency Facility', 'Other'];

// Emoji glyphs keep the UI zero-dependency (no icon font/sprite to load).
export const CATEGORY_EMOJI = {
  water_tank: '💧', electric_pole: '⚡', substation: '🔌', streetlight: '💡',
  manhole: '⚫', hospital: '✚', school: '🏫',
  pipeline: '〰️', road: '🛣️', transmission_line: '🗼',
  building: '🏢', land_parcel: '🗺️', zone: '🔷',
};

// Public glyphs (font) endpoint — required by MapLibre for ANY symbol layer
// that uses text-field (we use one, for cluster-count labels), even on an
// otherwise glyph-free raster basemap. Without this, MapLibre throws at
// layer-add time and the app never finishes initializing.
export const GLYPHS_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

// Basemaps — all key-free public styles/tile sets so the project runs with
// zero configuration. OpenFreeMap 'liberty' ships vector buildings, which is
// what powers the 3D Buildings + Globe toggles.
export const BASEMAPS = {
  liberty: {
    label: 'Streets',
    thumb: 'linear-gradient(135deg,#eef0e6,#e3ead9 45%,#cfe0c8 75%,#eef0e6)',
    style: 'https://tiles.openfreemap.org/styles/liberty',
  },
  dark: {
    label: 'Dark Matter',
    thumb: 'linear-gradient(135deg,#141c2b,#1c2c40 45%,#233a52 75%,#141c2b)',
    style: {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: {
        carto: {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors © CARTO',
        },
      },
      layers: [{ id: 'carto-dark', type: 'raster', source: 'carto' }],
    },
  },
  light: {
    label: 'Positron',
    thumb: 'linear-gradient(135deg,#eef1f4,#e2e8ee 45%,#d3dde6 75%,#eef1f4)',
    style: {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: {
        carto: {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors © CARTO',
        },
      },
      layers: [{ id: 'carto-light', type: 'raster', source: 'carto' }],
    },
  },
  satellite: {
    label: 'Satellite',
    thumb: 'linear-gradient(135deg,#1f3d2e,#2f5540 40%,#3d6b52 70%,#274a37)',
    style: {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri World Imagery',
        },
      },
      layers: [{ id: 'esri-sat', type: 'raster', source: 'esri' }],
    },
  },
  voyager: {
    label: 'Bright',
    thumb: 'linear-gradient(135deg,#f3ede3,#eee2c9 45%,#dcefe3 75%,#f3ede3)',
    style: {
      version: 8, glyphs: GLYPHS_URL,
      sources: { carto: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' } },
      layers: [{ id: 'carto-voyager', type: 'raster', source: 'carto' }],
    },
  },
  topo: {
    label: 'Topo',
    thumb: 'linear-gradient(135deg,#c9dfc2,#e0d9b0 40%,#cbb98c 70%,#b7a978)',
    style: {
      version: 8, glyphs: GLYPHS_URL,
      sources: { topo: { type: 'raster', tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenTopoMap contributors' } },
      layers: [{ id: 'opentopo', type: 'raster', source: 'topo' }],
    },
  },
  osm: {
    label: 'OSM',
    thumb: 'linear-gradient(135deg,#dce6f0,#c9def0 45%,#a7c9e8 75%,#dce6f0)',
    style: {
      version: 8, glyphs: GLYPHS_URL,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
      layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
    },
  },
};

// Default view — centred on Goa, India, matching the project's stated scope.
export const DEFAULT_VIEW = { center: [73.9862, 15.4909], zoom: 12.5 };

// Loose bounding box around Goa, used by the "Restrict panning" setting.
export const REGION_BOUNDS = [[73.6, 14.9], [74.4, 15.9]];

// Terrarium-encoded DEM tiles hosted on AWS Open Data — free, no API key,
// what powers the 3D Terrain / hillshade / "Sky, Fog, Terrain" toggles.
export const TERRAIN_DEM = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  encoding: 'terrarium',
  maxzoom: 15,
  attribution: 'Mapzen Terrarium (AWS Open Data)',
};

// Pixel tolerance used when hit-testing overlapping features on click.
export const CLICK_HIT_TOLERANCE = 5;

// Distance (in the map's screen pixels) below which two same-location points
// are treated as "stacked" and offered for spiderfying instead of a flat popup.
export const SPIDERFY_PIXEL_RADIUS = 42;
