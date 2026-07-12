// ============================================================
// Client portal page — simplified, bilingual, read + comment only
// ============================================================

import { requireAuth, signOut, changePassword, setInitialPassword } from './auth.js';
import { api }                   from './api.js';
import { t, setLang, getLang, statusLabel, invoiceStatusLabel } from './t.js';
import { esc, nl2br, formatDate, formatDateTime, toast, telLink, waLink, projectCounts,
         statusClass, invoiceStatusClass, openModal, closeModal } from './utils.js?v=2';

let _data     = null;
let _invoices = [];
let _feedback = {};   // keyed by `${projectId}_${comment_type}` → row
let _lang     = 'en';
let _profile  = null;

// Tab state — 'projects' | 'vision'
// _tabManuallySet prevents auto-switching after user explicitly picks a tab
let _activeTab      = 'projects';
let _tabManuallySet = false;

async function init() {
  _profile = await requireAuth('client');
  if (!_profile) return;

  // Set language from user preference
  _lang = _profile.language_preference || 'en';
  setLang(_lang);
  updateLangButtons();

  // Sign out (header button)
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  document.getElementById('lang-en').addEventListener('click', () => switchLang('en'));
  document.getElementById('lang-pt').addEventListener('click', () => switchLang('pt'));
  document.getElementById('portal-send-btn').addEventListener('click', sendComment);

  // Tab navigation
  document.getElementById('tab-btn-projects').addEventListener('click', () => {
    _tabManuallySet = true;
    switchTab('projects');
  });
  document.getElementById('tab-btn-vision').addEventListener('click', () => {
    _tabManuallySet = true;
    switchTab('vision');
  });

  // Share button — event delegation on the projects panel (always in DOM)
  document.getElementById('tab-panel-projects').addEventListener('click', e => {
    const btn = e.target.closest('.portal-share-btn');
    if (!btn) return;
    const pid = +btn.dataset.pid;
    const project = _data?.projects?.find(p => p.id === pid);
    if (project) shareProject(project, btn);
  });

  // Feedback textareas — auto-save on blur (event delegation)
  document.getElementById('tab-panel-projects').addEventListener('focusout', e => {
    const ta = e.target.closest('.feedback-textarea');
    if (!ta) return;
    saveFeedback(+ta.dataset.pid, ta.dataset.type, ta.value.trim(), ta);
  });

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

    try { _invoices = await api.invoices(_profile.client_id); } catch { _invoices = []; } // non-fatal

    // Pre-load feedback for all visible projects
    _feedback = {};
    const visible = (_data.projects || []).filter(p => p.is_client_visible !== 0);
    await Promise.all(visible.map(async p => {
      try {
        const rows = await api.getFeedback(_profile.client_id, p.id);
        rows.forEach(r => { _feedback[`${p.id}_${r.comment_type}`] = r; });
      } catch {} // non-fatal — project just won't have pre-populated feedback
    }));

    render();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading').textContent = `Error: ${err.message}`;
  }
}

// ---- Tab switching ----

function switchTab(tab) {
  _activeTab = tab;
  document.getElementById('tab-panel-projects').classList.toggle('hidden', tab !== 'projects');
  document.getElementById('tab-panel-vision').classList.toggle('hidden', tab !== 'vision');
  document.getElementById('tab-btn-projects').classList.toggle('portal-tab--active', tab === 'projects');
  document.getElementById('tab-btn-vision').classList.toggle('portal-tab--active', tab === 'vision');
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
  document.title = `${client.business_name || client.name} — Resonate Portal`;

  // Logo or wordmark (set once — doesn't change with language)
  renderIdentity(client);

  renderContent();
}

function renderIdentity(client) {
  const logoArea = document.getElementById('portal-logo-area');
  if (client.logo_url) {
    logoArea.innerHTML = `<img src="${esc(client.logo_url)}" class="portal-logo-img" alt="${esc(client.business_name || client.name)}">`;
  } else {
    logoArea.innerHTML = `<div class="portal-wordmark">${esc(client.business_name || client.name)}</div>`;
  }
}

function renderContent() {
  const { client, projects, comments } = _data;

  // Greeting (updates on language switch)
  renderGreeting(client);

  // Welcome message (updates on language switch)
  renderWelcomeMessage();

  // Progress (hidden when no projects)
  renderProgress(projects);

  // Auto-select tab based on whether projects exist (unless user manually chose)
  if (!_tabManuallySet) {
    const hasVisible = projects.some(p => p.is_client_visible !== 0);
    switchTab(hasVisible ? 'projects' : 'vision');
  }

  // Projects tab content
  renderProjects(projects);

  // Vision tab content
  renderVision();

  // Invoices (hidden when none synced)
  renderInvoices(_invoices);

  // Comments
  renderComments(comments);

  // Contact actions
  renderContact(client);

  // AI intake interview card — only for clients with intake explicitly enabled
  document.getElementById('portal-intake-card')?.classList.toggle('hidden', !client.intake_enabled);
}

// ---- Invoices ----

// Client-side tab state — 'unpaid' | 'archive'. Drafts never show here.
let _invoiceTab = 'unpaid';

function renderInvoices(invoices) {
  const section = document.getElementById('portal-invoices-section');
  const list    = document.getElementById('portal-invoices');
  if (!section || !list) return;

  // Drafts and voided invoices are internal — clients only see actionable ones
  const all      = (invoices || []).filter(inv => inv.status !== 'draft' && inv.status !== 'void');
  const unpaid   = all.filter(inv => inv.is_archived !== 1);
  const archived = all.filter(inv => inv.is_archived === 1);
  section.classList.toggle('hidden', all.length === 0);
  if (all.length === 0) return;

  // Tab buttons (wired every render — innerHTML below never touches them)
  document.getElementById('inv-tab-btn-unpaid').onclick  = () => { _invoiceTab = 'unpaid';  renderInvoices(invoices); };
  document.getElementById('inv-tab-btn-archive').onclick = () => { _invoiceTab = 'archive'; renderInvoices(invoices); };
  document.getElementById('inv-tab-btn-unpaid').classList.toggle('portal-tab--active',  _invoiceTab === 'unpaid');
  document.getElementById('inv-tab-btn-archive').classList.toggle('portal-tab--active', _invoiceTab === 'archive');

  const visible = _invoiceTab === 'archive' ? archived : unpaid;
  const emptyEl = document.getElementById('portal-invoices-empty');
  emptyEl.classList.toggle('hidden', visible.length > 0);
  emptyEl.textContent = t(`books_empty_${_invoiceTab}`);

  const locale = _lang === 'pt' ? 'pt-BR' : 'en-US';
  list.innerHTML = visible.map(inv => {
    const money = inv.amount != null
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: inv.currency_code || 'USD' }).format(inv.amount)
      : '';
    const due = inv.due_date
      ? `${t('invoice_due')}: ${new Date(inv.due_date + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : '';
    // Pay Now only for payable invoices with a synced hosted-payment URL;
    // paid ones keep a quiet view link, no URL → no button at all
    let action = '';
    if (inv.payment_url) {
      action = inv.status === 'paid'
        ? `<a href="${esc(inv.payment_url)}" target="_blank" rel="noopener" class="text-[12px] text-[#005b96] underline whitespace-nowrap">${esc(t('invoice_view'))}</a>`
        : `<a href="${esc(inv.payment_url)}" target="_blank" rel="noopener" class="btn btn--primary btn--sm whitespace-nowrap">${esc(t('invoice_pay_now'))}</a>`;
    }
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid rgba(0,0,0,0.05);">
        <div style="min-width:0;">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[14px] font-semibold text-[#1a1d26]">${esc(inv.invoice_number || '')}</span>
            <span class="badge ${invoiceStatusClass(inv.status)}">${esc(invoiceStatusLabel(inv.status))}</span>
          </div>
          <div class="text-[#717781] text-[12px] mt-1">${esc(money)}${due ? ` · ${esc(due)}` : ''}</div>
        </div>
        ${action}
      </div>`;
  }).join('');
}

function renderWelcomeMessage() {
  const el = document.getElementById('portal-welcome-msg');
  if (el) el.textContent = t('portal_welcome_message');
}

function renderGreeting(client) {
  // Prefer first_name from portal profile (users table), fall back to client contact name
  const rawName   = _profile?.first_name || (client.name || '');
  const firstName = rawName.trim().split(/\s+/)[0] || '';
  const prefix    = t('portal_greeting');
  document.getElementById('portal-greeting').textContent =
    firstName ? `${prefix}, ${firstName}` : prefix;
}

function renderVision() {
  document.getElementById('portal-vision-copy').textContent = t('vision_copy');
}

// ---- Progress ----

function renderProgress(projects) {
  const section = document.getElementById('portal-progress-section');

  // Hide the progress block entirely when there are no projects yet
  if (!projects.length) {
    section?.classList.add('hidden');
    return;
  }
  section?.classList.remove('hidden');

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
      <div class="progress-count__number" style="color:var(--s-green)">${counts.completed} 🎩</div>
      <div class="progress-count__label">${_lang === 'pt' ? 'Concluídos' : 'Complete'}</div>
    </div>`;

  document.getElementById('portal-progress-fill').style.width = `${pct}%`;
}

// ---- Projects ----

function renderProjects(projects) {
  const el = document.getElementById('portal-projects');

  const visible = projects.filter(p => p.is_client_visible !== 0);
  if (!visible.length) {
    el.innerHTML = `
      <div style="padding:16px 0 8px; font-family:var(--font); font-size:14px; color:var(--text-3); line-height:1.6;">
        ${t('portal_no_projects')}
      </div>`;
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

  const hatEmoji = p.status === 'completed' ? ' 🎩' : '';

  // Pre-populate feedback boxes from _feedback cache
  const favRow = _feedback[`${p.id}_favorite`];
  const sugRow = _feedback[`${p.id}_suggestion`];
  const favVal  = esc(favRow?.content  || '');
  const sugVal  = esc(sugRow?.content  || '');
  const favEdited = favRow?.is_edited ? `<span class="feedback-edited-pill">${t('feedback_edited_pill')}</span>` : '';
  const sugEdited = sugRow?.is_edited ? `<span class="feedback-edited-pill">${t('feedback_edited_pill')}</span>` : '';

  return `
    <div class="project-card">
      <div class="project-card__head">
        <span class="project-card__title">${esc(p.title)}${hatEmoji}</span>
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
        <button class="portal-share-btn" data-pid="${p.id}"
                title="${_lang === 'pt' ? 'Compartilhar este projeto' : 'Share this project'}">
          <span class="material-symbols-outlined" style="font-size:15px;">share</span>
          ${_lang === 'pt' ? 'Compartilhar' : 'Share'}
        </button>
      </div>

      <!-- Per-project feedback boxes (client-editable, auto-save on blur) -->
      <div class="feedback-boxes" style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
        <div class="feedback-box" style="margin-bottom:14px;">
          <div class="feedback-box__label">
            ${t('feedback_favorite_label')} ${favEdited}
          </div>
          <textarea class="feedback-textarea form-control"
                    data-pid="${p.id}" data-type="favorite"
                    rows="3"
                    placeholder="${t('feedback_favorite_placeholder')}">${favVal}</textarea>
          <div class="feedback-status" data-pid="${p.id}" data-type="favorite"></div>
        </div>
        <div class="feedback-box">
          <div class="feedback-box__label">
            ${t('feedback_suggestion_label')} ${sugEdited}
          </div>
          <textarea class="feedback-textarea form-control"
                    data-pid="${p.id}" data-type="suggestion"
                    rows="3"
                    placeholder="${t('feedback_suggestion_placeholder')}">${sugVal}</textarea>
          <div class="feedback-status" data-pid="${p.id}" data-type="suggestion"></div>
        </div>
      </div>
    </div>`;
}

// ---- Project feedback auto-save ----

async function saveFeedback(projectId, commentType, body, textareaEl) {
  // Find the status indicator element for this textarea
  const statusEl = document.querySelector(`.feedback-status[data-pid="${projectId}"][data-type="${commentType}"]`);

  // Don't save if body is empty and there's no existing row
  const existing = _feedback[`${projectId}_${commentType}`];
  if (!body && !existing) return;

  // Don't save if body hasn't changed
  if (existing && (existing.content || '') === body) return;

  if (statusEl) statusEl.textContent = t('feedback_saving');

  try {
    const row = await api.upsertFeedback(_profile.client_id, {
      project_id:   projectId,
      comment_type: commentType,
      body,
    });
    _feedback[`${projectId}_${commentType}`] = row;

    // Update the "Edited" pill without full re-render
    if (row.is_edited && textareaEl) {
      const labelEl = textareaEl.closest('.feedback-box')?.querySelector('.feedback-box__label');
      if (labelEl && !labelEl.querySelector('.feedback-edited-pill')) {
        const pill = document.createElement('span');
        pill.className = 'feedback-edited-pill';
        pill.textContent = t('feedback_edited_pill');
        labelEl.appendChild(pill);
      }
    }

    if (statusEl) {
      statusEl.textContent = t('feedback_saved');
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '⚠ ' + (err.message || 'Save failed');
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
  }
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
    el.innerHTML = `
      <div style="font-family:var(--font); font-size:14px; color:var(--text-3); line-height:1.6; padding:4px 0 12px;">
        ${t('portal_no_comments')}
      </div>`;
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

// ---- Share project ----

async function shareProject(p, anchorEl) {
  const bizName  = _data.client.business_name || _data.client.name;
  const desc     = _lang === 'pt'
    ? (p.description_pt || p.description_en || '')
    : (p.description_en || p.description_pt || '');

  // Build the public URL for this project
  const publicUrl = new URL('public.html', window.location.href).href + '?project=' + p.id;

  // Compose share text
  const intro    = _lang === 'pt'
    ? `*${p.title}* — ${bizName}`
    : `*${p.title}* — ${bizName}`;
  const viewLine = _lang === 'pt' ? `Ver projeto: ${publicUrl}` : `View project: ${publicUrl}`;
  const shareText = [intro, desc, viewLine].filter(Boolean).join('\n\n');

  // Try native share (works great on mobile — triggers WhatsApp, Messages, etc.)
  if (navigator.share) {
    try {
      await navigator.share({ title: p.title, text: shareText, url: publicUrl });
    } catch (err) {
      // AbortError = user dismissed — that's fine. Any other error: fall through to menu.
      if (err.name !== 'AbortError') showShareMenu(anchorEl, shareText, publicUrl, p.title, bizName);
    }
    return;
  }

  // Desktop fallback: custom share menu
  showShareMenu(anchorEl, shareText, publicUrl, p.title, bizName);
}

function showShareMenu(anchorEl, text, url, title, bizName) {
  // Create singleton menu if it doesn't exist yet
  let menu = document.getElementById('portal-share-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id        = 'portal-share-menu';
    menu.className = 'share-menu';
    menu.innerHTML = `
      <a id="smenu-wa" class="share-menu__item" target="_blank" rel="noopener noreferrer">
        <span class="share-menu__icon">💬</span>WhatsApp
      </a>
      <a id="smenu-email" class="share-menu__item">
        <span class="share-menu__icon">✉️</span>Email
      </a>
      <button id="smenu-copy" class="share-menu__item">
        <span class="share-menu__icon" id="smenu-copy-icon">🔗</span><span id="smenu-copy-label">Copy Link</span>
      </button>`;
    document.body.appendChild(menu);
  }

  // Populate with current project's data
  document.getElementById('smenu-wa').href    = `https://wa.me/?text=${encodeURIComponent(text)}`;
  document.getElementById('smenu-email').href =
    `mailto:?subject=${encodeURIComponent(`${title} — ${bizName}`)}&body=${encodeURIComponent(text)}`;

  const copyLabel = document.getElementById('smenu-copy-label');
  const copyIcon  = document.getElementById('smenu-copy-icon');
  copyLabel.textContent = _lang === 'pt' ? 'Copiar link' : 'Copy Link';
  copyIcon.textContent  = '🔗';

  document.getElementById('smenu-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyIcon.textContent  = '✓';
      copyLabel.textContent = _lang === 'pt' ? 'Copiado!' : 'Copied!';
      setTimeout(() => {
        copyIcon.textContent  = '🔗';
        copyLabel.textContent = _lang === 'pt' ? 'Copiar link' : 'Copy Link';
      }, 1800);
    } catch {
      toast(_lang === 'pt' ? 'Copie o link manualmente.' : 'Copy the link manually.', 'error');
    }
  };

  // Position menu below the share button
  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = 172;
  menu.style.display = 'block';
  menu.style.top     = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left    = `${Math.min(rect.left + window.scrollX, window.innerWidth - menuWidth - 12)}px`;

  // Close on outside click or Escape
  const close = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) {
      hideShareMenu();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', onEsc);
    }
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      hideShareMenu();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', onEsc);
    }
  };
  // Defer so the share button's own click doesn't immediately close the menu
  setTimeout(() => {
    document.addEventListener('click', close, true);
    document.addEventListener('keydown', onEsc);
  }, 0);
}

function hideShareMenu() {
  const menu = document.getElementById('portal-share-menu');
  if (menu) menu.style.display = 'none';
}

init();
