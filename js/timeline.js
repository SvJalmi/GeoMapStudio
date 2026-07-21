// ============================================================================
// GeoMap Studio — timeline.js
// A date-range "as of" slider: dragging it (or hitting Play) filters the map
// and asset list down to only the assets created on/before that date, which
// is the same store.filters mechanism as everything else — so it composes
// correctly with category chips and advanced filters instead of fighting them.
// ============================================================================
import { store } from './store.js';

let minDate, maxDate;
let playing = false;
let playTimer = null;

function el(id) { return document.getElementById(id); }
function toDay(d) { return Math.floor(new Date(d).getTime() / 86400000); }
function fromDay(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }

export function initTimeline() {
  computeRange();
  const slider = el('timelineSlider');
  slider.min = minDate;
  slider.max = maxDate;
  slider.value = maxDate;
  updateLabel();

  slider.addEventListener('input', () => { applyAsOf(parseInt(slider.value, 10)); });
  el('timelinePlayBtn').addEventListener('click', togglePlay);
  el('timelineResetBtn').addEventListener('click', () => { slider.value = maxDate; applyAsOf(maxDate); stopPlay(); });
  el('timelineToggleBtn').addEventListener('click', () => el('timelinePanel').classList.toggle('open'));
  el('timelineCloseBtn').addEventListener('click', () => el('timelinePanel').classList.remove('open'));

  store.addEventListener('assets:changed', () => { computeRange(); slider.min = minDate; slider.max = maxDate; });
}

function computeRange() {
  const dates = [...store.assets.values()].map((f) => toDay(f.properties.createdDate));
  minDate = dates.length ? Math.min(...dates) : toDay(new Date());
  maxDate = dates.length ? Math.max(...dates) : toDay(new Date());
}

function updateLabel() {
  el('timelineDateLabel').textContent = `As of ${fromDay(parseInt(el('timelineSlider').value, 10))}`;
}

function applyAsOf(day) {
  store.filters.timelineCutoff = fromDay(day);
  store.emit('filters:changed');
  updateLabel();
}

function togglePlay() {
  playing = !playing;
  el('timelinePlayBtn').textContent = playing ? '⏸ Pause' : '▶ Play';
  if (playing) {
    playTimer = setInterval(() => {
      const slider = el('timelineSlider');
      let next = parseInt(slider.value, 10) + 1;
      if (next > maxDate) next = minDate;
      slider.value = next;
      applyAsOf(next);
    }, 400);
  } else {
    stopPlay();
  }
}
function stopPlay() {
  playing = false;
  el('timelinePlayBtn').textContent = '▶ Play';
  clearInterval(playTimer);
}
