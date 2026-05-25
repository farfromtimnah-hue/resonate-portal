// ============================================================
// Client portal page — simplified, bilingual, read + comment only
// ============================================================

import { requireAuth, signOut, changePassword, setInitialPassword } from './auth.js';
import { api }                   from './api.js';
import { t, setLang, getLang, statusLabel } from './t.js';
import { esc, nl2br, formatDate, formatDateTime, toast, telLink, waLink, projectCounts,
         statusClass, openModal, closeModal } from './utils.js';

let _data    = null;
let _lang    = 'en';
let _profile = null;

async function init() {
  _profile = await requireAuth('client');
  if (!_profile) return;

  // Set language from user preference
  _lang = _profile.language_preference || 'en';
  setLang(_lang);
  updateLangButtons();

  // Sign out (header button)
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = '/resonate-portal/index.html';
  });

  document.getElementById('lang-en').addEventListener('click', () => switchLang('en'));
  document.getElementById('lang-pt').addEventListener('click', () => switchLang('pt'));
  document.getElementById('portal-send-btn').addEventListener('click', sendComment);

  // Change password modal wire-up
  document.getElementById('change-password-btn').addEventListener('click', openChangePasswordModal);
  document.querySelectorAll('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close))
  );
  document.getElementById('modal-change-password').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modal-change-password');
  });
  document.getElementById('cp-save-btn').addEventListener('click', submitChangePassword);

  // First-login: must_change_password
  if (_profile.must_change_password) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('first-login-panel').classList.remove('hidden');
    document.getElementById('first-login-save-btn').addEventListener('click', submitFirstLogin);
    return;   // don't load portal data until password is set
  }

  await loadData();
}

async function loadData() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');

  try {
    _data = await api.getClient(_profile.client_id);
    render();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading').textContent = `Error: ${err.message}`;
  }
}

// ---- Language ----

function switchLang(lang) {
  _lang = lang;
  setLang(lang);
  updateLangButtons();
  if (_data) renderContent();    // re-render bilingual content
  // Persist preference (best-effort)
  api.me().catch(() => {});
}

function updateLangButtons() {
  document.getElementById('lang-en').classList.toggle('lang-btn--active', _lang === 'en');
  document.getElementById('lang-pt').classList.toggle('lang-btn--active', _lang === 'pt');
}

// ---- Main render ----

function render() {
  const { client } = _data;
  document.title = `${client.name} — Resonate Portal`;

  // Header
  document.getElementById('portal-client-name').textContent = client.name;

  const biz = document.getElementById('portal-client-business');
  if (client.business_name) {
    biz.textContent = client.business_name;
    biz.classList.remove('hidden');
  }

  // Status badge in header
  const statusEl = document.getElementById('portal-status-badge');
  statusEl.innerHTML = `<span class="badge" style="background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.4);">${esc(client.overall_status)}</span>`;

  renderContent();
}

function renderContent() {
  const { client, projects, comments } = _data;

  // Progress
  renderProgress(projects);

  // Projects (links are rendered per-project inside the card)
  renderProjects(projects);

  // Comments
  renderComments(comments);

  // Contact actions
  renderContact(client);
}

// ---- Progress ----

function renderProgress(projects) {
  const counts = projectCounts(projects);
  const pct    = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  document.getElementById('portal-progress-counts').innerHTML = `
    <div class="progress-count">
      <div class="progress-count__number">${counts.total}</div>
      <div class="progress-count__label">${_lang === 'pt' ? 'Total' : 'Total'}</div>
    </div>
    <div class="progress-count">
      <div class="progress-count__number" style="color:var(--s-blue)">${counts.in_progress}</div>
      <div class="progress-count__label">${_lang === 'pt' ? 'Em andamento' : 'In Progress'}</div>
    </div>
    <div class="progress-count">
      <div class="progress-count__number" style="color:var(--s-green)">${counts.completed}</div>
      <div class="progress-count__label">${_lang === 'pt' ? 'Concluídos' : 'Complete'}</div>
    </div>`;

  document.getElementById('portal-progress-fill').style.width = `${pct}%`;
}

// ---- Projects ----

function renderProjects(projects) {
  const el = document.getElementById('portal-projects');

  const visible = projects.filter(p => p.is_client_visible !== 0);
  if (!visible.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__text">${t('portal_no_projects')}</div></div>`;
    return;
  }

  el.innerHTML = visible.map(p => {
    const projectLinks = (_data.links || []).filter(l => l.project_id === p.id && l.is_client_visible !== 0);
    return portalProjectCardHTML(p, projectLinks);
  }).join('');
}

function portalProjectCardHTML(p, projectLinks = []) {
  const desc   = _lang === 'pt' ? (p.description_pt     || p.description_en)     : (p.description_en     || p.description_pt);
  const future = _lang === 'pt' ? (p.future_features_pt || p.future_features_en) : (p.future_features_en || p.future_features_pt);

  const linkPills = projectLinks.map(l =>
    `<a href="${esc(l.url)}" target="_blank" class="resource-link resource-link--btn">${esc(linkDisplayLabel(l))} ↗</a>`
  ).join('');

  return `
    <div class="project-card">
      <div class="project-card__head">
        <span class="project-card__title">${esc(p.title)}</span>
        <span class="badge ${statusClass(p.status)}">${statusLabel(p.status)}</span>
      </div>

      ${desc ? `<div class="project-card__body">${nl2br(desc)}</div>` : ''}

      ${linkPills ? `<div class="project-card__links links-list">${linkPills}</div>` : ''}

      ${future ? `
        <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
          <div style="font-size:11px; font-weight:600; color:var(--text-3); text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">
            ${_lang === 'pt' ? 'Em Breve' : 'Coming Up'}
          </div>
          <div class="future-block">${nl2br(future)}</div>
        </div>` : ''}

      <div class="project-card__footer">
        <span class="text-muted">${_lang === 'pt' ? 'Atualizado' : 'Updated'} ${formatDate(p.updated_at)}</span>
        ${p.due_date ? `<span class="text-muted">${_lang === 'pt' ? 'Prazo' : 'Due'} ${formatDate(p.due_date)}</span>` : ''}
      </div>
    </div>`;
}

// ---- Portal links ----

function linkDisplayLabel(l) {
  // 1. Use explicit label if present and not blank
  if (l.label && l.label.trim()) return l.label.trim();

  // 2. Humanize link_type if it's not the catch-all "other"
  const typeMap = {
    live_site:       'Live Site',
    staging:         'Staging',
    test:            'Test Link',
    github_repo:     'GitHub Repo',
    github_project:  'GitHub Project',
    cloudflare:      'Cloudflare',
    admin:           'Admin Page',
    dashboard:       'Dashboard',
    automation:      'Automation Flow',
  };
  if (l.link_type && typeMap[l.link_type]) return typeMap[l.link_type];

  // 3. Extract domain from URL as a readable fallback
  try {
    const host = new URL(l.url).hostname.replace(/^www\./, '');
    if (host) return host;
  } catch {}

  // 4. Last resort
  return 'Link';
}


// ---- Comments ----

function renderComments(comments) {
  const el = document.getElementById('portal-comments');
  if (!comments.length) {
    el.innerHTML = `<div class="text-muted text-sm">${t('portal_no_comments')}</div>`;
    return;
  }

  el.innerHTML = comments.map(c => `
    <div class="comment comment--${c.author_role}">
      <div class="comment__avatar">${c.author_role === 'admin' ? 'R' : (_profile.email?.[0] || 'C').toUpperCase()}</div>
      <div class="comment__content">
        <div class="comment__bubble">${nl2br(c.content)}</div>
        <div class="comment__meta">
          <strong>${esc(c.author_role === 'admin' ? t('admin_sender') : (_data.client.name || 'You'))}</strong>
          <span>·</span>
          <span>${formatDateTime(c.created_at)}</span>
        </div>
      </div>
    </div>`).join('');
}

async function sendComment() {
  const input = document.getElementById('portal-comment-input');
  const text  = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('portal-send-btn');
  btn.disabled = true;

  try {
    const comment = await api.addComment(_profile.client_id, {
      content:     text,
      author_name: _data.client.name || 'Client',
    });
    _data.comments.push(comment);
    renderComments(_data.comments);
    input.value = '';
    toast(_lang === 'pt' ? 'Mensagem enviada.' : 'Message sent.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---- Contact ----

function renderContact(client) {
  const el = document.getElementById('portal-contact-actions');
  el.innerHTML = '';

  if (client.phone)    el.innerHTML += `<a href="${telLink(client.phone)}"    class="btn btn-call">${t('portal_call')}</a>`;
  if (client.whatsapp) el.innerHTML += `<a href="${waLink(client.whatsapp)}"  class="btn btn-wa" target="_blank">${t('portal_whatsapp')}</a>`;
  if (client.email)    el.innerHTML += `<a href="mailto:${esc(client.email)}" class="btn btn-email">${t('portal_email')}</a>`;
  if (client.website)  el.innerHTML += `<a href="${esc(client.website)}"      class="btn btn--secondary" target="_blank">${t('portal_website')}</a>`;
}

// ---- Password change (Feature 1 — general) ----

function openChangePasswordModal() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value     = '';
  document.getElementById('cp-confirm').value = '';
  const errEl = document.getElementById('cp-error');
  errEl.style.display = 'none';
  errEl.textContent   = '';
  openModal('modal-change-password');
}

async function submitChangePassword() {
  const currentPw = document.getElementById('cp-current').value;
  const newPw     = document.getElementById('cp-new').value;
  const confirmPw = document.getElementById('cp-confirm').value;
  const errEl     = document.getElementById('cp-error');
  const btn       = document.getElementById('cp-save-btn');

  errEl.style.display = 'none';

  if (!currentPw) { showCpError('Please enter your current password.'); return; }
  if (newPw.length < 8) { showCpError('New password must be at least 8 characters.'); return; }
  if (newPw !== confirmPw) { showCpError('Passwords do not match.'); return; }

  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    await changePassword(currentPw, newPw);
    closeModal('modal-change-password');
    toast(_lang === 'pt' ? 'Senha atualizada com sucesso.' : 'Password updated successfully.');
  } catch (err) {
    const msg = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
      ? (_lang === 'pt' ? 'Senha atual incorreta.' : 'Current password is incorrect.')
      : (err.message || 'Failed to update password.');
    showCpError(msg);
  } finally {
    btn.disabled = false; btn.textContent = 'Update Password';
  }
}

function showCpError(msg) {
  const el = document.getElementById('cp-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

// ---- Password change (Feature 2 — first login) ----

async function submitFirstLogin() {
  const newPw     = document.getElementById('first-new-password').value;
  const confirmPw = document.getElementById('first-confirm-password').value;
  const errEl     = document.getElementById('first-login-error');
  const btn       = document.getElementById('first-login-save-btn');

  errEl.style.display = 'none';

  if (newPw.length < 8) { showFirstLoginError('Password must be at least 8 characters.'); return; }
  if (newPw !== confirmPw) { showFirstLoginError('Passwords do not match.'); return; }

  btn.disabled = true; btn.textContent = 'Setting password…';
  try {
    await setInitialPassword(newPw);
    await api.passwordChanged();   // flip must_change_password = 0 in D1
    // Show the portal now
    document.getElementById('first-login-panel').classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    await loadData();
    toast('Password set! Welcome to your portal.');
  } catch (err) {
    showFirstLoginError(err.message || 'Failed to set password. Please try again.');
    btn.disabled = false; btn.textContent = 'Set Password & Continue';
  }
}

function showFirstLoginError(msg) {
  const el = document.getElementById('first-login-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

init();
