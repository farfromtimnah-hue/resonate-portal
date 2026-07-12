// ============================================================
// Bank reconciliation — CSV-imported bank transactions matched
// against cached invoices. Tabs: Unmatched / Matched / Excluded.
// Actions: Match, Unmatch, Exclude, Restore. The CSV is parsed
// in the browser and stored via the Worker into D1.
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t }                     from './t.js';
import { esc, toast, openModal, closeModal } from './utils.js';

let _txns      = [];
let _invoices  = null;   // lazy-loaded for the match picker
let _activeTab = 'unmatched';
let _matchingTxnId = null;

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  document.querySelectorAll('.books-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // CSV upload
  const fileInput = document.getElementById('csv-file-input');
  document.getElementById('upload-csv-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await importCsv(file);
    e.target.value = '';   // allow re-upload of the same file
  });

  // Row actions + match modal
  document.getElementById('txn-list').addEventListener('click', onRowAction);
  document.getElementById('match-save-btn').addEventListener('click', saveMatch);
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  await loadTransactions();
}

async function loadTransactions() {
  document.getElementById('txn-loading').classList.remove('hidden');
  try {
    _txns = await api.bankTransactions();
    renderTabs();
    renderList();
  } catch (err) {
    toast(err.message, 'error');
  }
  document.getElementById('txn-loading').classList.add('hidden');
}

// ---- CSV parsing ----

// Minimal CSV parser: handles quoted fields and commas inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

// Normalizes 07/15/2026 or 2026-07-15 to yyyy-mm-dd; anything else passes through.
function normalizeDate(s) {
  s = (s || '').trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return s;
}

function parseAmount(s) {
  const n = parseFloat(String(s ?? '').replace(/[$\s,]/g, ''));
  return isNaN(n) ? null : n;
}

// Maps CSV rows to {date, description, amount}. A header row naming the
// columns is used when present; otherwise columns are date, description, amount.
function csvToTransactions(rows) {
  if (!rows.length) return [];
  let cols = { date: 0, description: 1, amount: 2 };
  let start = 0;

  const header = rows[0].map(c => c.trim().toLowerCase());
  const hDate = header.findIndex(h => /^(date|data|txn.?date|transaction date)$/.test(h));
  const hDesc = header.findIndex(h => /^(description|descrição|descricao|memo|details?)$/.test(h));
  const hAmt  = header.findIndex(h => /^(amount|valor|value)$/.test(h));
  if (hDate >= 0 || hDesc >= 0 || hAmt >= 0) {
    cols = {
      date:        hDate >= 0 ? hDate : 0,
      description: hDesc >= 0 ? hDesc : 1,
      amount:      hAmt  >= 0 ? hAmt  : 2,
    };
    start = 1;
  }

  return rows.slice(start)
    .map(r => ({
      date:        normalizeDate(r[cols.date]),
      description: (r[cols.description] ?? '').trim(),
      amount:      parseAmount(r[cols.amount]),
    }))
    .filter(r => r.amount !== null);
}

async function importCsv(file) {
  const btn = document.getElementById('upload-csv-btn');
  btn.disabled = true;
  try {
    const text = await file.text();
    const txns = csvToTransactions(parseCsv(text));
    if (!txns.length) { toast('No usable rows found in that CSV.', 'error'); return; }
    const res = await api.bankImport(txns);
    toast(`Imported ${res.inserted} transaction${res.inserted === 1 ? '' : 's'}.`, 'success');
    await loadTransactions();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---- Tabs + list ----

function tabTxns(tab) {
  return _txns.filter(x => x.status === tab);
}

function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.books-tab').forEach(btn => {
    btn.classList.toggle('books-tab--active', btn.dataset.tab === tab);
  });
  renderList();
}

function renderTabs() {
  ['unmatched', 'matched', 'excluded'].forEach(tab => {
    document.getElementById(`count-${tab}`).textContent = `(${tabTxns(tab).length})`;
  });
}

function money(v, currency = 'USD') {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
}

function renderList() {
  const list  = document.getElementById('txn-list');
  const empty = document.getElementById('txn-empty');
  const rows  = tabTxns(_activeTab);

  empty.classList.toggle('hidden', rows.length > 0);
  empty.textContent = t('recon_empty');

  list.innerHTML = rows.map(x => {
    const matched = x.matched_invoice_number
      ? `${x.matched_invoice_number} · ${x.matched_client_business_name || x.matched_client_name || ''}`
      : '—';
    return `
      <div class="txn-row" data-txn-id="${x.id}">
        <span class="text-outline-variant text-[13px]">${esc(x.txn_date || '—')}</span>
        <span class="text-primary-fixed-dim text-[13px]" style="min-width:0; overflow:hidden; text-overflow:ellipsis;">${esc(x.description || '—')}</span>
        <span class="text-outline-variant text-[13px]">${esc(money(x.amount))}</span>
        <span class="txn-cell--optional text-outline-variant text-[12px]">${esc(matched)}</span>
        <div class="flex items-center gap-2 justify-end">${txnActionsHTML(x)}</div>
      </div>`;
  }).join('');
}

function txnActionsHTML(x) {
  const actionBtn = (action, label, primary = false) => `
    <button data-action="${action}" data-id="${x.id}"
            class="${primary
              ? 'bg-primary-container text-white text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity'
              : 'text-outline-variant hover:text-primary-fixed-dim text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 transition-colors'}">
      ${label}
    </button>`;

  if (x.status === 'matched')  return actionBtn('unmatch', esc(t('recon_unmatch')));
  if (x.status === 'excluded') return actionBtn('restore', esc(t('recon_restore')));
  return actionBtn('exclude', esc(t('recon_exclude'))) +
         actionBtn('match', esc(t('recon_match')), true);
}

async function onRowAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const txn = _txns.find(x => x.id === +btn.dataset.id);
  if (!txn) return;

  if (btn.dataset.action === 'match') return openMatchModal(txn);

  btn.disabled = true;
  try {
    const call = { unmatch: api.bankUnmatch, exclude: api.bankExclude, restore: api.bankRestore }[btn.dataset.action];
    const fresh = await call(txn.id);
    // Server rows lose the join fields on writes — refresh keeps them accurate
    Object.assign(txn, fresh);
    if (btn.dataset.action === 'unmatch') {
      txn.matched_invoice_number = null;
      txn.matched_client_business_name = null;
      txn.matched_client_name = null;
    }
    renderTabs();
    renderList();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

// ---- Match modal ----

async function openMatchModal(txn) {
  _matchingTxnId = txn.id;
  document.getElementById('match-txn-summary').textContent =
    `${txn.txn_date || ''} · ${txn.description || ''} · ${money(txn.amount)}`;

  const select = document.getElementById('match-invoice');
  select.innerHTML = `<option>${esc(t('loading'))}</option>`;
  openModal('modal-match');

  if (!_invoices) {
    try { _invoices = await api.zohoAllInvoices(); }
    catch (err) { toast(err.message, 'error'); return; }
  }

  // Exact-amount matches (against balance or total) float to the top
  const amount = Math.abs(txn.amount ?? 0);
  const candidates = _invoices
    .filter(inv => inv.status !== 'void')
    .map(inv => ({
      inv,
      suggested: Math.abs((inv.balance ?? -1) - amount) < 0.005 ||
                 Math.abs((inv.amount  ?? -1) - amount) < 0.005,
    }))
    .sort((a, b) => (b.suggested - a.suggested));

  select.innerHTML = candidates.map(({ inv, suggested }) => {
    const label = `${inv.invoice_number || inv.zoho_invoice_id} · ${inv.client_business_name || inv.client_name || ''} · ${money(inv.balance ?? inv.amount, inv.currency_code)}` +
                  (suggested ? ` (${t('recon_suggested')})` : '');
    return `<option value="${inv.id}">${esc(label)}</option>`;
  }).join('');
}

async function saveMatch() {
  const invoiceId = parseInt(document.getElementById('match-invoice').value);
  if (!invoiceId || !_matchingTxnId) return;

  const btn = document.getElementById('match-save-btn');
  btn.disabled = true;
  try {
    const fresh = await api.bankMatch(_matchingTxnId, invoiceId);
    const txn = _txns.find(x => x.id === _matchingTxnId);
    if (txn) {
      Object.assign(txn, fresh);
      const inv = (_invoices || []).find(i => i.id === invoiceId);
      txn.matched_invoice_number        = inv?.invoice_number ?? null;
      txn.matched_client_business_name  = inv?.client_business_name ?? null;
      txn.matched_client_name           = inv?.client_name ?? null;
    }
    renderTabs();
    renderList();
    closeModal('modal-match');
    toast('Transaction matched.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

init();
