// ============================================================
// Admin books view — all Zoho invoices across clients, tabbed
// Draft / Unpaid / Archive. Zoho is the source of truth for
// invoice status; Archive is a local D1 flag (is_archived).
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t, invoiceStatusLabel } from './t.js';
import { esc, toast, invoiceStatusClass, openModal, closeModal } from './utils.js';

let _invoices  = [];
let _clients   = null;       // lazy-loaded for the New Invoice client picker
let _activeTab = 'unpaid';   // 'draft' | 'unpaid' | 'archive'

// Zoho statuses that count as "unpaid" (sent but not settled).
// Paid-but-not-yet-archived invoices also show on this tab so they
// can be archived from here — Archive is a manual, local action.
const UNPAID_STATUSES = ['sent', 'viewed', 'unpaid', 'partially_paid', 'overdue', 'paid'];

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  document.querySelectorAll('.books-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('sync-all-btn').addEventListener('click', syncAll);

  // New Invoice modal
  document.getElementById('new-invoice-btn').addEventListener('click', openNewInvoice);
  document.getElementById('ni-add-item-btn').addEventListener('click', () => addItemRow('ni-items', 'ni-total'));
  document.getElementById('ni-save-btn').addEventListener('click', createInvoice);

  // Edit Draft modal
  document.getElementById('ei-add-item-btn').addEventListener('click', () => addItemRow('ei-items', 'ei-total'));
  document.getElementById('ei-save-btn').addEventListener('click', saveInvoiceItems);

  // Row actions — event delegation on the list
  document.getElementById('invoices-list').addEventListener('click', onRowAction);
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  await loadInvoices();
}

async function loadInvoices() {
  document.getElementById('invoices-loading').classList.remove('hidden');
  try {
    _invoices = await api.zohoAllInvoices();
    renderTabs();
    renderList();
  } catch (err) {
    toast(err.message, 'error');
  }
  document.getElementById('invoices-loading').classList.add('hidden');
}

async function syncAll() {
  const btn = document.getElementById('sync-all-btn');
  btn.disabled = true;
  try {
    const res = await api.zohoSyncAll();
    toast(`Synced ${res.synced} invoice${res.synced === 1 ? '' : 's'} from Zoho.`, 'success');
    await loadInvoices();
  } catch (err) {
    const messages = {
      zoho_not_connected:        'Zoho is not connected yet — use Connect Zoho Invoice on the dashboard first.',
      zoho_organization_missing: 'Zoho connection has no organization — reconnect from the dashboard.',
    };
    toast(messages[err.message] || 'Invoice sync failed. Please try again.', 'error');
  }
  btn.disabled = false;
}

// ---- Tab filtering ----

function tabInvoices(invoices, tab) {
  if (tab === 'archive') return invoices.filter(i => i.is_archived === 1);
  if (tab === 'draft')   return invoices.filter(i => i.is_archived !== 1 && i.status === 'draft');
  return invoices.filter(i => i.is_archived !== 1 && UNPAID_STATUSES.includes(i.status));
}

function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.books-tab').forEach(btn => {
    btn.classList.toggle('books-tab--active', btn.dataset.tab === tab);
  });
  renderList();
}

function renderTabs() {
  document.getElementById('count-draft').textContent   = `(${tabInvoices(_invoices, 'draft').length})`;
  document.getElementById('count-unpaid').textContent  = `(${tabInvoices(_invoices, 'unpaid').length})`;
  document.getElementById('count-archive').textContent = `(${tabInvoices(_invoices, 'archive').length})`;
  document.getElementById('books-subtitle').textContent =
    `${_invoices.length} invoice${_invoices.length !== 1 ? 's' : ''}`;
}

// ---- List rendering ----

function money(amount, currency) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
}

function renderList() {
  const list  = document.getElementById('invoices-list');
  const empty = document.getElementById('invoices-empty');
  const rows  = tabInvoices(_invoices, _activeTab);

  empty.classList.toggle('hidden', rows.length > 0);
  empty.textContent = t(`books_empty_${_activeTab}`);

  list.innerHTML = rows.map(inv => invoiceRowHTML(inv)).join('');
}

function invoiceRowHTML(inv) {
  const clientLabel = inv.client_business_name || inv.client_name || '';
  return `
    <div class="invoice-row" data-invoice-id="${inv.id}">
      <div style="min-width:0;">
        <a href="client.html?id=${inv.client_id}"
           class="text-primary-fixed-dim text-[13px] font-semibold no-underline hover:underline">${esc(clientLabel)}</a>
      </div>
      <span class="text-outline-variant text-[13px]">${esc(inv.invoice_number || inv.zoho_invoice_id)}</span>
      <span><span class="badge ${invoiceStatusClass(inv.status)}">${esc(invoiceStatusLabel(inv.status))}</span></span>
      <span class="invoice-cell--optional text-outline-variant text-[13px]">${esc(money(inv.amount, inv.currency_code))}</span>
      <span class="invoice-cell--optional text-outline-variant text-[13px]">${esc(money(inv.balance, inv.currency_code))}</span>
      <span class="invoice-cell--optional text-outline-variant text-[13px]">${esc(inv.due_date || '—')}</span>
      <div class="flex items-center gap-2 justify-end">${rowActionsHTML(inv)}</div>
    </div>`;
}

// Per-row actions depend on where the invoice sits in its lifecycle.
function rowActionsHTML(inv) {
  const actionBtn = (action, label, primary = false) => `
    <button data-action="${action}" data-id="${inv.id}"
            class="${primary
              ? 'bg-primary-container text-white text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity'
              : 'text-outline-variant hover:text-primary-fixed-dim text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 transition-colors'}">
      ${label}
    </button>`;

  if (inv.is_archived === 1) return '';
  if (inv.status === 'draft') {
    return actionBtn('edit', esc(t('inv_edit')));
  }
  return '';
}

async function onRowAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const inv = _invoices.find(i => i.id === +btn.dataset.id);
  if (!inv) return;

  if (btn.dataset.action === 'edit') return openEditInvoice(inv, btn);
}

// ---- New Invoice (Nova Fatura) — always created as a Zoho DRAFT ----

function niError(msg) {
  const el = document.getElementById('ni-error');
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function openNewInvoice() {
  niError(null);
  document.getElementById('ni-due').value   = '';
  document.getElementById('ni-notes').value = '';
  document.getElementById('ni-items').innerHTML = '';
  addItemRow('ni-items', 'ni-total');

  const select = document.getElementById('ni-client');
  if (!_clients) {
    select.innerHTML = `<option>${esc(t('loading'))}</option>`;
    try { _clients = await api.clients(); }
    catch (err) { niError(err.message); _clients = null; }
  }
  if (_clients) {
    select.innerHTML = _clients.map(c =>
      `<option value="${c.id}">${esc(c.business_name || c.name)}</option>`
    ).join('');
  }
  openModal('modal-new-invoice');
}

// Shared line-item row builder — used by both the New Invoice ('ni')
// and Edit Draft ('ei') modals. Each row keeps live line totals.
function addItemRow(listId, totalId, item = null) {
  const list = document.getElementById(listId);
  const row  = document.createElement('div');
  row.className = 'ni-item-row';
  if (item?.line_item_id) row.dataset.lineItemId = item.line_item_id;
  row.style.cssText = 'display:grid; grid-template-columns: 1fr 64px 96px 84px auto; gap:8px; align-items:center;';
  row.innerHTML = `
    <input type="text"   class="form-control ni-item-name" placeholder="${esc(t('inv_form_item_name'))}" value="${esc(item?.name || '')}">
    <input type="number" class="form-control ni-item-qty"  placeholder="${esc(t('inv_form_qty'))}"  min="0" step="1"    value="${item?.quantity ?? 1}">
    <input type="number" class="form-control ni-item-rate" placeholder="${esc(t('inv_form_rate'))}" min="0" step="0.01" value="${item?.rate ?? ''}">
    <span class="ni-item-amount text-outline-variant text-[13px]" style="text-align:right;">$0.00</span>
    <button type="button" class="btn--icon-bare ni-item-remove" title="Remove">
      <span class="material-symbols-outlined" style="font-size:16px; color:var(--s-red, #f87171)">close</span>
    </button>`;

  const refresh = () => updateItemsTotal(listId, totalId);
  row.querySelector('.ni-item-remove').addEventListener('click', () => {
    row.remove();
    refresh();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', refresh));
  list.appendChild(row);
  refresh();
}

function readItemRows(listId) {
  return [...document.querySelectorAll(`#${listId} .ni-item-row`)].map(row => ({
    ...(row.dataset.lineItemId ? { line_item_id: row.dataset.lineItemId } : {}),
    name:     row.querySelector('.ni-item-name').value.trim(),
    quantity: parseFloat(row.querySelector('.ni-item-qty').value) || 0,
    rate:     parseFloat(row.querySelector('.ni-item-rate').value) || 0,
  }));
}

function updateItemsTotal(listId, totalId) {
  let total = 0;
  document.querySelectorAll(`#${listId} .ni-item-row`).forEach(row => {
    const qty  = parseFloat(row.querySelector('.ni-item-qty').value)  || 0;
    const rate = parseFloat(row.querySelector('.ni-item-rate').value) || 0;
    const amount = qty * rate;
    row.querySelector('.ni-item-amount').textContent = money(amount, 'USD');
    total += amount;
  });
  document.getElementById(totalId).textContent = money(total, 'USD');
}

async function createInvoice() {
  niError(null);
  const clientId = parseInt(document.getElementById('ni-client').value);
  const items    = readItemRows('ni-items').filter(li => li.name && li.quantity > 0);

  if (!clientId)     { niError('Select a client.'); return; }
  if (!items.length) { niError('Add at least one line item with a name and quantity.'); return; }

  const btn = document.getElementById('ni-save-btn');
  btn.disabled = true;
  btn.textContent = t('inv_creating');

  try {
    const row = await api.zohoCreateInvoice({
      client_id:  clientId,
      line_items: items,
      due_date:   document.getElementById('ni-due').value || null,
      notes:      document.getElementById('ni-notes').value.trim() || null,
    });
    // Merge into the local list and show it on the Draft tab
    const idx = _invoices.findIndex(i => i.zoho_invoice_id === row.zoho_invoice_id);
    const client = (_clients || []).find(c => c.id === clientId);
    const merged = {
      ...row,
      client_name:          client?.name          ?? '',
      client_business_name: client?.business_name ?? '',
      client_email:         client?.email         ?? null,
      client_whatsapp:      client?.whatsapp      ?? null,
    };
    if (idx >= 0) _invoices[idx] = merged; else _invoices.unshift(merged);
    renderTabs();
    switchTab('draft');
    closeModal('modal-new-invoice');
    toast('Draft invoice created in Zoho.', 'success');
  } catch (err) {
    const messages = {
      zoho_not_connected:          'Zoho is not connected — use Connect Zoho Invoice on the dashboard first.',
      zoho_organization_missing:   'Zoho connection has no organization — reconnect from the dashboard.',
      zoho_contact_create_failed:  'Could not create the Zoho contact for this client.',
      zoho_invoice_create_failed:  'Zoho did not accept the invoice. Please try again.',
      zoho_api_error:              'Zoho rejected the request. Please try again.',
    };
    niError(messages[err.message] || err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('inv_create');
  }
}

// ---- Edit Draft line items — persists to the real Zoho invoice ----

let _editingInvoiceId = null;

function eiError(msg) {
  const el = document.getElementById('ei-error');
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function openEditInvoice(inv, triggerBtn) {
  triggerBtn.disabled = true;
  try {
    // Read the current line items from the REAL Zoho invoice, not the cache
    const detail = await api.zohoInvoiceItems(inv.id);
    if (detail.status !== 'draft') {
      toast('Only draft invoices can be edited.', 'error');
      await loadInvoices();   // cache said draft but Zoho disagrees — refresh
      return;
    }
    _editingInvoiceId = inv.id;
    eiError(null);
    document.getElementById('ei-number').textContent = detail.invoice_number || '';
    document.getElementById('ei-items').innerHTML = '';
    (detail.line_items.length ? detail.line_items : [null]).forEach(li =>
      addItemRow('ei-items', 'ei-total', li)
    );
    openModal('modal-edit-invoice');
  } catch (err) {
    toast(err.message === 'zoho_api_error' ? 'Could not load the invoice from Zoho.' : err.message, 'error');
  } finally {
    triggerBtn.disabled = false;
  }
}

async function saveInvoiceItems() {
  eiError(null);
  const items = readItemRows('ei-items').filter(li => li.name && li.quantity > 0);
  if (!items.length) { eiError('Add at least one line item with a name and quantity.'); return; }

  const btn = document.getElementById('ei-save-btn');
  btn.disabled = true;
  btn.textContent = t('saving');

  try {
    const fresh = await api.zohoUpdateInvoiceItems(_editingInvoiceId, { line_items: items });
    const idx = _invoices.findIndex(i => i.id === fresh.id);
    if (idx >= 0) _invoices[idx] = { ..._invoices[idx], ...fresh };
    renderTabs();
    renderList();
    closeModal('modal-edit-invoice');
    toast('Invoice updated in Zoho.', 'success');
  } catch (err) {
    const messages = {
      invoice_not_draft:           'This invoice is no longer a draft in Zoho — refresh the list.',
      zoho_invoice_update_failed:  'Zoho did not accept the change. Please try again.',
      zoho_api_error:              'Zoho rejected the request. Please try again.',
    };
    eiError(messages[err.message] || err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('inv_save_items');
  }
}

init();
