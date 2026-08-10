// ============================================================
// Intake interview results — the screen where Nicole reads a
// completed interview. Admin only.
//
// Organised by PERSON first. A client is a business, and a business
// often has more than one person whose work was captured. Two people
// describing the same underlying work from different angles is itself
// a finding, so their entries are never merged into one list: each
// person's account is read on its own, and Nicole moves between them.
// ============================================================

import { requireAuth } from './auth.js';
import { api }         from './api.js';
import { esc, nl2br, formatDate, formatDateTime, toast, qp } from './utils.js?v=2';

var _clientId = null;
var _sessions = [];          // one bundle per session, person-first
var _selected = 0;
var _clientName = '';

// The five dimensions, with labels that say what is actually being asked
// rather than repeating the column name.
var DIMENSIONS = [
  { key: 'what',        label: 'What the task is' },
  { key: 'how',         label: 'How it is done, step by step' },
  { key: 'why_trigger', label: 'What triggers it' },
  { key: 'time_cost',   label: 'What it costs in time, and how often' },
  { key: 'pain_level',  label: 'How they feel about it' }
];

async function init() {
  var profile = await requireAuth('admin');
  if (!profile) return;

  _clientId = qp('client');
  if (!_clientId) { window.location.href = 'dashboard.html'; return; }

  var backLink = document.getElementById('back-link');
  if (backLink) backLink.href = 'client.html?id=' + encodeURIComponent(_clientId);

  var printBtn = document.getElementById('print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  var copyBtn = document.getElementById('copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', copyAsMarkdown);

  await loadData();
}

async function loadData() {
  try {
    var data = await api.interviewExport(_clientId);
    var sessions = data.sessions || [];

    // Oldest first reads as a chronology rather than a stack.
    sessions.sort(function (a, b) {
      return String(a.session.created_at).localeCompare(String(b.session.created_at));
    });

    // Fetch each session's translation through the translated endpoint, so a
    // Portuguese session that has never been translated gets translated once
    // on first read and served from cache afterwards.
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].session.language === 'pt') {
        try {
          var t = await api.interviewTranslated(sessions[i].session.id, false);
          sessions[i].translation = t.translation || null;
          sessions[i].translation_status = t.translation_status || null;
        } catch (e) {
          // A translation failure must never cost Nicole the page.
          sessions[i].translation = null;
          sessions[i].translation_status = 'unavailable';
        }
      } else {
        sessions[i].translation_status = 'not_needed';
      }
    }

    _sessions = sessions;

    var client = await api.getClient(_clientId);
    _clientName = client.client
      ? (client.client.business_display_name || client.client.business_name || client.client.name || ('Client ' + _clientId))
      : ('Client ' + _clientId);

    render();
  } catch (err) {
    var el = document.getElementById('loading');
    if (el) {
      el.innerHTML = '<div style="color:#f87171;">Failed to load interview</div>' +
        '<div style="color:#9ca3af; font-size:13px; margin-top:8px;">' + esc(err.message) + '</div>';
    }
  }
}

// ------------------------------------------------------------
// Person identity
// ------------------------------------------------------------

function personName(bundle) {
  var p = bundle.person;
  if (!p) return 'Unattributed';
  var name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return name || p.email || ('Person ' + p.id);
}

function personRole(bundle) {
  var p = bundle.person;
  if (!p) return null;
  return p.interview_role || null;
}

// ------------------------------------------------------------
// Translation lookup
// ------------------------------------------------------------

// English for one field, or null when there is none. Null is meaningful:
// it means show the original alone rather than inventing a translation.
function translated(bundle, key) {
  if (!bundle.translation || !bundle.translation.fields) return null;
  var v = bundle.translation.fields[key];
  return v != null && v !== '' ? v : null;
}

// Render one field with English and the Portuguese original BOTH visible,
// without a click. The original is quieter in the hierarchy but present:
// when a translation seems off, the client's own words are the check.
function bilingualBlock(bundle, key, original) {
  if (!original) return '';
  var en = translated(bundle, key);
  if (!en) {
    // No translation: the original stands alone, unlabelled as a
    // translation so it is never mistaken for one.
    return '<div>' + nl2br(esc(original)) + '</div>';
  }
  return '' +
    '<div><span class="lang-tag" style="font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-3);">English</span>' +
    '<div>' + nl2br(esc(en)) + '</div></div>' +
    '<div class="pt-original" style="margin-top:6px; padding-left:10px; border-left:2px solid rgba(255,255,255,.14); opacity:.72; font-size:13px;">' +
    '<span class="lang-tag" style="font-size:10px; text-transform:uppercase; letter-spacing:.08em;">Portuguese, as written</span>' +
    '<div>' + nl2br(esc(original)) + '</div></div>';
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------

function render() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('page').classList.remove('hidden');

  document.getElementById('results-client').textContent = _clientName;
  document.getElementById('results-sub').textContent =
    _sessions.length + ' interview' + (_sessions.length === 1 ? '' : 's') +
    ' across ' + countPeople() + ' ' + (countPeople() === 1 ? 'person' : 'people');

  renderTabs();
  renderSections();
}

function countPeople() {
  var seen = {};
  var n = 0;
  for (var i = 0; i < _sessions.length; i++) {
    var p = _sessions[i].person;
    var k = p ? String(p.id) : 'unattributed';
    if (!seen[k]) { seen[k] = true; n++; }
  }
  return n;
}

// Moving between people on the same client without going back.
function renderTabs() {
  var el = document.getElementById('person-tabs');
  if (_sessions.length <= 1) { el.innerHTML = ''; return; }

  el.innerHTML = _sessions.map(function (b, i) {
    var role = personRole(b);
    var active = i === _selected;
    return '<button class="btn btn--sm ' + (active ? 'btn--primary' : 'btn--secondary') + '" data-person-tab="' + i + '">' +
      esc(personName(b)) +
      (role ? ' <span style="opacity:.7;">· ' + esc(role) + '</span>' : '') +
      '</button>';
  }).join('');

  el.querySelectorAll('[data-person-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _selected = parseInt(btn.getAttribute('data-person-tab'));
      renderTabs();
      renderSections();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderSections() {
  var el = document.getElementById('people-sections');
  el.innerHTML = _sessions.map(function (b, i) {
    // Every section is in the DOM so print can show them all; on screen
    // only the selected one is visible.
    var hidden = i === _selected ? '' : ' style="display:none;"';
    return '<section class="person-section" data-person-index="' + i + '"' + hidden + '>' +
      renderPersonSection(b) + '</section>';
  }).join('');

  el.querySelectorAll('[data-retranslate]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      retranslate(parseInt(btn.getAttribute('data-retranslate')), btn);
    });
  });
}

function renderPersonSection(b) {
  return renderHeader(b) + renderEntries(b) + renderFuture(b) + renderPreferences(b) + renderTranscript(b);
}

// What Nicole needs before reading: who, their role, when, which
// language, how much was captured, and how much needs her review.
function renderHeader(b) {
  var s = b.session;
  var entries = b.entries || [];
  var tasks = entries.filter(function (e) { return e.section === 'task'; });
  var problems = entries.filter(function (e) { return e.section === 'problem'; });
  var needsReview = entries.filter(function (e) { return e.completeness === 'incomplete_needs_review'; });

  var role = personRole(b);
  var inProgress = s.status !== 'completed';

  var when = s.completed_at
    ? 'Taken ' + formatDateTime(s.completed_at)
    : (s.created_at ? 'Started ' + formatDateTime(s.created_at) : 'Date unknown');

  var html = '';
  html += '<div class="summary-card" style="background:var(--surface-2, rgba(255,255,255,.04)); border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:18px; margin-bottom:20px;">';
  html += '<h2 style="margin:0; font-size:20px;">' + esc(personName(b)) + '</h2>';

  html += '<div style="font-size:13px; color:var(--text-2); margin-top:2px;">' +
    (role ? esc(role) : '<span class="missing" style="color:#f87171;">role in the business not recorded</span>') +
    '</div>';

  if (!b.person) {
    html += '<div class="flag" style="margin-top:8px; font-size:12px; display:inline-block; padding:2px 8px; border-radius:6px; background:rgba(248,113,113,.14); color:#f87171;">' +
      'These answers are not attributed to a person. The interview predates per-person tracking, or the login was removed.</div>';
  }

  // An interview still in progress must say so plainly rather than being
  // presented as a finished one.
  if (inProgress) {
    html += '<div class="flag flag-review" style="margin-top:10px; font-size:13px; padding:8px 10px; border-radius:8px; background:rgba(251,191,36,.14); color:#fbbf24;">' +
      '<strong>This interview is still in progress.</strong> What follows is a partial interview, not a finished one.</div>';
  }

  html += '<div style="display:flex; flex-wrap:wrap; gap:16px; margin-top:14px; font-size:13px; color:var(--text-2);">';
  html += '<div>' + esc(when) + '</div>';
  html += '<div>Language: ' + (s.language === 'pt' ? 'Portuguese' : 'English') + '</div>';
  html += '<div>' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + '</div>';
  html += '<div>' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + '</div>';
  html += '<div' + (needsReview.length ? ' style="color:#fbbf24; font-weight:600;"' : '') + '>' +
    needsReview.length + ' need' + (needsReview.length === 1 ? 's' : '') + ' your review</div>';
  html += '</div>';

  html += renderTranslationControl(b);
  html += '</div>';
  return html;
}

// One control to re-run the translation, and when the stored one was made.
function renderTranslationControl(b) {
  if (b.session.language !== 'pt') return '';

  var idx = _sessions.indexOf(b);
  var stamp = b.translation && b.translation.generated_at
    ? 'Translated ' + formatDateTime(b.translation.generated_at)
    : null;

  var status = '';
  if (b.translation_status === 'unavailable' || (!b.translation && b.translation_status !== 'not_needed')) {
    status = '<span style="color:#f87171;">Translation unavailable — showing the client\'s Portuguese below.</span>';
  } else if (b.translation_status === 'stale_unavailable') {
    status = '<span style="color:#fbbf24;">Re-translation failed — showing the previously stored translation.</span>';
  } else if (stamp) {
    status = '<span style="color:var(--text-3);">' + esc(stamp) + '</span>';
  }

  return '<div class="no-print" style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.06); font-size:12px;">' +
    '<button class="btn btn--secondary btn--sm" data-retranslate="' + idx + '">Re-run translation</button>' +
    status + '</div>';
}

// Entries grouped as tasks and problems, in the order given.
function renderEntries(b) {
  var entries = b.entries || [];
  var tasks = entries.filter(function (e) { return e.section === 'task'; });
  var problems = entries.filter(function (e) { return e.section === 'problem'; });

  var html = '';
  html += renderGroup(b, 'Tasks', tasks, 'No tasks were captured in this interview.');
  html += renderGroup(b, 'Problems', problems, 'No problems were captured in this interview.');
  return html;
}

function renderGroup(b, title, rows, emptyText) {
  var html = '<h3 style="font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-3); margin:28px 0 12px;">' +
    esc(title) + ' (' + rows.length + ')</h3>';
  if (!rows.length) {
    html += '<div class="text-muted" style="font-size:13px;">' + esc(emptyText) + '</div>';
    return html;
  }
  html += rows.map(function (e, i) { return renderEntry(b, e, i + 1); }).join('');
  return html;
}

function renderEntry(b, e, n) {
  var html = '';
  html += '<article class="entry-card" style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:16px; margin-bottom:14px;">';

  html += '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px;">';
  html += '<span style="font-size:12px; color:var(--text-3);">#' + n + '</span>';

  // An entry the interview gave up on after its follow-up cap. That means
  // the person could not or would not answer, which is itself a finding.
  if (e.completeness === 'incomplete_needs_review') {
    html += '<span class="flag flag-review" style="font-size:12px; font-weight:700; padding:3px 9px; border-radius:6px; background:rgba(251,191,36,.18); color:#fbbf24;">' +
      'NEEDS REVIEW — the interview stopped asking after ' + (e.followup_count != null ? e.followup_count : 2) +
      ' follow-ups without a full answer</span>';
  } else if (e.completeness === 'skipped') {
    html += '<span class="flag" style="font-size:12px; font-weight:600; padding:3px 9px; border-radius:6px; background:rgba(255,255,255,.08); color:var(--text-2);">' +
      'Skipped — they genuinely did not know</span>';
  } else if (e.completeness === 'in_progress') {
    html += '<span class="flag" style="font-size:12px; font-weight:600; padding:3px 9px; border-radius:6px; background:rgba(255,255,255,.08); color:var(--text-2);">' +
      'Left unfinished</span>';
  } else if (e.completeness === 'complete') {
    html += '<span class="flag" style="font-size:12px; padding:3px 9px; border-radius:6px; background:rgba(52,211,153,.14); color:#34d399;">Complete</span>';
  }
  html += '</div>';

  for (var i = 0; i < DIMENSIONS.length; i++) {
    html += renderDimension(b, e, DIMENSIONS[i]);
  }

  // A fix the person proposed themselves, captured separately and
  // deliberately never evaluated. Shown distinctly from the task
  // description and labelled as theirs: Nicole decides what to make of it.
  if (e.solution_jump_note) {
    html += '<div class="solution-jump" style="margin-top:14px; padding:12px; border:1px dashed rgba(156,202,255,.45); border-radius:10px; background:rgba(156,202,255,.06);">';
    html += '<div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--primary-fixed-dim, #9ccaff); font-weight:700; margin-bottom:6px;">' +
      'Their own proposed fix — not evaluated</div>';
    html += '<div style="font-size:13px;">' +
      bilingualBlock(b, 'entry.' + e.id + '.solution_jump_note', e.solution_jump_note) + '</div>';
    html += '</div>';
  }

  html += '</article>';
  return html;
}

// A dimension that was never captured reads as explicitly missing rather
// than blank: a gap is information Nicole acts on.
function renderDimension(b, e, dim) {
  var value = e[dim.key];
  var html = '<div class="dimension" style="margin-top:10px;">';
  html += '<div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-3); margin-bottom:3px;">' +
    esc(dim.label) + '</div>';

  if (!value) {
    html += '<div class="missing" style="font-size:13px; color:#f87171; font-style:italic;">Not captured</div>';
  } else {
    html += '<div style="font-size:13px;">' +
      bilingualBlock(b, 'entry.' + e.id + '.' + dim.key, value) + '</div>';
  }
  html += '</div>';
  return html;
}

// A skipped future section is a deliberate answer, not missing data: it
// signals an owner in survival mode, so it is shown explicitly.
function renderFuture(b) {
  var f = b.future;
  var html = '<h3 style="font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-3); margin:28px 0 12px;">Where the business is going</h3>';

  if (!f) {
    html += '<div class="missing" style="font-size:13px; color:#f87171; font-style:italic;">This section was never reached.</div>';
    return html;
  }

  if (f.skipped) {
    html += '<div class="flag" style="font-size:13px; padding:12px; border-radius:10px; background:rgba(251,191,36,.12); color:#fbbf24;">' +
      '<strong>Declined to discuss the future of the business.</strong> ' +
      'They chose to skip this section — a deliberate answer, not missing data.</div>';
    return html;
  }

  if (!f.vision_text) {
    html += '<div class="missing" style="font-size:13px; color:#f87171; font-style:italic;">Not captured</div>';
    return html;
  }

  html += '<div class="entry-card" style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:16px; font-size:13px;">' +
    bilingualBlock(b, 'future.vision_text', f.vision_text) + '</div>';
  return html;
}

// The four preference answers, placed after the entries so they do not
// compete with them.
var PREF_LABELS = {
  format_preference:         'How they like to receive information',
  density_preference:        'How much at once',
  data_narrative_preference: 'How they like numbers presented',
  control_trust_preference:  'How much they want to approve'
};

var PREF_VALUES = {
  written: 'Written', spoken: 'Spoken', visual: 'Visual', hands_on: 'Hands on',
  short_scannable: 'Short and scannable', everything_at_once: 'Everything at once',
  numbers: 'Numbers', plain_language: 'Plain language', headline_then_data: 'Headline, then the data',
  approve_first: 'Approve first', flag_exceptions_only: 'Flag exceptions only', depends_on_task: 'Depends on the task'
};

function renderPreferences(b) {
  var p = b.preferences;
  var html = '<h3 style="font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-3); margin:28px 0 12px;">How they prefer to work</h3>';

  if (!p) {
    html += '<div class="text-muted" style="font-size:13px;">No preferences were recorded.</div>';
    return html;
  }

  html += '<div class="pref-card" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px;">';
  Object.keys(PREF_LABELS).forEach(function (k) {
    var v = p[k];
    html += '<div style="border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:12px;">' +
      '<div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-3);">' + esc(PREF_LABELS[k]) + '</div>' +
      '<div style="font-size:13px; margin-top:4px;">' +
      (v ? esc(PREF_VALUES[v] || v) : '<span class="missing" style="color:#f87171; font-style:italic;">Not answered</span>') +
      '</div></div>';
  });
  html += '</div>';
  return html;
}

// The raw conversation log, collapsed by default.
function renderTranscript(b) {
  var msgs = b.messages || [];
  var html = '<details style="margin-top:28px;">';
  html += '<summary style="cursor:pointer; font-size:13px; color:var(--text-2);">' +
    'Raw conversation log (' + msgs.length + ' message' + (msgs.length === 1 ? '' : 's') + ')</summary>';

  if (!msgs.length) {
    html += '<div class="text-muted" style="font-size:13px; margin-top:10px;">No messages were logged.</div>';
  } else {
    html += '<div style="margin-top:12px;">';
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var isQ = m.role === 'question';
      html += '<div style="margin-bottom:10px; padding-left:10px; border-left:2px solid ' +
        (isQ ? 'rgba(156,202,255,.35)' : 'rgba(255,255,255,.12)') + ';">' +
        '<div style="font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-3);">' +
        (isQ ? 'Question' : 'Answer') + '</div>' +
        '<div style="font-size:13px;">' +
        bilingualBlock(b, 'message.' + m.id + '.content', m.content) + '</div></div>';
    }
    html += '</div>';
  }
  html += '</details>';
  return html;
}

// ------------------------------------------------------------
// Re-run translation
// ------------------------------------------------------------

async function retranslate(index, btn) {
  var b = _sessions[index];
  if (!b) return;

  btn.disabled = true;
  var original = btn.textContent;
  btn.textContent = 'Translating…';

  try {
    var res = await api.interviewTranslated(b.session.id, true);
    b.translation = res.translation || null;
    b.translation_status = res.translation_status || null;

    if (b.translation_status === 'stale_unavailable' || b.translation_status === 'unavailable') {
      toast('Translation failed. Showing what is available.', 'error');
    } else {
      toast('Translation re-run.');
    }
    renderSections();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ------------------------------------------------------------
// Copy as Markdown
//
// For pasting into notes or into a conversation with an AI assistant.
// Preserves the person grouping, the section grouping and the dimension
// labels, and keeps the review flags: a copy that silently dropped the
// incomplete markers would mislead her later.
// ------------------------------------------------------------

function mdField(b, key, original, label) {
  if (!original) return '- **' + label + ':** _Not captured_\n';
  var en = translated(b, key);
  if (!en) return '- **' + label + ':** ' + oneLine(original) + '\n';
  return '- **' + label + ':** ' + oneLine(en) + '\n' +
         '  - _Portuguese, as written:_ ' + oneLine(original) + '\n';
}

function oneLine(text) {
  return String(text).replace(/\s*\n\s*/g, ' / ').trim();
}

function buildMarkdown() {
  var out = '';
  out += '# Intake interview — ' + _clientName + '\n\n';
  out += _sessions.length + ' interview(s) across ' + countPeople() + ' person/people.\n\n';

  for (var i = 0; i < _sessions.length; i++) {
    var b = _sessions[i];
    var s = b.session;
    var entries = b.entries || [];
    var tasks = entries.filter(function (e) { return e.section === 'task'; });
    var problems = entries.filter(function (e) { return e.section === 'problem'; });
    var needsReview = entries.filter(function (e) { return e.completeness === 'incomplete_needs_review'; });

    out += '\n---\n\n## ' + personName(b) + '\n\n';
    out += '- Role in the business: ' + (personRole(b) || '_not recorded_') + '\n';
    if (!b.person) out += '- **Not attributed to a person.**\n';
    out += '- Date: ' + (s.completed_at ? formatDateTime(s.completed_at) : (s.created_at ? formatDateTime(s.created_at) + ' (started)' : 'unknown')) + '\n';
    out += '- Language: ' + (s.language === 'pt' ? 'Portuguese' : 'English') + '\n';
    out += '- Captured: ' + tasks.length + ' task(s), ' + problems.length + ' problem(s)\n';
    out += '- Needing review: ' + needsReview.length + '\n';
    if (s.status !== 'completed') {
      out += '- **STILL IN PROGRESS — this is a partial interview, not a finished one.**\n';
    }
    out += '\n';

    out += mdSection(b, 'Tasks', tasks);
    out += mdSection(b, 'Problems', problems);

    // Future vision
    out += '### Where the business is going\n\n';
    if (!b.future) {
      out += '_This section was never reached._\n\n';
    } else if (b.future.skipped) {
      out += '**DECLINED to discuss the future of the business.** A deliberate answer, not missing data.\n\n';
    } else if (b.future.vision_text) {
      out += mdField(b, 'future.vision_text', b.future.vision_text, 'Vision');
      out += '\n';
    } else {
      out += '_Not captured._\n\n';
    }

    // Preferences
    out += '### How they prefer to work\n\n';
    if (!b.preferences) {
      out += '_No preferences recorded._\n\n';
    } else {
      Object.keys(PREF_LABELS).forEach(function (k) {
        var v = b.preferences[k];
        out += '- **' + PREF_LABELS[k] + ':** ' + (v ? (PREF_VALUES[v] || v) : '_Not answered_') + '\n';
      });
      out += '\n';
    }
  }

  return out;
}

function mdSection(b, title, rows) {
  var out = '### ' + title + ' (' + rows.length + ')\n\n';
  if (!rows.length) { return out + '_None captured._\n\n'; }

  for (var i = 0; i < rows.length; i++) {
    var e = rows[i];
    out += '#### ' + title.replace(/s$/, '') + ' ' + (i + 1);

    // The review flags travel with the copy.
    if (e.completeness === 'incomplete_needs_review') {
      out += ' — **NEEDS REVIEW** (interview stopped after ' +
        (e.followup_count != null ? e.followup_count : 2) + ' follow-ups without a full answer)';
    } else if (e.completeness === 'skipped') {
      out += ' — **SKIPPED** (they genuinely did not know)';
    } else if (e.completeness === 'in_progress') {
      out += ' — **LEFT UNFINISHED**';
    }
    out += '\n\n';

    for (var d = 0; d < DIMENSIONS.length; d++) {
      out += mdField(b, 'entry.' + e.id + '.' + DIMENSIONS[d].key, e[DIMENSIONS[d].key], DIMENSIONS[d].label);
    }

    if (e.solution_jump_note) {
      out += '\n> **Their own proposed fix — not evaluated:**\n';
      var en = translated(b, 'entry.' + e.id + '.solution_jump_note');
      if (en) {
        out += '> ' + oneLine(en) + '\n';
        out += '> _Portuguese, as written:_ ' + oneLine(e.solution_jump_note) + '\n';
      } else {
        out += '> ' + oneLine(e.solution_jump_note) + '\n';
      }
    }
    out += '\n';
  }
  return out;
}

async function copyAsMarkdown() {
  var text = buildMarkdown();
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied as Markdown.');
  } catch (err) {
    // Clipboard access can be refused; a textarea fallback keeps the
    // feature usable rather than failing silently.
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Copied as Markdown.');
    } catch (e2) {
      toast('Could not copy automatically.', 'error');
    }
    document.body.removeChild(ta);
  }
}

init();
