// ============================================================
// Admin archive page
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { esc, formatDate, formatDateFull, toast, debounce, projectCounts } from './utils.js';

let _all = [];

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = '/index.html';
  });

  document.getElementById('search').addEventListener('input', debounce(() => {
    const q = document.getElementById('search').value.toLowerCase();
    render(_all.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.business_name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    ));
  }, 250));

  await load();
}

async function load() {
  const grid = document.getElementById('archive-grid');
  grid.innerHTML = '<div class="loading">Loading…</div>';

  try {
    _all = await api.archive();
    render(_all);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

function render(clients) {
  const grid = document.getElementById('archive-grid');
  if (!clients.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">◎</div>
        <div class="empty-state__text">No archived clients.</div>
      </div>`;
    return;
  }

  grid.innerHTML = clients.map(c => `
    <div class="archive-card">
      <div class="archive-card__name">${esc(c.name)}</div>
      ${c.business_name ? `<div class="archive-card__business">${esc(c.business_name)}</div>` : ''}
      <div class="archive-card__meta">
        ${c.total_projects ?? 0} projects · ${c.completed_projects ?? 0} completed<br>
        ${c.archived_at ? `Archived ${formatDateFull(c.archived_at)}` : ''}
      </div>
      <div class="archive-card__actions">
        <a href="/client.html?id=${c.id}" class="btn btn--secondary btn--sm">View</a>
        <button class="btn btn--secondary btn--sm restore-btn" data-id="${c.id}">Restore</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', () => restoreClient(btn.dataset.id));
  });
}

async function restoreClient(id) {
  if (!confirm('Restore this client to active?')) return;
  try {
    await api.restoreClient(id);
    toast('Client restored.');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

init();
