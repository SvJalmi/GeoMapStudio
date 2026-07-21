// ============================================================================
// GeoMap Studio — filters.js
// The "Advanced Filters" flyout: multi-select checkboxes for status, priority
// and owner, plus a last-updated date range. Category filtering itself lives
// in sidebar-list.js as chips (the primary, most-used multi-select); this
// panel covers the rest of the roadmap's "Advanced Filters" requirement.
// ============================================================================
import { store } from './store.js';
import { STATUS_SCHEMA, PRIORITY_SCHEMA, OWNERS, CITIES } from './config.js';

function el(id) { return document.getElementById(id); }

export function initFilterPanel() {
  buildGroup('filterStatusGroup', 'statuses', Object.entries(STATUS_SCHEMA).map(([k, v]) => [k, v.label]));
  buildGroup('filterPriorityGroup', 'priorities', Object.entries(PRIORITY_SCHEMA).map(([k, v]) => [k, v.label]));
  buildGroup('filterOwnerGroup', 'owners', OWNERS.map((o) => [o, o]));
  buildGroup('filterCityGroup', 'cities', CITIES.map((c) => [c, c]));

  el('filterToggleBtn').addEventListener('click', () => el('filterPanel').classList.toggle('open'));
  el('filterCloseBtn').addEventListener('click', () => el('filterPanel').classList.remove('open'));
  el('filterDateFrom').addEventListener('change', applyDateRange);
  el('filterDateTo').addEventListener('change', applyDateRange);
  el('filterResetBtn').addEventListener('click', () => {
    store.clearFilters();
    el('filterDateFrom').value = '';
    el('filterDateTo').value = '';
    refreshChecks();
  });
  store.addEventListener('filters:changed', () => { refreshChecks(); updateBadge(); });
  updateBadge();
}

function buildGroup(containerId, filterKey, entries) {
  const container = el(containerId);
  container.innerHTML = entries.map(([value, label]) => `
    <label class="filter-check">
      <input type="checkbox" data-key="${filterKey}" data-value="${value}"/> ${label}
    </label>`).join('');
  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => store.toggleFilter(filterKey, input.dataset.value));
  });
}

function refreshChecks() {
  document.querySelectorAll('#filterPanel input[type="checkbox"]').forEach((input) => {
    input.checked = store.filters[input.dataset.key].has(input.dataset.value);
  });
}

function applyDateRange() {
  store.setDateRange(el('filterDateFrom').value || null, el('filterDateTo').value || null);
}

function updateBadge() {
  const { categories, statuses, priorities, owners, cities, dateFrom, dateTo } = store.filters;
  const count = categories.size + statuses.size + priorities.size + owners.size + cities.size + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const badge = el('filterBadge');
  badge.textContent = count || '';
  badge.style.display = count ? '' : 'none';
}
