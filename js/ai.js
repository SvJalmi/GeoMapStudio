// ============================================================================
// GeoMap Studio — ai.js
// Rule-based "AI Insights" — deliberately transparent, explainable heuristics
// rather than an opaque model, so every flagged item can be justified:
//   • Map Summary: a plain-language rollup of the current dataset.
//   • Duplicate Detection: same category + name similarity + within ~30m.
//   • Predictive Maintenance: risk score from age-since-update, status and priority.
//   • Smart Search: turns a typed sentence into a category/status filter.
// ============================================================================
import { store } from './store.js';
import { CATEGORY_SCHEMA, STATUS_SCHEMA, CATEGORY_EMOJI } from './config.js';
import { highlightAssetById } from './overlap.js';
import { showAssetDetail } from './assets.js';

function el(id) { return document.getElementById(id); }

export function initAIPanel() {
  el('aiToggleBtn').addEventListener('click', () => {
    el('aiPanel').classList.toggle('open');
    if (el('aiPanel').classList.contains('open')) refreshAll();
  });
  el('aiCloseBtn').addEventListener('click', () => el('aiPanel').classList.remove('open'));
  el('aiRefreshBtn').addEventListener('click', refreshAll);
  el('aiSmartSearchBtn').addEventListener('click', runSmartSearch);
  el('aiSmartSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSmartSearch(); });
  store.addEventListener('assets:changed', () => { if (el('aiPanel').classList.contains('open')) refreshAll(); });
}

function refreshAll() {
  renderSummary();
  renderDuplicates();
  renderMaintenance();
}

function daysSince(dateStr) {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ---- Map Summary -----------------------------------------------------
function renderSummary() {
  const feats = [...store.assets.values()];
  const byStatus = {};
  const byCategory = {};
  feats.forEach((f) => {
    byStatus[f.properties.status] = (byStatus[f.properties.status] || 0) + 1;
    byCategory[f.properties.category] = (byCategory[f.properties.category] || 0) + 1;
  });
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const critical = feats.filter((f) => f.properties.priority === 'critical').length;
  const staleCount = feats.filter((f) => daysSince(f.properties.updatedDate) > 180).length;

  el('aiSummary').innerHTML = `
    <p>This dataset currently tracks <b>${feats.length} assets</b> across <b>${Object.keys(byCategory).length} categories</b>.
    The most common type is <b>${CATEGORY_SCHEMA[topCategory?.[0]]?.label || '—'}</b> (${topCategory?.[1] || 0} assets).</p>
    <p><b>${byStatus.active || 0}</b> are active, <b>${byStatus.maintenance || 0}</b> are under maintenance,
    and <b>${critical}</b> are flagged critical priority.</p>
    <p>${staleCount} asset(s) haven't been updated in over 6 months and may be worth a field check.</p>
  `;
}

// ---- Duplicate Detection ----------------------------------------------
function nameSimilarity(a, b) {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return 1;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (!longer.length) return 0;
  return longer.includes(shorter) ? shorter.length / longer.length : 0;
}
function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180, lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function centroidOf(f) {
  return f.geometry.type === 'Point' ? f.geometry.coordinates
    : f.geometry.type === 'LineString' ? f.geometry.coordinates[0]
    : f.geometry.coordinates[0][0];
}

function findDuplicates() {
  const feats = [...store.assets.values()];
  const pairs = [];
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      const a = feats[i], b = feats[j];
      if (a.properties.category !== b.properties.category) continue;
      const dist = haversineMeters(centroidOf(a), centroidOf(b));
      if (dist > 50) continue;
      const sim = nameSimilarity(a.properties.name, b.properties.name);
      if (sim > 0.6 || dist < 5) {
        pairs.push({ a, b, dist, sim });
      }
    }
  }
  return pairs.sort((x, y) => (y.sim - x.sim) || (x.dist - y.dist));
}

function renderDuplicates() {
  const pairs = findDuplicates();
  const list = el('aiDuplicates');
  if (!pairs.length) { list.innerHTML = `<div class="empty-state">No likely duplicates found.</div>`; return; }
  list.innerHTML = pairs.slice(0, 20).map((p, i) => `
    <div class="ai-row" data-i="${i}">
      <div class="ai-row-title">${CATEGORY_EMOJI[p.a.properties.category] || ''} ${p.a.properties.name} <span class="ai-vs">↔</span> ${p.b.properties.name}</div>
      <div class="ai-row-sub">${p.dist.toFixed(0)}m apart · name similarity ${(p.sim * 100).toFixed(0)}%</div>
    </div>`).join('');
  list.querySelectorAll('.ai-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      const p = pairs[i];
      highlightAssetById(p.a.properties.id);
      showAssetDetail(p.a.properties.id);
    });
  });
}

// ---- Predictive Maintenance ---------------------------------------------
function riskScore(f) {
  const p = f.properties;
  const age = daysSince(p.updatedDate);
  const ageScore = Math.min(age / 365, 1) * 40;
  const priorityScore = { low: 5, medium: 15, high: 25, critical: 35 }[p.priority] || 10;
  const statusScore = { active: 0, maintenance: 15, inactive: 20, decommissioned: 0 }[p.status] || 0;
  const gpsScore = Math.min((p.gpsAccuracy || 0) / 10, 1) * 10;
  return Math.round(ageScore + priorityScore + statusScore + gpsScore);
}

function renderMaintenance() {
  const feats = [...store.assets.values()].filter((f) => f.properties.status !== 'decommissioned');
  const scored = feats.map((f) => ({ f, score: riskScore(f) })).sort((a, b) => b.score - a.score).slice(0, 12);
  const list = el('aiMaintenance');
  if (!scored.length) { list.innerHTML = `<div class="empty-state">Nothing to flag.</div>`; return; }
  list.innerHTML = scored.map(({ f, score }, i) => `
    <div class="ai-row" data-i="${i}">
      <div class="ai-row-title">${CATEGORY_EMOJI[f.properties.category] || ''} ${f.properties.name}</div>
      <div class="ai-risk-bar"><div class="ai-risk-fill" style="width:${score}%;background:${riskColor(score)}"></div></div>
      <div class="ai-row-sub">Risk score ${score}/100 · last updated ${f.properties.updatedDate}</div>
    </div>`).join('');
  list.querySelectorAll('.ai-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      highlightAssetById(scored[i].f.properties.id);
      showAssetDetail(scored[i].f.properties.id);
    });
  });
}
function riskColor(score) { return score > 65 ? '#f5586b' : score > 35 ? '#f5c542' : '#3ddc84'; }

// ---- Smart Search: "show all damaged pipelines" style natural queries ---
function runSmartSearch() {
  const q = el('aiSmartSearchInput').value.toLowerCase();
  if (!q.trim()) return;
  store.clearFilters();
  Object.entries(CATEGORY_SCHEMA).forEach(([key, def]) => {
    if (q.includes(key.replace('_', ' ')) || q.includes(def.label.toLowerCase()) || q.includes(def.label.toLowerCase() + 's')) {
      store.filters.categories.add(key);
    }
  });
  Object.entries(STATUS_SCHEMA).forEach(([key, def]) => {
    if (q.includes(key) || q.includes(def.label.toLowerCase())) store.filters.statuses.add(key);
  });
  if (q.includes('damaged') || q.includes('broken') || q.includes('fault')) store.filters.statuses.add('maintenance');
  if (q.includes('critical') || q.includes('urgent')) store.filters.priorities.add('critical');
  store.emit('filters:changed');
  const count = store.getVisibleAssets().length;
  el('aiSmartSearchResult').textContent = `${count} matching asset(s) now shown in the list and on the map.`;
}
