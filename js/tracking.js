// ============================================================================
// GeoMap Studio — tracking.js
// Real "real-time" tracking needs a live feed (GPS units, a backend) this
// static demo doesn't have, so this simulates 1-3 vehicles smoothly animating
// along one of the existing road/pipeline lines using turf.along — the same
// technique as MapLibre's "Animate a point along a route" example — and is
// labeled as a simulation in the UI rather than implied to be live GPS.
// ============================================================================
import { map } from './map.js';
import { store } from './store.js';

let vehicles = [];
let animId = null;
let running = false;

function el(id) { return document.getElementById(id); }

export function initTracking() {
  el('trackingToggleBtn').addEventListener('click', toggleTracking);
}

function pickRoutes(count) {
  const lines = [...store.assets.values()].filter((f) => f.geometry.type === 'LineString');
  const chosen = [];
  for (let i = 0; i < count && lines.length; i++) chosen.push(lines[Math.floor(Math.random() * lines.length)]);
  return chosen;
}

function toggleTracking() {
  running = !running;
  el('trackingToggleBtn').classList.toggle('active', running);
  el('trackingToggleBtn').textContent = running ? '⏹ Stop simulated tracking' : '▶ Start simulated tracking';
  if (running) startSimulation(); else stopSimulation();
}

function startSimulation() {
  const routes = pickRoutes(3);
  if (!routes.length) { pushWarnNoRoutes(); running = false; el('trackingToggleBtn').classList.remove('active'); return; }
  vehicles = routes.map((line, i) => ({
    id: `VEH-${i + 1}`,
    line: line.geometry,
    length: turf.length(line, { units: 'kilometers' }),
    progress: Math.random(),
    speed: 0.00025 + Math.random() * 0.0004, // km per tick, arbitrary demo pace
    direction: 1,
  }));
  const tick = () => {
    if (!running) return;
    vehicles.forEach((v) => {
      v.progress += v.speed * v.direction / Math.max(v.length, 0.01);
      if (v.progress >= 1) { v.progress = 1; v.direction = -1; }
      if (v.progress <= 0) { v.progress = 0; v.direction = 1; }
    });
    render();
    animId = requestAnimationFrame(tick);
  };
  tick();
}

function stopSimulation() {
  running = false;
  cancelAnimationFrame(animId);
  map.getSource('tracked')?.setData({ type: 'FeatureCollection', features: [] });
}

function render() {
  const features = vehicles.map((v) => {
    const along = turf.along(v.line, v.progress * v.length, { units: 'kilometers' });
    along.properties = { id: v.id, label: v.id };
    return along;
  });
  map.getSource('tracked')?.setData({ type: 'FeatureCollection', features });
}

function pushWarnNoRoutes() {
  import('./notifications.js').then(({ pushNotification }) => pushNotification('No line assets (roads/pipelines) available to simulate tracking along.', 'warn'));
}
