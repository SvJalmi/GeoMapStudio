// ============================================================================
// GeoMap Studio — seed.js
// Generates a reproducible demo dataset around Goa, India. Deliberately
// includes: (a) points sitting exactly on a line (pipeline/road) so the
// overlap-popup logic has something real to prove itself against, (b)
// several points stacked at the identical coordinate so clustering has to
// fall back to spiderfying, and (c) a couple of near-duplicate assets so the
// AI duplicate-detector has genuine matches to surface.
// ============================================================================
import { CATEGORY_SCHEMA, STATUS_SCHEMA, PRIORITY_SCHEMA, OWNERS, ASSET_TYPES, CITIES } from './config.js';

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const rnd = seededRandom(42);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const CENTER = [73.9862, 15.4909];

function jitter(coord, spread = 0.05) {
  return [coord[0] + (rnd() - 0.5) * spread, coord[1] + (rnd() - 0.5) * spread];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let counter = 1;
function nextId(prefix) {
  return `${prefix}-${String(counter++).padStart(4, '0')}`;
}

function makeProps(category) {
  const status = pick(Object.keys(STATUS_SCHEMA));
  const priority = pick(Object.keys(PRIORITY_SCHEMA));
  const created = 200 + Math.floor(rnd() * 500);
  const updated = Math.floor(rnd() * created);
  return {
    id: nextId(category.slice(0, 3).toUpperCase()),
    name: `${CATEGORY_SCHEMA[category].label} ${counter}`,
    type: pick(ASSET_TYPES),
    category,
    owner: pick(OWNERS),
    city: pick(CITIES),
    status,
    priority,
    createdDate: daysAgo(created),
    updatedDate: daysAgo(updated),
    gpsAccuracy: (1 + rnd() * 8).toFixed(1),
    description: '',
    images: [],
    documents: [],
  };
}

export function buildDemoDataset() {
  const features = [];

  // --- Roads & pipelines (lines) ---
  const lineCategories = ['road', 'pipeline', 'transmission_line'];
  const lines = [];
  lineCategories.forEach((cat) => {
    for (let i = 0; i < 6; i++) {
      const start = jitter(CENTER, 0.14);
      const dx = (rnd() - 0.5) * 0.05;
      const dy = (rnd() - 0.5) * 0.05;
      const mid = [start[0] + dx, start[1] + dy];
      const end = [mid[0] + dx * (0.7 + rnd() * 0.6), mid[1] + dy * (0.7 + rnd() * 0.6)];
      const coords = [start, mid, end];
      const feature = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: makeProps(cat),
      };
      lines.push({ cat, coords, feature });
      features.push(feature);
    }
  });

  // --- Point categories, including some deliberately placed ON a line ---
  const pointCategories = ['water_tank', 'electric_pole', 'substation', 'streetlight', 'manhole', 'hospital', 'school'];
  pointCategories.forEach((cat) => {
    const count = cat === 'streetlight' || cat === 'electric_pole' ? 14 : 8;
    for (let i = 0; i < count; i++) {
      let coord;
      // ~1 in 5 points snaps exactly onto a line's midpoint to guarantee overlap
      if (i % 5 === 0 && lines.length) {
        const line = pick(lines);
        coord = [...line.coords[1]];
      } else {
        coord = jitter(CENTER, 0.16);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: makeProps(cat),
      });
    }
  });

  // --- Stack a handful of points at an IDENTICAL coordinate to force spiderfy ---
  const stackPoint = jitter(CENTER, 0.1);
  ['water_tank', 'electric_pole', 'manhole', 'streetlight', 'substation'].forEach((cat) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [...stackPoint] },
      properties: makeProps(cat),
    });
  });

  // --- Buildings, land parcels, zones (polygons) ---
  const polyCategories = ['building', 'land_parcel', 'zone'];
  polyCategories.forEach((cat) => {
    for (let i = 0; i < 6; i++) {
      const c = jitter(CENTER, 0.15);
      const s = 0.002 + rnd() * 0.004;
      const ring = [
        [c[0] - s, c[1] - s], [c[0] + s, c[1] - s],
        [c[0] + s, c[1] + s], [c[0] - s, c[1] + s], [c[0] - s, c[1] - s],
      ];
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: makeProps(cat),
      });
    }
  });

  // --- A near-duplicate pair for the AI duplicate detector to find ---
  const dupBase = jitter(CENTER, 0.12);
  const dupProps1 = makeProps('water_tank');
  dupProps1.name = 'Borim Water Tank';
  features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: dupBase }, properties: dupProps1 });
  const dupProps2 = makeProps('water_tank');
  dupProps2.name = 'Borim Water Tank ';
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [dupBase[0] + 0.0004, dupBase[1] + 0.0003] },
    properties: dupProps2,
  });

  return { type: 'FeatureCollection', features };
}
