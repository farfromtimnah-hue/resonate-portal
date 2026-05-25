// ============================================================
// Public project view — no authentication required.
// Reads ?project=<id> from the URL, fetches from the
// unauthenticated /api/public/projects/:id endpoint, renders.
// ============================================================

import { API_BASE }                   from './config.js';
import { t, setLang, statusLabel }    from './t.js';
import { esc, nl2br, formatDate, statusClass } from './utils.js?v=2';

let _lang = 'en';
let _data = null;

async function init() {
  // Lang toggle
  document.getElementById('lang-en').addEventListener('click', () => switchLang('en'));
  document.getElementById('lang-pt').addEventListener('click', () => switchLang('pt'));

  // Read project id from query string
  const projectId = new URLSearchParams(window.location.search).get('project');
  if (!projectId) { showError('No project specified.'); return; }

  try {
    const res = await fetch(`${API_BASE}/api/public/projects/${projectId}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      showError(res.status === 404
        ? 'This project isn\'t available publicly. Please contact the team.'
        : 'Failed to load project. Please try again.');
      return;
    }

    _data = await res.json();

    // Default language: follow client's preference
    _lang = _data.client?.language_preference || 'en';
    setLang(_lang);
    updateLangButtons();

    document.getElementById('loading').classList.add('hidden');
    render();
    document.getElementById('content').classList.remove('hidden');

  } catch {
    showError('Unable to load this project. Please check your connection and try again.');
  }
}

// ---- Language ----

function switchLang(lang) {
  _lang = lang;
  setLang(lang);
  updateLangButtons();
  if (_data) render();
}

function updateLangButtons() {
  document.getElementById('lang-en').classList.toggle('lang-btn--active', _lang === 'en');
  document.getElementById('lang-pt').classList.toggle('lang-btn--active', _lang === 'pt');
}

// ---- Render ----

function render() {
  const { project, client, links } = _data;
  const biz = client.business_name || 'Resonate';

  document.title = `${project.title} — ${biz}`;

  // Identity: logo or wordmark
  const idEl = document.getElementById('pub-identity');
  if (client.logo_url) {
    idEl.innerHTML = `<img src="${esc(client.logo_url)}" class="portal-logo-img" alt="${esc(biz)}">`;
  } else {
    idEl.innerHTML = `<div class="portal-wordmark">${esc(biz)}</div>`;
  }

  // Subtitle
  document.getElementById('pub-subtitle').textContent =
    _lang === 'pt' ? `Um projeto de ${biz}` : `A project from ${biz}`;

  // Project card
  const desc   = _lang === 'pt'
    ? (project.description_pt || project.description_en || '')
    : (project.description_en || project.description_pt || '');
  const future = _lang === 'pt'
    ? (project.future_features_pt || project.future_features_en || '')
    : (project.future_features_en || project.future_features_pt || '');

  const linkPills = (links || []).map(l =>
    `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"
        class="resource-link resource-link--btn">
       ${esc(linkLabel(l))} ↗
     </a>`
  ).join('');

  document.getElementById('pub-project').innerHTML = `
    <div class="project-card" style="background:#fff;">
      <div class="project-card__head">
        <span class="project-card__title" style="font-size:16px;">${esc(project.title)}</span>
        <span class="badge ${statusClass(project.status)}">${statusLabel(project.status)}</span>
      </div>

      ${desc ? `<div class="project-card__body" style="font-size:14px; line-height:1.7;">${nl2br(desc)}</div>` : ''}

      ${linkPills ? `<div class="project-card__links links-list" style="margin-top:14px;">${linkPills}</div>` : ''}

      ${future ? `
        <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
          <div style="font-size:11px; font-weight:600; color:var(--text-3);
                      text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">
            ${_lang === 'pt' ? 'Em Breve' : 'Coming Up'}
          </div>
          <div class="future-block">${nl2br(future)}</div>
        </div>` : ''}

      <div class="project-card__footer">
        <span class="text-muted">
          ${_lang === 'pt' ? 'Atualizado' : 'Updated'} ${formatDate(project.updated_at)}
        </span>
        ${project.due_date
          ? `<span class="text-muted">${_lang === 'pt' ? 'Prazo' : 'Due'} ${formatDate(project.due_date)}</span>`
          : ''}
      </div>
    </div>`;
}

function linkLabel(l) {
  if (l.label?.trim()) return l.label.trim();
  const typeMap = {
    live_site: 'Live Site', staging: 'Staging', test: 'Test Link',
    github_repo: 'GitHub Repo', github_project: 'GitHub Project',
    cloudflare: 'Cloudflare', admin: 'Admin Page',
    dashboard: 'Dashboard', automation: 'Automation Flow',
  };
  if (l.link_type && typeMap[l.link_type]) return typeMap[l.link_type];
  try {
    const host = new URL(l.url).hostname.replace(/^www\./, '');
    if (host) return host;
  } catch {}
  return 'Link';
}

// ---- Error state ----

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  const el = document.getElementById('pub-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

init();
