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
  document.getElementById('ni-add-item-btn').addEventListener('click', () => addItemRow());
  document.getElementById('ni-save-btn').addEventListener('click', createInvoice);
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
      <div class="flex items-center gap-2 justify-end"></div>
    </div>`;
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
  addItemRow();
  updateComposeTotal();

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

function addItemRow(item = null) {
  const list = document.getElementById('ni-items');
  const row  = document.createElement('div');
  row.className = 'ni-item-row';
  row.style.cssText = 'display:grid; grid-template-columns: 1fr 64px 96px 84px auto; gap:8px; align-items:center;';
  row.innerHTML = `
    <input type="text"   class="form-control ni-item-name" placeholder="${esc(t('inv_form_item_name'))}" value="${esc(item?.name || '')}">
    <input type="number" class="form-control ni-item-qty"  placeholder="${esc(t('inv_form_qty'))}"  min="0" step="1"    value="${item?.quantity ?? 1}">
    <input type="number" class="form-control ni-item-rate" placeholder="${esc(t('inv_form_rate'))}" min="0" step="0.01" value="${item?.rate ?? ''}">
    <span class="ni-item-amount text-outline-variant text-[13px]" style="text-align:right;">$0.00</span>
    <button type="button" class="btn--icon-bare ni-item-remove" title="Remove">
      <span class="material-symbols-outlined" style="font-size:16px; color:var(--s-red, #f87171)">close</span>
    </button>`;

  row.querySelector('.ni-item-remove').addEventListener('click', () => {
    row.remove();
    updateComposeTotal();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateComposeTotal));
  list.appendChild(row);
}

function readItemRows() {
  return [...document.querySelectorAll('#ni-items .ni-item-row')].map(row => ({
    name:     row.querySelector('.ni-item-name').value.trim(),
    quantity: parseFloat(row.querySelector('.ni-item-qty').value) || 0,
    rate:     parseFloat(row.querySelector('.ni-item-rate').value) || 0,
  }));
}

function updateComposeTotal() {
  let total = 0;
  document.querySelectorAll('#ni-items .ni-item-row').forEach(row => {
    const qty  = parseFloat(row.querySelector('.ni-item-qty').value)  || 0;
    const rate = parseFloat(row.querySelector('.ni-item-rate').value) || 0;
    const amount = qty * rate;
    row.querySelector('.ni-item-amount').textContent = money(amount, 'USD');
    total += amount;
  });
  document.getElementById('ni-total').textContent = money(total, 'USD');
}

async function createInvoice() {
  niError(null);
  const clientId = parseInt(document.getElementById('ni-client').value);
  const items    = readItemRows().filter(li => li.name && li.quantity > 0);

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

init();
