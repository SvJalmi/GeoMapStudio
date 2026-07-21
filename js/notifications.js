// ============================================================================
// GeoMap Studio — notifications.js
// Toasts for immediate feedback + a persistent notification center (bell
// icon) so alerts like geofence breaches or duplicate-detector hits aren't
// missed if the person wasn't looking at the corner of the screen.
// ============================================================================
const log = [];

function el(id) { return document.getElementById(id); }

export function initNotifications() {
  el('notifBell').addEventListener('click', () => el('notifPanel').classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!el('notifPanel').contains(e.target) && e.target !== el('notifBell') && !el('notifBell').contains(e.target)) {
      el('notifPanel').classList.remove('open');
    }
  });
  el('notifClearAll').addEventListener('click', () => { log.length = 0; renderPanel(); });
}

export function pushNotification(message, kind = 'info', timeoutMs = 4000) {
  log.unshift({ message, kind, time: new Date() });
  if (log.length > 50) log.pop();
  renderPanel();
  renderToast(message, kind, timeoutMs);
}

function renderToast(message, kind, timeoutMs) {
  const container = el('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, timeoutMs);
}

function renderPanel() {
  const badge = el('notifBadge');
  badge.textContent = log.length ? String(log.length) : '';
  badge.style.display = log.length ? '' : 'none';

  const body = el('notifList');
  if (!log.length) { body.innerHTML = `<div class="empty-state">No notifications yet.</div>`; return; }
  body.innerHTML = log.map((n) => `
    <div class="notif-row notif-${n.kind}">
      <span class="notif-dot"></span>
      <span class="notif-msg">${n.message}</span>
      <span class="notif-time">${n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>`).join('');
}
