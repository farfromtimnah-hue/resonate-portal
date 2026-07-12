// ============================================================
// Admin books view — all Zoho invoices across clients, tabbed
// Draft / Unpaid / Archive. Zoho is the source of truth for
// invoice status; Archive is a local D1 flag (is_archived).
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t, invoiceStatusLabel } from './t.js';
import { esc, toast, invoiceStatusClass } from './utils.js';

let _invoices  = [];
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

init();
