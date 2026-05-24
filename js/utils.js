// ============================================================
// Shared utility functions
// ============================================================

// Format a date string as "May 20, 2025" or relative "2 days ago"
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateFull(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

// Get CSS class for a project status
export function statusClass(status) {
  const map = {
    not_started:         'status--gray',
    in_progress:         'status--blue',
    waiting_on_client:   'status--amber',
    v1_done:             'status--purple',
    updates_in_progress: 'status--cyan',
    completed:           'status--green',
  };
  return map[status] || 'status--gray';
}

// Escape HTML to prevent XSS
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert newlines to <br> (after escaping)
export function nl2br(str) {
  return esc(str).replace(/\n/g, '<br>');
}

// Show a temporary toast notification
export function toast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => el.classList.add('toast--visible'), 10);
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// Simple modal open/close
// Tracks the active Escape-key handler so it can be removed on close.
let _escHandler = null;

export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('modal--open');
  document.body.classList.add('no-scroll');

  // Move focus to the first interactive field for usability
  setTimeout(() => {
    const first = m.querySelector('input:not([type="hidden"]), select, textarea');
    if (first) first.focus();
  }, 50);

  // Register an Escape-only keydown handler.
  // Guard: bail immediately on ANY modifier key so Cmd+V, Cmd+C, etc. never close the modal.
  if (_escHandler) document.removeEventListener('keydown', _escHandler);
  _escHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return; // modifier → ignore completely
    if (e.key === 'Escape') closeModal(id);
  };
  document.addEventListener('keydown', _escHandler);
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('modal--open'); document.body.classList.remove('no-scroll'); }
  if (_escHandler) {
    document.removeEventListener('keydown', _escHandler);
    _escHandler = null;
  }
}

// Get URL query param
export function qp(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Build a tel: link
export function telLink(phone) {
  if (!phone) return '#';
  return `tel:${phone.replace(/\s/g, '')}`;
}

// Build a WhatsApp link
export function waLink(phone) {
  if (!phone) return '#';
  const clean = phone.replace(/[\s\-\(\)\+]/g, '');
  return `https://wa.me/${clean}`;
}

// Build mailto: link
export function mailtoLink(email) {
  if (!email) return '#';
  return `mailto:${email}`;
}

// Debounce
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Count projects by status
export function projectCounts(projects) {
  const counts = { total: projects.length, completed: 0, in_progress: 0, not_started: 0, waiting: 0 };
  projects.forEach(p => {
    if (p.status === 'completed') counts.completed++;
    else if (p.status === 'in_progress' || p.status === 'updates_in_progress' || p.status === 'v1_done') counts.in_progress++;
    else if (p.status === 'waiting_on_client') counts.waiting++;
    else counts.not_started++;
  });
  counts.active = counts.total - counts.completed;
  return counts;
}
