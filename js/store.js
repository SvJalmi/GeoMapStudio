// ============================================================================
// GeoMap Studio — store.js
// A tiny pub/sub store. Every module reads/writes asset data through here
// instead of touching the map or each other directly, so features stay
// decoupled: the asset list, the filters, the map layers and the AI panel
// all just react to 'assets:changed' / 'filters:changed' / 'selection:changed'.
// ============================================================================

class Store extends EventTarget {
  constructor() {
    super();
    this.assets = new Map();      // id -> GeoJSON Feature
    this.selectedIds = new Set(); // multi-select in the asset list
    this.filters = {
      categories: new Set(),   // empty set == "all categories"
      statuses: new Set(),
      priorities: new Set(),
      owners: new Set(),
      cities: new Set(),
      search: '',
      dateFrom: null,
      dateTo: null,
      timelineCutoff: null, // "as of" date from the Timeline panel (compares against createdDate)
    };
    this.history = []; // undo stack of {type, before, after}
    this.future = [];  // redo stack
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ---- bulk load -----------------------------------------------------
  loadCollection(fc) {
    this.assets.clear();
    fc.features.forEach((f) => this.assets.set(f.properties.id, f));
    this.emit('assets:changed');
  }

  toFeatureCollection(ids = null) {
    const feats = ids ? ids.map((id) => this.assets.get(id)).filter(Boolean) : [...this.assets.values()];
    return { type: 'FeatureCollection', features: feats };
  }

  // ---- CRUD ------------------------------------------------------------
  addAsset(feature, { record = true } = {}) {
    this.assets.set(feature.properties.id, feature);
    if (record) this.pushHistory({ type: 'add', after: structuredClone(feature) });
    this.emit('assets:changed', { reason: 'add', id: feature.properties.id });
  }

  updateAsset(id, patch, { record = true } = {}) {
    const before = this.assets.get(id);
    if (!before) return;
    const beforeClone = structuredClone(before);
    const after = structuredClone(before);
    Object.assign(after.properties, patch.properties || {});
    if (patch.geometry) after.geometry = patch.geometry;
    after.properties.updatedDate = new Date().toISOString().slice(0, 10);
    this.assets.set(id, after);
    if (record) this.pushHistory({ type: 'update', before: beforeClone, after: structuredClone(after) });
    this.emit('assets:changed', { reason: 'update', id });
  }

  deleteAsset(id, { record = true } = {}) {
    const before = this.assets.get(id);
    if (!before) return;
    this.assets.delete(id);
    this.selectedIds.delete(id);
    if (record) this.pushHistory({ type: 'delete', before: structuredClone(before) });
    this.emit('assets:changed', { reason: 'delete', id });
    this.emit('selection:changed');
  }

  deleteMany(ids) {
    ids.forEach((id) => this.deleteAsset(id, { record: false }));
    this.emit('assets:changed', { reason: 'bulk-delete' });
  }

  // ---- undo / redo -------------------------------------------------------
  pushHistory(entry) {
    this.history.push(entry);
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    this.future.push(entry);
    if (entry.type === 'add') this.assets.delete(entry.after.properties.id);
    if (entry.type === 'delete') this.assets.set(entry.before.properties.id, entry.before);
    if (entry.type === 'update') this.assets.set(entry.before.properties.id, entry.before);
    this.emit('assets:changed', { reason: 'undo' });
    return true;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    this.history.push(entry);
    if (entry.type === 'add') this.assets.set(entry.after.properties.id, entry.after);
    if (entry.type === 'delete') this.assets.delete(entry.before.properties.id);
    if (entry.type === 'update') this.assets.set(entry.after.properties.id, entry.after);
    this.emit('assets:changed', { reason: 'redo' });
    return true;
  }

  // ---- selection (multi-select) ------------------------------------
  toggleSelected(id, exclusive = false) {
    if (exclusive) {
      this.selectedIds.clear();
      this.selectedIds.add(id);
    } else if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.emit('selection:changed');
  }

  setSelection(ids) {
    this.selectedIds = new Set(ids);
    this.emit('selection:changed');
  }

  clearSelection() {
    this.selectedIds.clear();
    this.emit('selection:changed');
  }

  // ---- filters (multi-select by type, status, etc.) --------------------
  toggleFilter(kind, value) {
    const set = this.filters[kind];
    if (set.has(value)) set.delete(value); else set.add(value);
    this.emit('filters:changed');
  }

  setSearch(term) {
    this.filters.search = term.trim().toLowerCase();
    this.emit('filters:changed');
  }

  setDateRange(from, to) {
    this.filters.dateFrom = from;
    this.filters.dateTo = to;
    this.emit('filters:changed');
  }

  clearFilters() {
    this.filters.categories.clear();
    this.filters.statuses.clear();
    this.filters.priorities.clear();
    this.filters.owners.clear();
    this.filters.cities.clear();
    this.filters.search = '';
    this.filters.dateFrom = null;
    this.filters.dateTo = null;
    this.filters.timelineCutoff = null;
    this.emit('filters:changed');
  }

  // Returns the list of assets that currently pass all active filters.
  getVisibleAssets() {
    const { categories, statuses, priorities, owners, cities, search, dateFrom, dateTo, timelineCutoff } = this.filters;
    return [...this.assets.values()].filter((f) => {
      const p = f.properties;
      if (categories.size && !categories.has(p.category)) return false;
      if (statuses.size && !statuses.has(p.status)) return false;
      if (priorities.size && !priorities.has(p.priority)) return false;
      if (owners.size && !owners.has(p.owner)) return false;
      if (cities.size && !cities.has(p.city)) return false;
      if (dateFrom && p.updatedDate < dateFrom) return false;
      if (dateTo && p.updatedDate > dateTo) return false;
      if (timelineCutoff && p.createdDate > timelineCutoff) return false;
      if (search) {
        const hay = `${p.id} ${p.name} ${p.category} ${p.type || ''} ${p.owner} ${p.description ?? p.notes ?? ''}`.toLowerCase();
        if (!fuzzyMatch(search, hay)) return false;
      }
      return true;
    });
  }
}

// Very small fuzzy matcher: every character of the query must appear in
// order somewhere in the haystack, OR the haystack contains the query as a
// straight substring (which covers the common case cheaply).
export function fuzzyMatch(query, hay) {
  if (hay.includes(query)) return true;
  let qi = 0;
  for (let i = 0; i < hay.length && qi < query.length; i++) {
    if (hay[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

export const store = new Store();
