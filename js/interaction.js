// ============================================================================
// GeoMap Studio — interaction.js
// A single shared flag so draw.js, measure.js and overlap.js (all of which
// listen to map 'click') can tell whether the click belongs to them right
// now, without importing each other and creating a circular dependency.
// ============================================================================
export const interactionState = { activeTool: null }; // null | 'draw' | 'measure'
export const interactionBus = new EventTarget();

// Call this instead of setting activeTool directly so the *other* tool gets
// a chance to reset its own button/UI state without the two modules having
// to import each other.
export function claimInteraction(tool) {
  interactionState.activeTool = tool;
  interactionBus.dispatchEvent(new CustomEvent('changed', { detail: tool }));
}
