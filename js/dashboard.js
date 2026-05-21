// ============================================================
// Admin dashboard — client card grid with search/filter
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t }                     from './t.js';
import { esc, formatDate, statusClass, toast,
         openModal, closeModal, debounce, projectCounts } from './utils.js';

let _clients = [];

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = '/index.html';
  });

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on backdrop click
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  document.getElementById('new-client-btn').addEventListener('click', () => openModal('modal-create-client'));
  document.getElementById('cc-save-btn').addEventListener('click', createClient);

  document.getElementById('search').addEventListener('input', debounce(loadClients, 250));
  document.getElementById('filter-status').addEventListener('change', loadClients);
  document.getElementById('filter-lang').addEventListener('change',   loadClients);

  await loadClients();
}

async function loadClients() {
  const search = document.getElementById('search').value.trim();
  const status = document.getElementById('filter-status').value;
  const lang   = document.getElementById('filter-lang').value;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (lang)   params.set('lang',   lang);

  const qs = params.toString() ? `?${params}` : '';

  const grid = document.getElementById('clients-grid');
  grid.innerHTML = '<div class="loading">Loading…</div>';

  try {
    _clients = await api.clients(qs);
    renderClients(_clients);
    updateSubtitle(_clients.length);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

function updateSubtitle(count) {
  document.getElementById('page-subtitle').textContent = `${count} client${count !== 1 ? 's' : ''}`;
}

function renderClients(clients) {
  const grid = document.getElementById('clients-grid');
  if (!clients.length) {
    const isFiltered = document.getElementById('search').value ||
                       document.getElementById('filter-status').value;
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state__icon">◎</div>
        <div class="empty-state__text">${isFiltered ? t('no_clients_search') : t('no_clients')}</div>
      </div>`;
    return;
  }

  grid.innerHTML = clients.map(c => clientCardHTML(c)).join('');

  // Wire up action buttons (stop propagation so card click doesn't fire)
  grid.querySelectorAll('.contact-btn').forEach(btn => {
    btn.addEventListener('click', e => e.stopPropagation());
  });
}

function clientCardHTML(c) {
  const active    = c.active_projects    ?? 0;
  const completed = c.completed_projects ?? 0;
  const total     = c.total_projects     ?? 0;
  const langLabel = c.language_preference === 'pt' ? 'PT' : 'EN';

  const phone    = c.phone    ? `<a href="tel:${esc(c.phone.replace(/\s/g,''))}" class="btn btn--sm btn-call contact-btn" title="Call">📞 Call</a>` : '';
  const wa       = c.whatsapp ? `<a href="https://wa.me/${esc(c.whatsapp.replace(/[\s\-\(\)\+]/g,''))}" target="_blank" class="btn btn--sm btn-wa contact-btn" title="WhatsApp">💬 WhatsApp</a>` : '';
  const email    = c.email    ? `<a href="mailto:${esc(c.email)}" class="btn btn--sm btn-email contact-btn" title="Email">✉ Email</a>` : '';

  return `
    <a href="/client.html?id=${c.id}" class="client-card">
      <div class="client-card__header">
        <div style="flex:1; min-width:0;">
          <div class="client-card__name">${esc(c.name)}</div>
          ${c.business_name ? `<div class="client-card__business">${esc(c.business_name)}</div>` : ''}
        </div>
        <div class="client-card__badges">
          <span class="lang-badge">${langLabel}</span>
        </div>
      </div>

      <div>
        <span class="badge ${statusClass(c.overall_status)}">${esc(c.overall_status)}</span>
      </div>

      <div class="client-card__actions">
        ${phone}${wa}${email}
      </div>

      <div class="client-card__meta">
        <span>${active} ${t('active_projects')}</span>
        <span class="meta-dot">·</span>
        <span>${completed} ${t('completed_projects')}</span>
        ${c.updated_at ? `<span class="meta-dot">·</span><span>${formatDate(c.updated_at)}</span>` : ''}
      </div>
    </a>`;
}

async function createClient() {
  const btn = document.getElementById('cc-save-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const data = {
      name:                document.getElementById('cc-name').value.trim(),
      business_name:       document.getElementById('cc-business').value.trim()  || null,
      email:               document.getElementById('cc-email').value.trim()     || null,
      language_preference: document.getElementById('cc-lang').value,
      phone:               document.getElementById('cc-phone').value.trim()     || null,
      whatsapp:            document.getElementById('cc-whatsapp').value.trim()  || null,
      website:             document.getElementById('cc-website').value.trim()   || null,
      overall_status:      document.getElementById('cc-status').value.trim()    || 'active',
      address:             document.getElementById('cc-address').value.trim()   || null,
      contact_notes:       document.getElementById('cc-notes').value.trim()     || null,
    };

    if (!data.name) { toast('Contact name is required.', 'error'); return; }

    const client = await api.createClient(data);
    closeModal('modal-create-client');
    clearCreateForm();
    toast('Client created.');
    window.location.href = `/client.html?id=${client.id}`;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Client';
  }
}

function clearCreateForm() {
  ['cc-name','cc-business','cc-email','cc-phone','cc-whatsapp',
   'cc-website','cc-address','cc-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('cc-status').value = 'active';
  document.getElementById('cc-lang').value   = 'en';
}

init();
