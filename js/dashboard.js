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
    await signOut(); window.location.href = '/resonate-portal/index.html';
  });

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on backdrop click (except temp-pw — must click Done)
  document.querySelectorAll('.modal').forEach(m => {
    if (m.id === 'modal-temp-password') return; // force user to click Done
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  document.getElementById('new-client-btn').addEventListener('click', () => openModal('modal-create-client'));
  document.getElementById('cc-save-btn').addEventListener('click', createClient);

  document.getElementById('search').addEventListener('input', debounce(loadClients, 250));
  document.getElementById('filter-status').addEventListener('change', loadClients);
  document.getElementById('filter-lang').addEventListener('change',   loadClients);

  await loadClients();
  initZohoCard();
}

// ---- Zoho Invoice integration card ----
async function initZohoCard() {
  const statusText    = document.getElementById('zoho-status-text');
  const connectBtn    = document.getElementById('zoho-connect-btn');
  const disconnectBtn = document.getElementById('zoho-disconnect-btn');
  if (!statusText) return;

  // Result of an OAuth round-trip (the Worker callback redirects back here)
  const params = new URLSearchParams(window.location.search);
  const result = params.get('zoho');
  if (result) {
    const messages = {
      connected:             'Zoho Invoice connected successfully.',
      connected_no_org:      'Zoho connected, but no organization found — contact support.',
      denied:                'Zoho authorization was cancelled.',
      state_mismatch:        'Zoho authorization failed a security check. Please try again.',
      token_exchange_failed: 'Zoho did not accept the authorization. Please try again.',
      error:                 'Zoho connection failed. Please try again.',
    };
    toast(messages[result] || messages.error, result.startsWith('connected') ? 'success' : 'error');
    params.delete('zoho');
    const qs = params.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  }

  async function refresh() {
    try {
      const s = await api.zohoStatus();
      connectBtn.classList.add('hidden');
      disconnectBtn.classList.add('hidden');
      if (!s.configured) {
        statusText.textContent = 'Awaiting Zoho API credentials (Worker secrets not set yet).';
      } else if (s.connected) {
        statusText.textContent = 'Connected' +
          (s.organization_id ? ` · organization ${s.organization_id}` : '') +
          (s.connected_at ? ` · since ${formatDate(s.connected_at)}` : '');
        disconnectBtn.classList.remove('hidden');
      } else {
        statusText.textContent = 'Not connected. Invoices will appear here once you authorize Zoho.';
        connectBtn.classList.remove('hidden');
        connectBtn.classList.add('flex');
      }
    } catch (err) {
      statusText.textContent = 'Connection status unavailable right now.';
    }
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    try {
      const { url } = await api.zohoOAuthStart();
      window.location.href = url;   // off to Zoho's hosted consent screen
    } catch (err) {
      toast(err.status === 409
        ? 'Zoho credentials are not set on the server yet.'
        : 'Could not start Zoho authorization.', 'error');
      connectBtn.disabled = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect Zoho Invoice? Invoice sync will stop until you reconnect.')) return;
    try {
      await api.zohoDisconnect();
      toast('Zoho Invoice disconnected.', 'success');
    } catch (err) {
      toast('Could not disconnect Zoho.', 'error');
    }
    refresh();
  });

  await refresh();
}

function showSkeletons(grid, count = 5) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-line skeleton-line--lg"></div>
      <div class="skeleton-line skeleton-line--sm" style="margin-top:14px;"></div>
      <div class="skeleton-line skeleton-line--xs" style="margin-top:6px;"></div>
      <div style="display:flex;gap:8px;margin-top:18px;">
        <div class="skeleton-line" style="width:70px;height:28px;border-radius:9999px;margin-bottom:0;"></div>
        <div class="skeleton-line" style="width:80px;height:28px;border-radius:9999px;margin-bottom:0;"></div>
      </div>
    </div>`).join('');
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
  // Show skeletons immediately — never a blank screen
  showSkeletons(grid, 5);

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

  // Render first 5 immediately, then append the rest after paint
  const first = clients.slice(0, 5);
  const rest  = clients.slice(5);

  grid.innerHTML = first.map(c => clientCardHTML(c)).join('');
  wireContactBtns(grid);

  if (rest.length) {
    const append = () => {
      const frag = document.createDocumentFragment();
      rest.forEach(c => {
        const div = document.createElement('div');
        div.innerHTML = clientCardHTML(c);
        frag.appendChild(div.firstElementChild);
      });
      grid.appendChild(frag);
      wireContactBtns(grid);
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(append, { timeout: 500 });
    } else {
      setTimeout(append, 0);
    }
  }
}

function wireContactBtns(grid) {
  grid.querySelectorAll('.contact-btn').forEach(btn => {
    // Remove old listener before re-adding to avoid duplicates on re-render
    btn.replaceWith(btn.cloneNode(true));
  });
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
    <a href="/resonate-portal/client.html?id=${c.id}" class="client-card">
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

// Build full international phone number from country-code select + number input
function buildPhone(ccId, numId) {
  const cc  = document.getElementById(ccId)?.value || '';
  const num = document.getElementById(numId)?.value.trim().replace(/\D/g, '') || '';
  if (!num) return null;
  return cc + num;
}

async function createClient() {
  const btn = document.getElementById('cc-save-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const firstName = document.getElementById('cc-first-name').value.trim();
    const lastName  = document.getElementById('cc-last-name').value.trim();
    // Auto-fill contact name if left blank
    const nameField = document.getElementById('cc-name');
    if (!nameField.value.trim() && (firstName || lastName)) {
      nameField.value = [firstName, lastName].filter(Boolean).join(' ');
    }

    const data = {
      name:                nameField.value.trim(),
      first_name:          firstName || null,
      last_name:           lastName  || null,
      business_name:       document.getElementById('cc-business').value.trim()  || null,
      email:               document.getElementById('cc-email').value.trim()     || null,
      language_preference: document.getElementById('cc-lang').value,
      phone:               buildPhone('cc-phone-cc', 'cc-phone-num'),
      whatsapp:            buildPhone('cc-wa-cc',    'cc-wa-num'),
      website:             document.getElementById('cc-website').value.trim()   || null,
      overall_status:      document.getElementById('cc-status').value.trim()    || 'active',
      address:             document.getElementById('cc-address').value.trim()   || null,
      contact_notes:       document.getElementById('cc-notes').value.trim()     || null,
    };

    if (!data.name) { toast('Contact name is required.', 'error'); btn.disabled = false; btn.textContent = 'Create Client'; return; }

    const res = await api.createClient(data);
    const client = res.client || res; // worker now returns { client, temp_password }
    closeModal('modal-create-client');
    clearCreateForm();

    if (res.temp_password) {
      showTempPasswordModal(res.temp_password, client, data.email, data.whatsapp, data.language_preference);
    } else {
      toast('Client created.');
      window.location.href = `/resonate-portal/client.html?id=${client.id}`;
    }
  } catch (err) {
    toast(err.message, 'error');
    const btn2 = document.getElementById('cc-save-btn');
    btn2.disabled = false;
    btn2.textContent = 'Create Client';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Client';
  }
}

function showTempPasswordModal(tempPw, client, email, whatsapp, lang) {
  document.getElementById('temp-pw-display').textContent = tempPw;

  // Copy button
  document.getElementById('temp-pw-copy-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(tempPw);
      document.getElementById('temp-pw-copy-btn').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('temp-pw-copy-btn').textContent = 'Copy Password'; }, 1800);
    } catch {}
  };

  // Done button — show send-welcome modal
  document.getElementById('temp-pw-done-btn').onclick = () => {
    closeModal('modal-temp-password');
    showSendWelcomeModal(client, email, whatsapp, lang, tempPw);
  };

  openModal('modal-temp-password');
}

function showSendWelcomeModal(client, email, whatsapp, lang, tempPw) {
  const name      = client.name || 'there';
  const firstName = name.trim().split(/\s+/)[0];
  const portalUrl = `https://farfromtimnah-hue.github.io/resonate-portal/portal.html`;

  const msgEn = `Hi ${firstName}! We're so glad you're here. Your Resonate portal is ready and waiting for you. Log in here: ${portalUrl} — Email: ${email || ''} / Temporary password: ${tempPw}. Can't wait to get started together!`;
  const msgPt = `Oi ${firstName}! Tudo bem? Que alegria ter você aqui! Seu portal Resonate está prontinho te esperando. Acesse aqui: ${portalUrl} — E-mail: ${email || ''} / Senha temporária: ${tempPw}. Mal podemos esperar para começar essa jornada juntos!`;

  const msg = lang === 'pt' ? msgPt : msgEn;

  document.getElementById('welcome-msg-preview').value = msg;

  // WhatsApp button — opens wa.me with pre-filled message
  const waBtn = document.getElementById('welcome-wa-btn');
  if (whatsapp) {
    const waNum = whatsapp.replace(/\D/g, '');
    waBtn.href = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
    waBtn.style.display = '';
  } else {
    waBtn.style.display = 'none';
  }

  // Email button — opens mail client
  const emailBtn = document.getElementById('welcome-email-btn');
  if (email) {
    const subject = lang === 'pt' ? 'Seu portal Resonate está pronto!' : 'Your Resonate portal is ready!';
    // Get live textarea value so admin can edit before sending
    emailBtn.onclick = () => {
      const body = document.getElementById('welcome-msg-preview').value;
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    };
    emailBtn.removeAttribute('href');
    emailBtn.style.display = '';
  } else {
    emailBtn.style.display = 'none';
  }

  openModal('modal-send-welcome');

  // After closing: navigate to client page
  const closeHandler = () => {
    window.location.href = `/resonate-portal/client.html?id=${client.id}`;
  };
  document.getElementById('modal-send-welcome').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHandler();
  }, { once: true });
  // Also wire skip button
  document.querySelector('[data-close="modal-send-welcome"]').addEventListener('click', closeHandler, { once: true });
}

function clearCreateForm() {
  ['cc-first-name','cc-last-name','cc-name','cc-business','cc-email',
   'cc-phone-num','cc-wa-num','cc-website','cc-address','cc-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('cc-status').value = 'active';
  document.getElementById('cc-lang').value   = 'en';
}

init();
