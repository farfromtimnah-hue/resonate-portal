// ============================================================
// Admin client detail page — full view with all edit controls
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { statusLabel, invoiceStatusLabel, STATUS_OPTIONS } from './t.js';
import { esc, nl2br, formatDate, formatDateTime, formatDateFull,
         toast, openModal, closeModal, qp, telLink, waLink, projectCounts,
         statusClass, invoiceStatusClass } from './utils.js?v=2';

let _clientId = null;

const MEETINGS = {
  // Suellen Sartorato — first conversation
  4: [
    { key: 'first', date: '2026-09-02', label: 'First meeting', time: '4:15 PM' },
  ],
};

let _data     = null;          // { client, projects, comments, notes, links, people, intake_session_count, history }
let _adminFeedback = {};       // keyed by `${projectId}_${comment_type}` → row
let _editingProjectId = null;
let _editingNoteId    = null;
let _invoices = [];

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  _clientId = qp('id');
  if (!_clientId) { window.location.href = 'dashboard.html'; return; }

  renderMeetings();

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  // Modal close buttons — project modal handled separately (dirty-check on add-project flow)
  document.querySelectorAll('[data-close]').forEach(btn => {
    if (btn.dataset.close === 'modal-project') return;
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    if (m.id === 'modal-project') return;
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  // Buttons
  // Logo upload
  const logoPreviewEl  = document.getElementById('client-logo-preview');
  const logoFileInput  = document.getElementById('logo-file-input');
  const uploadLogoBtn  = document.getElementById('upload-logo-btn');

  // Both the preview box and the button trigger the file picker
  logoPreviewEl.addEventListener('click', () => logoFileInput.click());
  uploadLogoBtn.addEventListener('click', (e) => { e.stopPropagation(); logoFileInput.click(); });

  logoFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024)    { toast('Image must be under 5 MB.', 'error'); return; }

    uploadLogoBtn.disabled = true;
    uploadLogoBtn.textContent = 'Uploading…';
    try {
      const res = await api.uploadLogo(_clientId, file);
      if (_data) _data.client.logo_url = res.logo_url;
      renderLogoPreview(_data?.client);
      toast('Logo uploaded!');
    } catch (err) {
      toast(err.message || 'Upload failed.', 'error');
    } finally {
      uploadLogoBtn.disabled = false;
      uploadLogoBtn.textContent = 'Upload Logo';
      e.target.value = '';  // allow re-upload of same file
    }
  });

  document.getElementById('edit-client-btn').addEventListener('click', openEditClient);
  document.getElementById('archive-btn').addEventListener('click', archiveClient);

  // Open this client's portal as they see it. Preview is read-only unless the
  // client is flagged as a test client AND writing is switched on in the banner.
  document.getElementById('preview-portal-btn').addEventListener('click', () => {
    window.location.href = `portal.html?previewAs=${encodeURIComponent(_clientId)}`;
  });
  document.getElementById('archive-now-btn')?.addEventListener('click', archiveClient);
  document.getElementById('add-project-btn').addEventListener('click', openAddProject);
  document.getElementById('add-note-btn').addEventListener('click',    openAddNote);
  document.getElementById('send-comment-btn').addEventListener('click', sendComment);

  // Save handlers
  document.getElementById('ec-save-btn').addEventListener('click',    saveClient);
  document.getElementById('proj-save-btn').addEventListener('click',  saveProject);
  document.getElementById('proj-delete-btn').addEventListener('click',deleteProject);
  document.getElementById('note-save-btn').addEventListener('click',  saveNote);
  document.getElementById('pa-save-btn').addEventListener('click',    savePortalAccess);

  // Project link editor (inside the Edit Project modal)
  document.getElementById('proj-add-link-btn').addEventListener('click', () => {
    addLinkRow(null, _editingProjectId, document.getElementById('proj-links-list'));
  });

  // Project modal — close with dirty-check for add-project flow
  function maybeCloseProjectModal() {
    if (isProjectFormDirty() && !confirm('Discard unsaved project?')) return;
    if (_data) renderProjects(_data.projects);
    closeModal('modal-project');
  }
  document.querySelectorAll('[data-close="modal-project"]').forEach(btn => {
    btn.addEventListener('click', maybeCloseProjectModal);
  });
  document.getElementById('modal-project').addEventListener('click', e => {
    if (e.target === e.currentTarget) maybeCloseProjectModal();
  });

  document.getElementById('sync-invoices-btn')?.addEventListener('click', syncInvoices);

  await loadData();
}

// ---- Invoices (Zoho) ----

async function syncInvoices() {
  const btn = document.getElementById('sync-invoices-btn');
  btn.disabled = true;
  try {
    const res = await api.zohoSyncInvoices(_clientId);
    _invoices = res.invoices || [];
    renderInvoices(_invoices);
    toast(`Synced ${res.synced} invoice${res.synced === 1 ? '' : 's'} from Zoho.`, 'success');
  } catch (err) {
    const messages = {
      zoho_not_connected:               'Zoho is not connected yet — use Connect Zoho Invoice on the dashboard first.',
      zoho_customer_not_found:          'No Zoho customer matches this client’s email.',
      client_has_no_email_for_zoho_match: 'Add an email to this client first so it can be matched to a Zoho customer.',
      zoho_organization_missing:        'Zoho connection has no organization — reconnect from the dashboard.',
    };
    toast(messages[err.message] || 'Invoice sync failed. Please try again.', 'error');
  }
  btn.disabled = false;
}

function renderInvoices(invoices) {
  const list  = document.getElementById('invoices-list');
  const empty = document.getElementById('invoices-empty');
  if (!list) return;

  // Archived invoices live on the Books page Archive tab, not here
  invoices = invoices.filter(inv => inv.is_archived !== 1);

  empty.classList.toggle('hidden', invoices.length > 0);
  list.innerHTML = invoices.map(inv => {
    const money = inv.amount != null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency_code || 'USD' }).format(inv.amount)
      : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="min-width:0;">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-primary-fixed-dim text-[13px] font-semibold">${esc(inv.invoice_number || inv.zoho_invoice_id)}</span>
            <span class="badge ${invoiceStatusClass(inv.status)}">${esc(invoiceStatusLabel(inv.status))}</span>
          </div>
          <div class="text-outline-variant text-[12px] mt-1">
            ${esc(money)}${inv.due_date ? ` · due ${esc(inv.due_date)}` : ''}${inv.last_synced_at ? ` · synced ${formatDate(inv.last_synced_at)}` : ''}
          </div>
        </div>
        ${inv.payment_url ? `<a href="${esc(inv.payment_url)}" target="_blank" rel="noopener"
            class="text-outline-variant hover:text-primary-fixed-dim text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 whitespace-nowrap">View</a>` : ''}
      </div>`;
  }).join('');
}

// ---- Data loading ----

async function loadData() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');

  try {
    _data = await api.getClient(_clientId);

    try { _invoices = await api.invoices(_clientId); } catch { _invoices = []; } // non-fatal

    // Pre-load client feedback for all projects
    _adminFeedback = {};
    await Promise.all((_data.projects || []).map(async p => {
      try {
        const rows = await api.getFeedback(_clientId, p.id);
        rows.forEach(r => { _adminFeedback[`${p.id}_${r.comment_type}`] = r; });
      } catch {} // non-fatal
    }));

    render();
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    const loadingEl = document.getElementById('loading');
    loadingEl.innerHTML = `
      <div style="text-align:center; padding:2rem;">
        <div style="font-size:1.5rem; margin-bottom:.75rem;">⚠️</div>
        <div style="color:var(--s-red, #f87171); font-weight:600; margin-bottom:.5rem;">Failed to load client</div>
        <div style="color:var(--text-3); font-size:13px; margin-bottom:1.25rem;">${esc(err.message)}</div>
        <button onclick="location.reload()" style="background:var(--primary);color:#fff;border:none;border-radius:9999px;padding:8px 20px;font-size:13px;cursor:pointer;">Retry</button>
      </div>`;
  }
}

// ---- Main render ----

function render() {
  const { client, projects, comments, notes, links, people, history } = _data;

  document.title = `${client.name} — Resonate`;

  // Logo
  renderLogoPreview(client);

  // Header
  document.getElementById('client-name').textContent     = client.name;
  document.getElementById('client-business').textContent = client.business_name || '';
  document.getElementById('client-business').classList.toggle('hidden', !client.business_name);

  const statusBadge = document.getElementById('client-status-badge');
  statusBadge.textContent  = client.overall_status;
  statusBadge.className    = `badge ${statusClass(client.overall_status)}`;

  document.getElementById('client-lang-badge').textContent  = client.language_preference === 'pt' ? 'PT' : 'EN';
  document.getElementById('client-updated').textContent     = client.updated_at ? `Updated ${formatDate(client.updated_at)}` : '';

  // Quick contact actions in header
  const qa = document.getElementById('client-quick-actions');
  qa.innerHTML = '';
  if (client.phone)    qa.innerHTML += `<a href="${telLink(client.phone)}"   class="btn btn--sm btn-call">📞 Call</a>`;
  if (client.whatsapp) qa.innerHTML += `<a href="${waLink(client.whatsapp)}" class="btn btn--sm btn-wa"   target="_blank">💬 WhatsApp</a>`;
  if (client.email)    qa.innerHTML += `<a href="mailto:${esc(client.email)}"class="btn btn--sm btn-email">✉ Email</a>`;
  if (client.website)  qa.innerHTML += `<a href="${esc(client.website)}"     class="btn btn--sm btn--secondary" target="_blank">🌐 Website</a>`;

  // Archive/restore button label
  const archiveBtn = document.getElementById('archive-btn');
  archiveBtn.textContent = client.is_archived ? 'Restore Client' : 'Archive';

  // All-complete banner
  const allComplete = projects.length > 0 && projects.every(p => p.status === 'completed');
  document.getElementById('all-complete-banner')?.classList.toggle('hidden', !allComplete || client.is_archived);

  // Contact block
  renderContact(client);

  // Progress
  renderProgress(projects);

  // Projects
  renderProjects(projects);

  // Invoices (Zoho sync cache)
  renderInvoices(_invoices);

  // Comments
  renderComments(comments);

  // Notes
  renderNotes(notes);

  // Links are rendered per-project inside renderProjects

  // People on this client (portal logins + who takes an interview)
  renderPeople(people, client);

  // Intake interview toggle (business-level on switch)
  renderIntakeToggle(client);

  // Results link — shown only when this client actually has an interview,
  // so a client who has never interviewed does not get a dead link.
  renderResultsLink(client);

  // History
  renderHistory(history);
}

// ---- Logo preview (admin) ----

function renderLogoPreview(client) {
  const el = document.getElementById('client-logo-preview');
  if (!el) return;
  if (client?.logo_url) {
    el.innerHTML = `<img src="${esc(client.logo_url)}" alt="Logo" style="width:100%; height:100%; object-fit:contain;">`;
  } else {
    // Show business initials
    const text  = client?.business_name || client?.name || '?';
    const initials = text.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    el.innerHTML = `<span class="logo-preview__initials">${esc(initials)}</span>`;
  }
}

// ---- Contact ----

function renderContact(client) {
  const el = document.getElementById('contact-block');
  const row = (label, val, link) => val
    ? `<div class="contact-row">
         <span class="contact-row__label">${label}</span>
         <span class="contact-row__value">${link
           ? `<a href="${link}" class="contact-row__link" ${link.startsWith('http') ? 'target="_blank"' : ''}>${esc(val)}</a>`
           : esc(val)}</span>
       </div>`
    : '';

  el.innerHTML = `
    ${row('Phone',    client.phone,    telLink(client.phone))}
    ${row('WhatsApp', client.whatsapp, waLink(client.whatsapp))}
    ${row('Email',    client.email,    `mailto:${client.email}`)}
    ${row('Website',  client.website,  client.website)}
    ${row('Address',  client.address,  null)}
    ${row('Notes',    client.contact_notes, null)}
    <div class="contact-actions" style="margin-top:12px;">
      ${client.phone    ? `<a href="${telLink(client.phone)}"    class="btn btn--sm btn-call">📞 Call</a>` : ''}
      ${client.whatsapp ? `<a href="${waLink(client.whatsapp)}"  class="btn btn--sm btn-wa" target="_blank">💬 WhatsApp</a>` : ''}
      ${client.email    ? `<a href="mailto:${esc(client.email)}" class="btn btn--sm btn-email">✉ Email</a>` : ''}
    </div>`;
}

// ---- Progress ----

function renderProgress(projects) {
  const counts = projectCounts(projects);
  const pct    = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  document.getElementById('progress-counts').innerHTML = `
    <div class="progress-count">
      <div class="progress-count__number">${counts.total}</div>
      <div class="progress-count__label">Total</div>
    </div>
    <div class="progress-count">
      <div class="progress-count__number" style="color:var(--s-blue)">${counts.in_progress}</div>
      <div class="progress-count__label">In Progress</div>
    </div>
    <div class="progress-count">
      <div class="progress-count__number" style="color:var(--s-amber)">${counts.waiting}</div>
      <div class="progress-count__label">Waiting</div>
    </div>
    <div class="progress-count">
      <div class="progress-count__number" style="color:var(--s-green)">${counts.completed}</div>
      <div class="progress-count__label">Complete</div>
    </div>`;

  document.getElementById('progress-fill').style.width = `${pct}%`;
}

// ---- Projects ----

function renderProjects(projects) {
  const el = document.getElementById('projects-list');

  if (!projects.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__text">No projects yet. Add the first one.</div></div>`;
    return;
  }

  el.innerHTML = projects.map(p => projectCardHTML(p)).join('');

  // Admin translation auto-save on blur (event delegation on the list)
  el.querySelectorAll('.admin-translation-textarea').forEach(ta => {
    ta.addEventListener('blur', async () => {
      const pid   = +ta.dataset.pid;
      const type  = ta.dataset.type;
      const value = ta.value.trim();
      try {
        await api.saveFeedbackTranslation(_clientId, {
          project_id: pid, comment_type: type, admin_translation: value
        });
        // Update local cache
        if (_adminFeedback[`${pid}_${type}`]) {
          _adminFeedback[`${pid}_${type}`].admin_translation = value;
        }
      } catch (err) { toast('Translation save failed: ' + err.message, 'error'); }
    });
  });

  // ── Drag-and-drop reorder ───────────────────────────────────
  let _draggingPid = null;

  el.querySelectorAll('.project-card[data-project-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      _draggingPid = +card.dataset.projectId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(_draggingPid));
      // Defer adding the class so the drag ghost renders normally first
      setTimeout(() => card.classList.add('project-card--dragging'), 0);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('project-card--dragging');
      el.querySelectorAll('.project-card').forEach(c =>
        c.classList.remove('project-card--drop-above', 'project-card--drop-below')
      );
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.querySelectorAll('.project-card').forEach(c =>
        c.classList.remove('project-card--drop-above', 'project-card--drop-below')
      );
      const rect = card.getBoundingClientRect();
      card.classList.add(
        e.clientY < rect.top + rect.height / 2
          ? 'project-card--drop-above'
          : 'project-card--drop-below'
      );
    });

    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('project-card--drop-above', 'project-card--drop-below');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      const targetPid = +card.dataset.projectId;
      if (targetPid === _draggingPid) return;

      const insertBefore = card.classList.contains('project-card--drop-above');

      // Reorder the in-memory array
      const srcIdx = _data.projects.findIndex(p => p.id === _draggingPid);
      const [moved] = _data.projects.splice(srcIdx, 1);
      const tgtIdx  = _data.projects.findIndex(p => p.id === targetPid);
      _data.projects.splice(insertBefore ? tgtIdx : tgtIdx + 1, 0, moved);

      // Re-render immediately so the order is visible
      renderProjects(_data.projects);

      // Persist new sort_order values (parallel)
      try {
        await Promise.all(
          _data.projects.map((p, idx) =>
            api.updateProject(_clientId, p.id, { sort_order: idx })
          )
        );
        toast('Order saved.');
      } catch {
        toast('Order updated locally — failed to save to server.', 'error');
      }
    });
  });

  // ── Status dropdowns (inline) ──────────────────────────────
  el.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const pid = e.target.dataset.pid;
      try {
        const res = await api.updateProject(_clientId, pid, { status: e.target.value });
        if (res.all_projects_complete) {
          document.getElementById('all-complete-banner')?.classList.remove('hidden');
        } else {
          document.getElementById('all-complete-banner')?.classList.add('hidden');
        }
        const p = _data.projects.find(p => p.id == pid);
        if (p) p.status = e.target.value;
        renderProgress(_data.projects);
        toast('Status updated.');
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // ── Edit buttons ───────────────────────────────────────────
  el.querySelectorAll('.proj-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditProject(parseInt(btn.dataset.pid)));
  });
}

function projectCardHTML(p) {
  const hidden = !p.is_client_visible;

  // Read-only link pills — populated from _data.links (project-scoped)
  const projectLinks = (_data.links || []).filter(l => l.project_id === p.id);
  const linkPills    = projectLinks
    .map(l => `<a href="${esc(l.url)}" target="_blank" class="resource-link resource-link--btn" style="font-size:12px; padding:6px 14px;">${esc(l.label || l.url)} ↗</a>`)
    .join('');

  const dueLine = p.due_date
    ? `<span>Due ${formatDateFull(p.due_date)}</span>`
    : '';

  const visibilityBadge = hidden
    ? `<span class="badge status--gray" style="font-size:10px;">Admin only</span>`
    : `<span class="badge status--green" style="font-size:10px;">Client visible</span>`;

  return `
    <div class="project-card ${hidden ? 'project-card--hidden' : ''}" data-project-id="${p.id}" draggable="true">
      <div class="project-card__head">
        <span class="drag-handle material-symbols-outlined" title="Drag to reorder">drag_indicator</span>
        <span class="project-card__title">${esc(p.title)}${p.status === 'completed' ? ' 🎩' : ''}</span>
        <div class="project-card__actions">
          <select class="status-select" data-pid="${p.id}" title="Change status">
            ${STATUS_OPTIONS.map(s =>
              `<option value="${s.value}" ${p.status === s.value ? 'selected' : ''}>${statusLabel(s.value)}</option>`
            ).join('')}
          </select>
          <button class="btn btn--ghost btn--sm btn--icon proj-edit-btn" data-pid="${p.id}" title="Edit">✎</button>
        </div>
      </div>

      ${p.description_en ? `<div class="project-card__body">${nl2br(p.description_en)}</div>` : ''}

      ${linkPills ? `<div class="project-card__links links-list" style="margin-top:8px;">${linkPills}</div>` : ''}

      ${p.future_features_en ? `
        <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
          <div style="font-size:11px; font-weight:600; color:var(--text-3); text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Coming Up</div>
          <div class="future-block">${nl2br(p.future_features_en)}</div>
        </div>` : ''}

      <div class="project-card__footer">
        ${visibilityBadge}
        ${dueLine}
        <span style="margin-left:auto; color:var(--text-3);">Updated ${formatDate(p.updated_at)}</span>
      </div>

      <!-- Admin view of client feedback (read-only + translation) -->
      ${adminFeedbackHTML(p.id)}
    </div>`;
}

function adminFeedbackHTML(projectId) {
  const types = [
    { key: 'favorite',   label: "Client's favorite things",  transLabel: 'Translation: a few of my favorite things' },
    { key: 'suggestion', label: "Client's suggestions",       transLabel: 'Translation: how we could go further' },
  ];

  const blocks = types.map(({ key, label, transLabel }) => {
    const row     = _adminFeedback[`${projectId}_${key}`];
    const body    = row?.content?.trim() || '';
    const trans   = row?.admin_translation?.trim() || '';
    const editedPill = row?.is_edited
      ? `<span class="feedback-edited-pill" style="margin-left:6px;">Edited</span>` : '';

    return `
      <div class="admin-feedback-section">
        <div class="admin-feedback-label">${label}${editedPill}</div>
        <div class="admin-feedback-block ${body ? '' : 'admin-feedback-block--empty'}">
          ${body ? esc(body).replace(/\n/g,'<br>') : 'No response yet'}
        </div>
        ${body ? `
          <div class="admin-translation-field">
            <div class="admin-translation-label">${transLabel}</div>
            <textarea class="form-control admin-translation-textarea"
                      data-pid="${projectId}" data-type="${key}"
                      rows="2"
                      placeholder="Type your translation here…">${esc(trans)}</textarea>
          </div>` : ''}
      </div>`;
  }).join('');

  return `<div class="admin-feedback-wrapper" style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">${blocks}</div>`;
}

// ---- Comments ----

function renderComments(comments) {
  const el = document.getElementById('comments-list');
  if (!comments.length) {
    el.innerHTML = `<div class="text-muted text-sm">No messages yet.</div>`;
    return;
  }

  el.innerHTML = comments.map(c => `
    <div class="comment comment--${c.author_role}">
      <div class="comment__avatar">${c.author_role === 'admin' ? 'R' : (c.author_name?.[0] || 'C').toUpperCase()}</div>
      <div class="comment__content">
        <div class="comment__bubble">${nl2br(c.content)}</div>
        <div class="comment__meta">
          <strong>${esc(c.author_role === 'admin' ? 'Resonate' : (c.author_name || 'Client'))}</strong>
          <span>·</span>
          <span>${formatDateTime(c.created_at)}</span>
          <button class="btn btn--ghost btn--sm" style="font-size:11px; padding:2px 6px;"
            data-comment-id="${c.id}" onclick="window.__deleteComment(${c.id})">Delete</button>
        </div>
      </div>
    </div>`).join('');

  // Expose delete function
  window.__deleteComment = async (id) => {
    if (!confirm('Delete this message?')) return;
    try {
      await api.deleteComment(_clientId, id);
      _data.comments = _data.comments.filter(c => c.id !== id);
      renderComments(_data.comments);
      toast('Message deleted.');
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function sendComment() {
  const input = document.getElementById('comment-input');
  const text  = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('send-comment-btn');
  btn.disabled = true;

  try {
    const comment = await api.addComment(_clientId, { content: text });
    _data.comments.push(comment);
    renderComments(_data.comments);
    input.value = '';
    toast('Message sent.');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

// ---- Notes ----

function renderNotes(notes) {
  const el    = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  if (!notes.length) {
    el.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  el.innerHTML = notes.map(n => `
    <div class="note" data-note-id="${n.id}">
      <div class="note__content">${nl2br(n.content)}</div>
      <div class="note__meta">
        ${formatDateTime(n.created_at)}
        <button class="btn btn--ghost btn--sm" style="font-size:11px; padding:2px 6px;"
          onclick="window.__editNote(${n.id})">Edit</button>
        <button class="btn btn--ghost btn--sm" style="font-size:11px; padding:2px 6px; color:var(--s-amber);"
          onclick="window.__deleteNote(${n.id})">Delete</button>
      </div>
    </div>`).join('');

  window.__editNote = (id) => {
    const note = _data.notes.find(n => n.id === id);
    if (!note) return;
    _editingNoteId = id;
    document.getElementById('note-content').value = note.content;
    document.getElementById('modal-note-title').textContent = 'Edit Note';
    openModal('modal-note');
  };

  window.__deleteNote = async (id) => {
    if (!confirm('Delete this note?')) return;
    try {
      await api.deleteNote(_clientId, id);
      _data.notes = _data.notes.filter(n => n.id !== id);
      renderNotes(_data.notes);
      toast('Note deleted.');
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openAddNote() {
  _editingNoteId = null;
  document.getElementById('note-content').value = '';
  document.getElementById('modal-note-title').textContent = 'Add Private Note';
  openModal('modal-note');
}

async function saveNote() {
  const content = document.getElementById('note-content').value.trim();
  if (!content) { toast('Note cannot be empty.', 'error'); return; }

  const btn = document.getElementById('note-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    if (_editingNoteId) {
      const note = await api.updateNote(_clientId, _editingNoteId, { content });
      const idx  = _data.notes.findIndex(n => n.id === _editingNoteId);
      if (idx >= 0) _data.notes[idx] = note;
    } else {
      const note = await api.addNote(_clientId, { content });
      _data.notes.unshift(note);
    }
    renderNotes(_data.notes);
    closeModal('modal-note');
    toast('Note saved.');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save Note'; }
}

// ---- Links ----

function addLinkRow(link = null, projectId = null, containerEl = null) {
  if (!containerEl) return; // requires an explicit container (project-scoped)

  const listEl = containerEl;
  const row = document.createElement('div');
  row.className = 'link-row';
  if (link?.id) row.dataset.id = String(link.id);

  // Label input
  const labelInp = document.createElement('input');
  labelInp.type = 'text';
  labelInp.className = 'form-control link-row__label';
  labelInp.placeholder = 'e.g. Download Zoho Mail App';
  labelInp.value = link?.label || '';

  // URL input
  const urlInp = document.createElement('input');
  urlInp.type = 'text';
  urlInp.className = 'form-control link-row__url';
  urlInp.placeholder = 'https://…';
  urlInp.value = link?.url || '';

  // Client-visible eye toggle
  // New (unsaved) rows are always created as visible=1; the toggle is enabled only after first save.
  let isVisible = link ? !!link.is_client_visible : true;
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'btn--icon-bare';
  function syncEye() {
    const unsaved = !row.dataset.id;
    eyeBtn.title = unsaved
      ? 'Visible to client by default — save to change'
      : (isVisible ? 'Shown on client portal — click to hide' : 'Hidden from client portal — click to show');
    eyeBtn.style.opacity = unsaved ? '0.35' : '1';
    eyeBtn.style.cursor  = unsaved ? 'default' : 'pointer';
    eyeBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;${isVisible ? ' color:var(--brand)' : ' opacity:0.3'}">visibility</span>`;
  }
  syncEye();
  eyeBtn.addEventListener('click', async () => {
    if (!row.dataset.id) return; // not saved yet — always visible on first save
    isVisible = !isVisible;
    syncEye();
    try {
      const updated = await api.updateLink(_clientId, +row.dataset.id, { is_client_visible: isVisible });
      const l = _data.links.find(x => x.id === +row.dataset.id);
      if (l) l.is_client_visible = updated.is_client_visible;
    } catch (err) {
      isVisible = !isVisible; syncEye();
      toast(err.message, 'error');
    }
  });

  // Remove button
  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'btn--icon-bare';
  xBtn.title = 'Remove link';
  xBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; color:var(--s-red, #f87171)">close</span>`;
  xBtn.addEventListener('click', async () => {
    if (row.dataset.id) {
      if (!confirm('Delete this link?')) return;
      try {
        await api.deleteLink(_clientId, +row.dataset.id);
        _data.links = _data.links.filter(x => x.id !== +row.dataset.id);
        row.remove();
      } catch (err) { toast(err.message, 'error'); }
    } else {
      row.remove();
    }
  });

  // Auto-save: fires when either input loses focus, saves when both fields are filled
  let isSaving = false;
  async function autoSave() {
    if (isSaving) return;
    const label = labelInp.value.trim();
    const url   = urlInp.value.trim();
    if (!label || !url) return;
    isSaving = true;
    try {
      if (row.dataset.id) {
        const updated = await api.updateLink(_clientId, +row.dataset.id, { label, url });
        const l = _data.links.find(x => x.id === +row.dataset.id);
        if (l) { l.label = updated.label; l.url = updated.url; }
      } else if (projectId !== null) {
        // Create new link (edit-project flow: project already has an id)
        const created = await api.addLink(_clientId, { label, url, is_client_visible: 1, project_id: projectId });
        row.dataset.id = String(created.id);
        isVisible = true;   // keep in sync with what was saved
        syncEye();          // activate the toggle now that the row has an id
        _data.links.push(created);
      }
      // else: projectId is null (add-project flow) — saved in saveProject after project is created
    } catch (err) { toast(err.message, 'error'); }
    finally { isSaving = false; }
  }
  labelInp.addEventListener('blur', autoSave);
  urlInp.addEventListener('blur', autoSave);

  row.append(labelInp, urlInp, eyeBtn, xBtn);
  listEl.appendChild(row);

  if (!link) labelInp.focus();
}

// ---- Projects CRUD ----

function isProjectFormDirty() {
  if (_editingProjectId) return false; // edit flow: existing project, no discard concern
  const title = document.getElementById('proj-title')?.value.trim();
  const links  = document.querySelectorAll('#proj-links-list .link-row');
  return (!!title && title.length > 0) || links.length > 0;
}

function openAddProject() {
  _editingProjectId = null;
  clearProjectForm();
  document.getElementById('modal-project-title').textContent = 'Add Project';
  document.getElementById('proj-delete-btn').classList.add('hidden');
  openModal('modal-project', () => {
    if (!isProjectFormDirty()) return true;
    return confirm('Discard unsaved project?');
  });
}

function openEditProject(id) {
  const p = _data.projects.find(p => p.id === id);
  if (!p) return;
  _editingProjectId = id;

  document.getElementById('proj-title').value     = p.title       || '';
  document.getElementById('proj-status').value    = p.status      || 'not_started';
  document.getElementById('proj-desc-en').value   = p.description_en     || '';
  document.getElementById('proj-desc-pt').value   = p.description_pt     || '';
  document.getElementById('proj-future-en').value = p.future_features_en || '';
  document.getElementById('proj-future-pt').value = p.future_features_pt || '';
  document.getElementById('proj-due').value       = p.due_date    || '';
  document.getElementById('proj-visible').checked = !!p.is_client_visible;

  // Show and populate the links section with this project's links
  const linksList = document.getElementById('proj-links-list');
  document.getElementById('proj-links-section').style.display = '';
  linksList.innerHTML = '';
  (_data.links || [])
    .filter(l => l.project_id === id)
    .forEach(l => addLinkRow(l, id, linksList));

  document.getElementById('modal-project-title').textContent = 'Edit Project';
  document.getElementById('proj-delete-btn').classList.remove('hidden');
  openModal('modal-project');
}

function clearProjectForm() {
  ['proj-title','proj-desc-en','proj-desc-pt','proj-future-en','proj-future-pt','proj-due']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('proj-status').value    = 'not_started';
  document.getElementById('proj-visible').checked = true;
  document.getElementById('proj-links-section').style.display = '';
  document.getElementById('proj-links-list').innerHTML = '';
}

async function saveProject() {
  const title = document.getElementById('proj-title').value.trim();
  if (!title) { toast('Project title is required.', 'error'); return; }

  const data = {
    title,
    status:               document.getElementById('proj-status').value,
    description_en:       document.getElementById('proj-desc-en').value.trim()   || null,
    description_pt:       document.getElementById('proj-desc-pt').value.trim()   || null,
    future_features_en:   document.getElementById('proj-future-en').value.trim() || null,
    future_features_pt:   document.getElementById('proj-future-pt').value.trim() || null,
    due_date:             document.getElementById('proj-due').value               || null,
    is_client_visible:    document.getElementById('proj-visible').checked,
  };

  const btn = document.getElementById('proj-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (_editingProjectId) {
      const res = await api.updateProject(_clientId, _editingProjectId, data);
      const idx = _data.projects.findIndex(p => p.id === _editingProjectId);
      if (idx >= 0) _data.projects[idx] = res.project;
      if (res.all_projects_complete) {
        document.getElementById('all-complete-banner')?.classList.remove('hidden');
      }
    } else {
      // Create at sort_order 0 so it lands at the top
      const project = await api.createProject(_clientId, { ...data, sort_order: 0 });

      // Shift all existing projects down by 1 (in parallel)
      if (_data.projects.length > 0) {
        await Promise.all(
          _data.projects.map((p, idx) =>
            api.updateProject(_clientId, p.id, { sort_order: idx + 1 })
          )
        );
        _data.projects.forEach((p, idx) => { p.sort_order = idx + 1; });
      }

      _data.projects.unshift(project);  // prepend so in-memory order matches DB

      // Save any link rows filled in before the project existed
      const linkRows = document.querySelectorAll('#proj-links-list .link-row');
      for (const row of linkRows) {
        if (row.dataset.id) continue;  // already saved (shouldn't happen in add flow)
        const lbl = row.querySelector('.link-row__label').value.trim();
        const lUrl = row.querySelector('.link-row__url').value.trim();
        if (lbl && lUrl) {
          try {
            const created = await api.addLink(_clientId, { label: lbl, url: lUrl, is_client_visible: 1, project_id: project.id });
            _data.links.push(created);
          } catch { /* best-effort */ }
        }
      }

      document.getElementById('all-complete-banner')?.classList.add('hidden');
    }

    renderProgress(_data.projects);
    renderProjects(_data.projects);
    closeModal('modal-project');
    toast('Project saved.');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save Project'; }
}

async function deleteProject() {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  try {
    await api.deleteProject(_clientId, _editingProjectId);
    _data.projects = _data.projects.filter(p => p.id !== _editingProjectId);
    renderProgress(_data.projects);
    renderProjects(_data.projects);
    closeModal('modal-project');
    toast('Project deleted.');
  } catch (err) { toast(err.message, 'error'); }
}

// ---- Edit client ----

function openEditClient() {
  const c = _data.client;
  document.getElementById('ec-name').value          = c.name             || '';
  document.getElementById('ec-business').value      = c.business_name    || '';
  document.getElementById('ec-status').value        = c.overall_status   || '';
  document.getElementById('ec-lang').value          = c.language_preference || 'en';
  document.getElementById('ec-phone').value         = c.phone            || '';
  document.getElementById('ec-whatsapp').value      = c.whatsapp         || '';
  document.getElementById('ec-email').value         = c.email            || '';
  document.getElementById('ec-website').value       = c.website          || '';
  document.getElementById('ec-address').value       = c.address          || '';
  document.getElementById('ec-contact-notes').value = c.contact_notes    || '';
  openModal('modal-edit-client');
}

async function saveClient() {
  const data = {
    name:                document.getElementById('ec-name').value.trim(),
    business_name:       document.getElementById('ec-business').value.trim()      || null,
    overall_status:      document.getElementById('ec-status').value.trim()        || 'active',
    language_preference: document.getElementById('ec-lang').value,
    phone:               document.getElementById('ec-phone').value.trim()         || null,
    whatsapp:            document.getElementById('ec-whatsapp').value.trim()      || null,
    email:               document.getElementById('ec-email').value.trim()         || null,
    website:             document.getElementById('ec-website').value.trim()       || null,
    address:             document.getElementById('ec-address').value.trim()       || null,
    contact_notes:       document.getElementById('ec-contact-notes').value.trim() || null,
  };
  if (!data.name) { toast('Name is required.', 'error'); return; }

  const btn = document.getElementById('ec-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const updated = await api.updateClient(_clientId, data);
    _data.client = updated;
    render();
    closeModal('modal-edit-client');
    toast('Client updated.');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
}

// ---- Archive ----

async function archiveClient() {
  const isArchived = _data.client.is_archived;
  const msg = isArchived
    ? 'Restore this client to active?'
    : 'Archive this client? They move to the Archive tab. All data is preserved.';
  if (!confirm(msg)) return;

  try {
    if (isArchived) {
      await api.restoreClient(_clientId);
      toast('Client restored.');
    } else {
      await api.archiveClient(_clientId);
      toast('Client archived.');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
      return;
    }
    await loadData();
  } catch (err) { toast(err.message, 'error'); }
}

// ---- People on this client ----
//
// A client is a business, and a business often has more than one person whose
// day-to-day work is worth capturing: the owner who runs it, and the spouse or
// manager who runs the back office. This is a list, not a single linked user.

// An interview in progress must be visibly distinct from a finished one, so
// Nicole can tell who she is still waiting on without opening anything.
function interviewStatusChip(person) {
  if (person.interview_status === 'completed') {
    const when = person.interview_completed_at
      ? ` ${formatDate(person.interview_completed_at)}`
      : '';
    return `<span class="badge" style="background:rgba(52,211,153,.14); color:#34d399;">Interview complete${esc(when)}</span>`;
  }
  if (person.interview_status === 'in_progress') {
    return `<span class="badge" style="background:rgba(251,191,36,.16); color:#fbbf24;">Interview in progress</span>`;
  }
  if (person.interview_status === 'abandoned') {
    return `<span class="badge" style="background:rgba(248,113,113,.14); color:#f87171;">Interview abandoned</span>`;
  }
  return `<span class="badge" style="background:rgba(255,255,255,.06); color:var(--text-3);">Not started</span>`;
}

function renderPeople(people, client) {
  const el = document.getElementById('portal-access-block');
  const rows = (people || []).filter(p => p.role !== 'admin');

  const list = rows.length ? rows.map(p => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
    const roleLabel = p.interview_role
      ? esc(p.interview_role)
      : '<span style="color:var(--text-3);">role not set</span>';

    return `
      <div style="padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:13px; color:var(--text-2);">
          <strong>${esc(name || p.email)}</strong>
          ${name ? `<br><span style="font-size:12px; color:var(--text-3);">${esc(p.email)}</span>` : ''}
        </div>
        <div style="font-size:12px; color:var(--text-2); margin-top:4px;">${roleLabel}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:8px;">
          <span class="badge" style="background:rgba(255,255,255,.06); color:var(--text-3);">Portal access</span>
          ${interviewStatusChip(p)}
        </div>
        <label class="form-check" style="margin-top:10px;">
          <input type="checkbox" data-person-intake="${p.id}" ${p.intake_enabled ? 'checked' : ''}>
          <span style="font-size:12px;">Takes the intake interview</span>
        </label>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn--secondary btn--sm" data-edit-person="${p.id}">Edit role</button>
          <button class="btn btn--danger btn--sm" data-remove-person="${esc(p.firebase_uid)}">Remove access</button>
        </div>
      </div>`;
  }).join('') : `<div style="font-size:13px; color:var(--text-3); margin-bottom:8px;">No portal logins configured.</div>`;

  el.innerHTML = `
    ${list}
    <button class="btn btn--secondary btn--sm" id="add-person-btn" style="margin-top:12px;">Add a person</button>
    <div class="text-muted" style="margin-top:8px; font-size:12px; line-height:1.5;">
      The client-level switch below turns interviews on for the business.
      Each person here is enrolled individually.
    </div>`;

  document.getElementById('add-person-btn').addEventListener('click', () => {
    document.getElementById('pa-email').value = '';
    document.getElementById('pa-first').value = '';
    document.getElementById('pa-last').value  = '';
    document.getElementById('pa-role').value  = '';
    document.getElementById('pa-intake').checked = false;
    document.getElementById('pa-result').classList.add('hidden');
    document.getElementById('pa-form').classList.remove('hidden');
    openModal('modal-portal-access');
  });

  el.querySelectorAll('[data-person-intake]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.getAttribute('data-person-intake');
      cb.disabled = true;
      try {
        await api.updatePerson(_clientId, id, { intake_enabled: cb.checked });
        toast(cb.checked ? 'Interview enabled for this person.' : 'Interview disabled for this person.');
        await loadData();
      } catch (err) {
        cb.checked = !cb.checked;
        toast(err.message, 'error');
      } finally { cb.disabled = false; }
    });
  });

  el.querySelectorAll('[data-edit-person]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-edit-person');
      const person = rows.find(p => String(p.id) === String(id));
      const next = prompt(
        'What does this person do in the business?\n(for example: owner, back office, operations)',
        person?.interview_role || ''
      );
      if (next === null) return;
      try {
        await api.updatePerson(_clientId, id, { interview_role: next.trim() });
        toast('Role updated.');
        await loadData();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Removing access must be honest about what it does and does not touch.
  // A completed interview is Nicole's working material and outlives the login.
  el.querySelectorAll('[data-remove-person]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-remove-person');
      const person = rows.find(p => p.firebase_uid === uid);
      const hasInterview = person && person.session_count > 0;
      const msg = hasInterview
        ? 'Remove this person\'s portal login?\n\n'
          + 'They will no longer be able to sign in.\n\n'
          + 'Their interview answers are KEPT and stay readable on the results '
          + 'page, but the answers will no longer show who gave them.'
        : 'Remove this person\'s portal login?\n\nThey will no longer be able to sign in.';
      if (!confirm(msg)) return;
      try {
        await api.deleteUser(uid);
        toast('Portal access removed. Interview answers kept.');
        await loadData();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// Adding a person creates a REAL login for a REAL person, through the same
// Firebase path the Add Client flow uses. The temporary password is shown
// once and is not recoverable afterwards, so the modal keeps it on screen
// until Nicole dismisses it rather than closing on success.
async function savePortalAccess() {
  const email = document.getElementById('pa-email').value.trim();
  const first = document.getElementById('pa-first').value.trim();
  const last  = document.getElementById('pa-last').value.trim();
  const role  = document.getElementById('pa-role').value.trim();
  const intake = document.getElementById('pa-intake').checked;
  if (!email) { toast('An email address is required.', 'error'); return; }

  const btn = document.getElementById('pa-save-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const res = await api.addPerson(_clientId, {
      email,
      first_name:     first,
      last_name:      last,
      interview_role: role,
      intake_enabled: intake,
    });

    document.getElementById('pa-form').classList.add('hidden');
    const out = document.getElementById('pa-result');
    out.classList.remove('hidden');
    out.innerHTML = `
      <p style="font-size:13px; color:var(--text-2); line-height:1.6;">
        A login was created for <strong>${esc(email)}</strong>.
        Give them this temporary password — it is not shown again.
      </p>
      <div style="font-family:var(--mono); font-size:16px; background:rgba(255,255,255,.06);
                  padding:12px; border-radius:8px; margin-top:8px; user-select:all;">
        ${esc(res.temp_password || '(not created)')}
      </div>`;

    await loadData();
    toast('Person added.');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Create login'; }
}

// ---- Interview results link ----

function renderResultsLink(client) {
  const el = document.getElementById('intake-results-block');
  if (!el) return;

  // No interview, no link. A dead link that opens an empty page is worse
  // than no link at all.
  const count = _data.intake_session_count || 0;
  if (!count) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');
  el.innerHTML = `
    <a class="btn btn--primary btn--sm" href="intake-results.html?client=${encodeURIComponent(_clientId)}">
      Read interview results
    </a>
    <div class="text-muted" style="margin-top:6px; font-size:12px;">
      ${count} interview${count === 1 ? '' : 's'} recorded for this client.
    </div>`;
}

// ---- Intake interview toggle ----

function renderIntakeToggle(client) {
  const el = document.getElementById('intake-toggle-block');
  let isEnabled = !!client.intake_enabled;

  let isTest = !!client.is_test_client;

  el.innerHTML = `
    <label class="form-check">
      <input id="intake-enabled-toggle" type="checkbox" ${isEnabled ? 'checked' : ''}>
      <span>Intake interviews enabled for this business</span>
    </label>
    <div class="text-muted" style="margin-top:4px; font-size:12px; line-height:1.5;">
      The overall on switch. Each person above is then enrolled individually,
      so turning this on does not offer the interview to everyone here.
    </div>
    <label class="form-check" style="margin-top:12px;">
      <input id="test-client-toggle" type="checkbox" ${isTest ? 'checked' : ''}>
      <span>Test client, allows preview writing</span>
    </label>
    <div class="text-muted" style="margin-top:6px; font-size:12px; line-height:1.5;">
      Marking this client as a test client is what permits an administrator to
      <strong>write</strong> to their portal while previewing it. Leave this off for every
      real client: preview stays read-only and the API refuses preview writes.
    </div>`;

  const testCheckbox = document.getElementById('test-client-toggle');
  testCheckbox.addEventListener('change', async () => {
    const next = testCheckbox.checked;
    testCheckbox.disabled = true;
    try {
      const updated = await api.updateClient(_clientId, { is_test_client: next });
      isTest = !!updated.is_test_client;
      _data.client.is_test_client = isTest;
      testCheckbox.checked = isTest;
    } catch (err) {
      testCheckbox.checked = isTest; // revert on error
      toast(err.message, 'error');
    } finally {
      testCheckbox.disabled = false;
    }
  });

  const checkbox = document.getElementById('intake-enabled-toggle');
  checkbox.addEventListener('change', async () => {
    const next = checkbox.checked;
    checkbox.disabled = true;
    try {
      const updated = await api.updateClient(_clientId, { intake_enabled: next });
      isEnabled = !!updated.intake_enabled;
      _data.client.intake_enabled = isEnabled;
      checkbox.checked = isEnabled;
    } catch (err) {
      checkbox.checked = isEnabled; // revert on error
      toast(err.message, 'error');
    } finally {
      checkbox.disabled = false;
    }
  });
}

// ---- Status history ----

function renderHistory(history) {
  const el = document.getElementById('history-list');
  if (!history?.length) {
    el.innerHTML = '<span class="text-muted">No status changes recorded.</span>';
    return;
  }
  el.innerHTML = history.slice(0, 10).map(h => `
    <div>
      <span style="color:var(--text-2);">${h.entity_type === 'project' ? '◈ Project' : '◉ Client'}</span>
      <span>${esc(h.old_status)} → <strong>${esc(h.new_status)}</strong></span><br>
      <span>${formatDateTime(h.changed_at)}</span>
    </div>`).join('');
}

init();


// ---------------------------------------------------------------------------
// Meetings section — prep pages for this client, newest first.
//
// Each meeting is its own page and its own set of notes, so a second meeting
// never overwrites the first. Defined here rather than fetched: meetings are
// scheduled, few, and known in advance. When there are enough of them to be
// worth a table, this becomes an API call and nothing else changes.
// ---------------------------------------------------------------------------

function renderMeetings() {
  const el = document.getElementById('meetings-list');
  if (!el) return;

  const rows = MEETINGS[Number(_clientId)] || [];

  if (!rows.length) {
    el.innerHTML = '<div style="font-size:12px; color:var(--text-3);">No meetings prepared.</div>';
    return;
  }

  el.innerHTML = rows.map(m => {
    const d = new Date(m.date + 'T12:00:00');
    const when = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const past = d < new Date(new Date().toDateString());
    return `
      <a href="meeting.html?client=${encodeURIComponent(_clientId)}&m=${encodeURIComponent(m.key)}"
         class="flex items-center gap-2 py-2 text-[13px] transition-colors ${past ? 'text-outline-variant' : 'text-primary-fixed-dim'} hover:text-white">
        <span class="material-symbols-outlined text-[16px]">co_present</span>
        <span>
          ${esc(m.label)}
          <span style="color:var(--text-3); font-size:12px;"> · ${when}${m.time ? ' · ' + esc(m.time) : ''}</span>
        </span>
      </a>`;
  }).join('');
}
