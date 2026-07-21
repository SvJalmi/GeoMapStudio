// ============================================================================
// GeoMap Studio — analytics.js
// KPI tiles + three Chart.js charts (category bar, status pie, 90-day update
// trend line), all recomputed from the live store so they always reflect
// the current filtered dataset.
// ============================================================================
import { store } from './store.js';
import { CATEGORY_SCHEMA, STATUS_SCHEMA } from './config.js';

let charts = {};

function el(id) { return document.getElementById(id); }

export function initAnalytics() {
  el('analyticsToggleBtn').addEventListener('click', () => {
    el('analyticsPanel').classList.toggle('open');
    if (el('analyticsPanel').classList.contains('open')) render();
  });
  el('analyticsCloseBtn').addEventListener('click', () => el('analyticsPanel').classList.remove('open'));
  store.addEventListener('assets:changed', () => { if (el('analyticsPanel').classList.contains('open')) render(); });
}

function render() {
  const feats = [...store.assets.values()];
  const byCategory = {};
  const byStatus = {};
  const byWeek = {};
  feats.forEach((f) => {
    const p = f.properties;
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    const weekKey = weekOf(p.updatedDate);
    byWeek[weekKey] = (byWeek[weekKey] || 0) + 1;
  });

  el('kpiTotal').textContent = feats.length;
  el('kpiActive').textContent = byStatus.active || 0;
  el('kpiMaintenance').textContent = byStatus.maintenance || 0;
  el('kpiCritical').textContent = feats.filter((f) => f.properties.priority === 'critical').length;

  drawChart('categoryChart', 'bar', {
    labels: Object.keys(byCategory).map((k) => CATEGORY_SCHEMA[k]?.label || k),
    datasets: [{ data: Object.values(byCategory), backgroundColor: Object.keys(byCategory).map((k) => CATEGORY_SCHEMA[k]?.color) }],
  }, { plugins: { legend: { display: false } } });

  drawChart('statusChart', 'pie', {
    labels: Object.keys(byStatus).map((k) => STATUS_SCHEMA[k]?.label || k),
    datasets: [{ data: Object.values(byStatus), backgroundColor: Object.keys(byStatus).map((k) => STATUS_SCHEMA[k]?.color) }],
  });

  const weeks = Object.keys(byWeek).sort();
  drawChart('trendChart', 'line', {
    labels: weeks,
    datasets: [{ label: 'Updates', data: weeks.map((w) => byWeek[w]), borderColor: '#3fa9f5', backgroundColor: 'rgba(63,169,245,0.15)', fill: true, tension: 0.3 }],
  }, { plugins: { legend: { display: false } } });

  // Area chart (Chart.js renders area charts as filled+stacked line charts —
  // there's no separate "area" chart type, this is the standard way to build
  // one): cumulative asset count by status, week over week.
  const statusKeys = Object.keys(STATUS_SCHEMA);
  // Build a true cumulative series: for each week, how many of each status
  // had been created by that week (approximated from createdDate, falling
  // back to updatedDate for older demo data that predates a createdDate).
  const weeklyNew = Object.fromEntries(statusKeys.map((s) => [s, weeks.map(() => 0)]));
  feats.forEach((f) => {
    const p = f.properties;
    const wk = weekOf(p.createdDate || p.updatedDate);
    const idx = weeks.indexOf(wk);
    if (idx >= 0 && weeklyNew[p.status]) weeklyNew[p.status][idx]++;
  });
  const cumulativeSeries = Object.fromEntries(statusKeys.map((s) => {
    let running = 0;
    return [s, weeklyNew[s].map((n) => (running += n))];
  }));
  drawChart('areaChart', 'line', {
    labels: weeks,
    datasets: statusKeys.map((s) => ({
      label: STATUS_SCHEMA[s].label,
      data: cumulativeSeries[s],
      borderColor: STATUS_SCHEMA[s].color,
      backgroundColor: `${STATUS_SCHEMA[s].color}33`,
      fill: true,
      tension: 0.25,
      pointRadius: 0,
    })),
  }, { scales: { x: { ticks: { color: '#8b93a1' }, stacked: true }, y: { ticks: { color: '#8b93a1' }, stacked: true } } });
}

function weekOf(dateStr) {
  const d = new Date(dateStr);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function drawChart(canvasId, type, data, extraOptions = {}) {
  const ctx = el(canvasId).getContext('2d');
  charts[canvasId]?.destroy();
  charts[canvasId] = new Chart(ctx, {
    type, data,
    options: { responsive: true, maintainAspectRatio: false, color: '#c9d1e0', scales: type === 'pie' ? {} : { x: { ticks: { color: '#8b93a1' } }, y: { ticks: { color: '#8b93a1' } } }, ...extraOptions },
  });
}
