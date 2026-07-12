// ============================================================
// Finance page — single page with a persistent pill tab bar for
// Books & Invoicing / Financial Health / Bank Reconciliation.
// Each panel keeps its original page's logic (previously
// books.js / financial.js / reconciliation.js), scoped into its
// own init function. The pill bar swaps visible panels in place;
// each panel's data loads once, on first activation.
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t, invoiceStatusLabel } from './t.js';
import { esc, toast, invoiceStatusClass, openModal, closeModal } from './utils.js';

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  initPillBar();
  await initFinancial();   // default-visible panel (Financial Health) loads immediately
}

// ---- Pill tab bar — switches panels in place, no navigation --------
// AR Aging and Tax Summary share Financial Health's data load (same Zoho
// year fetches), so all three route through the one `financial` lazy init.

const PANEL_INIT = {
  financial:      { fn: initFinancial,      started: false },
  aging:          { fn: initFinancial,      started: false, sharedWith: 'financial' },
  tax:            { fn: initFinancial,      started: false, sharedWith: 'financial' },
  invoices:       { fn: initInvoices,       started: false },
  reconciliation: { fn: initReconciliation, started: false },
  tools:          { fn: initTools,          started: false },
};
// Financial Health starts already loaded (init() calls it directly above).
PANEL_INIT.financial.started = true;

function initPillBar() {
  document.querySelectorAll('.finance-pill').forEach(btn => {
    btn.addEventListener('click', () => switchFinanceTab(btn.dataset.financeTab));
  });
}

async function switchFinanceTab(tab) {
  document.querySelectorAll('.finance-pill').forEach(btn => {
    const active = btn.dataset.financeTab === tab;
    btn.classList.toggle('finance-pill--active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.finance-panel').forEach(panel => {
    panel.classList.toggle('finance-panel--active', panel.id === `finance-panel-${tab}`);
  });

  const lazy = PANEL_INIT[tab];
  if (!lazy) return;
  const gate = lazy.sharedWith ? PANEL_INIT[lazy.sharedWith] : lazy;
  if (!gate.started) {
    gate.started = true;
    lazy.started = true;
    await lazy.fn();
  }
}

// ============================================================
// Panel: Books & Invoicing (formerly books.js)
// Admin view of all Zoho invoices across clients, tabbed
// Draft / Unpaid / Archive. Zoho is the source of truth for
// invoice status; Archive is a local D1 flag (is_archived).
// ============================================================

let _invoices  = [];
let _clients   = null;       // lazy-loaded for the New Invoice client picker
let _activeTab = 'unpaid';   // 'draft' | 'unpaid' | 'archive'

// Zoho statuses that count as "unpaid" (sent but not settled).
// Paid-but-not-yet-archived invoices also show on this tab so they
// can be archived from here — Archive is a manual, local action.
const UNPAID_STATUSES = ['sent', 'viewed', 'unpaid', 'partially_paid', 'overdue', 'paid'];

async function initInvoices() {
  document.querySelectorAll('#finance-panel-invoices .books-tab').forEach(btn => {
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
  document.querySelectorAll('#finance-panel-invoices .books-tab').forEach(btn => {
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

// Builds the invoice-template.html URL for an invoice (Ver Fatura / View Invoice)
export function invoiceTemplateUrl(inv, lang = 'en') {
  return `invoice-template.html?invoice_id=${encodeURIComponent(inv.zoho_invoice_id)}&lang=${lang}`;
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
  const viewLink = `
    <a href="${esc(invoiceTemplateUrl(inv))}" target="_blank" rel="noopener"
       class="text-outline-variant hover:text-primary-fixed-dim text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 whitespace-nowrap no-underline transition-colors">
      ${esc(t('invoice_view'))}
    </a>`;

  if (inv.is_archived === 1) {
    return viewLink + actionBtn('restore', esc(t('inv_restore')));
  }
  if (inv.status === 'draft') {
    return viewLink +
           actionBtn('edit', esc(t('inv_edit'))) +
           actionBtn('finalize', esc(t('inv_finalize')), true);
  }
  // Unpaid tab (sent / overdue / partially paid / paid awaiting archive)
  const send = inv.status !== 'paid' ? actionBtn('send', esc(t('inv_send')), true) : '';
  return viewLink + actionBtn('archive', esc(t('inv_archive'))) + send;
}

async function onRowAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const inv = _invoices.find(i => i.id === +btn.dataset.id);
  if (!inv) return;

  if (btn.dataset.action === 'edit')     return openEditInvoice(inv, btn);
  if (btn.dataset.action === 'finalize') return finalizeInvoice(inv, btn);
  if (btn.dataset.action === 'archive')  return setArchived(inv, btn, true);
  if (btn.dataset.action === 'restore')  return setArchived(inv, btn, false);
  if (btn.dataset.action === 'send')     return showSendMenu(inv, btn);
}

// ---- Send via WhatsApp or Email (Books Phase 7) ------------------
// Deep links only — Send never touches Zoho status; Finalize is separate.
// The menu items are plain <a href> anchors built synchronously here, so
// navigation happens directly in the user's click — no popup blocking.

function sendMessageFor(inv) {
  const lang    = inv.client_language === 'pt' ? 'pt' : 'en';
  const name    = (inv.client_name || '').trim().split(/\s+/)[0] || '';
  const number  = inv.invoice_number || inv.zoho_invoice_id;
  const amount  = money(inv.balance ?? inv.amount, inv.currency_code);
  const viewUrl = new URL(invoiceTemplateUrl(inv, lang), window.location.href).href;
  const due     = inv.due_date || '';

  const msgEn = `Hi ${name}! Your invoice ${number} (${amount}${due ? `, due ${due}` : ''}) is ready. View it here: ${viewUrl}`;
  const msgPt = `Oi ${name}! Sua fatura ${number} (${amount}${due ? `, vencimento ${due}` : ''}) está pronta. Veja aqui: ${viewUrl}`;
  return { lang, subject: lang === 'pt' ? `Fatura ${number} — Resonate` : `Invoice ${number} — Resonate`,
           text: lang === 'pt' ? msgPt : msgEn };
}

function showSendMenu(inv, anchorEl) {
  let menu = document.getElementById('books-send-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'books-send-menu';
    menu.className = 'share-menu';
    document.body.appendChild(menu);
  }

  const { subject, text } = sendMessageFor(inv);
  const waNum  = (inv.client_whatsapp || '').replace(/[\s\-\(\)\+]/g, '');
  const waHref = waNum
    ? `https://wa.me/${waNum}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  const mailHref = `mailto:${encodeURIComponent(inv.client_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  menu.innerHTML = `
    <a class="share-menu__item" href="${esc(waHref)}" target="_blank" rel="noopener noreferrer">
      <span class="share-menu__icon">💬</span>WhatsApp
    </a>
    <a class="share-menu__item" href="${esc(mailHref)}">
      <span class="share-menu__icon">✉️</span>Email
    </a>`;
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', hideSendMenu));

  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = 172;
  menu.style.display = 'block';
  menu.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - menuWidth - 12)}px`;

  const close = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) {
      hideSendMenu();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', onEsc);
    }
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      hideSendMenu();
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', onEsc);
    }
  };
  // Defer so the Send button's own click doesn't immediately close the menu
  setTimeout(() => {
    document.addEventListener('click', close, true);
    document.addEventListener('keydown', onEsc);
  }, 0);
}

function hideSendMenu() {
  const menu = document.getElementById('books-send-menu');
  if (menu) menu.style.display = 'none';
}

// ---- Lifecycle actions ----

function mergeInvoiceRow(fresh) {
  const idx = _invoices.findIndex(i => i.id === fresh.id);
  if (idx >= 0) _invoices[idx] = { ..._invoices[idx], ...fresh };
  renderTabs();
  renderList();
}

// Finalize = Zoho mark-as-sent ONLY. It never opens anything and never
// sends anything — Send (WhatsApp/Email) is a separate action.
async function finalizeInvoice(inv, btn) {
  if (!confirm(t('inv_finalize_confirm'))) return;
  btn.disabled = true;
  try {
    const fresh = await api.zohoFinalizeInvoice(inv.id);
    mergeInvoiceRow(fresh);
    toast('Invoice finalized — now unpaid in Zoho.', 'success');
  } catch (err) {
    const messages = {
      invoice_not_draft: 'This invoice is no longer a draft in Zoho — refresh the list.',
      zoho_api_error:    'Zoho rejected the request. Please try again.',
    };
    toast(messages[err.message] || err.message, 'error');
    btn.disabled = false;
  }
}

// Archive/Restore only flips the local is_archived flag — Zoho status untouched.
async function setArchived(inv, btn, flag) {
  btn.disabled = true;
  try {
    const fresh = await (flag ? api.zohoArchiveInvoice(inv.id) : api.zohoRestoreInvoice(inv.id));
    mergeInvoiceRow(fresh);
    toast(flag ? 'Invoice archived.' : 'Invoice restored.', 'success');
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
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

// ============================================================
// Panel: Financial Health (formerly financial.js)
// Every money figure is pulled live from the connected Zoho
// account (payments = income, expenses straight from
// GET /expenses, never a local cache table), plus AR Aging from
// cached unpaid invoices and a manual subscriptions list stored
// in D1. No sales tax exists anywhere in the portal.
// ============================================================

// Statuses whose balances count as receivable
const OPEN_STATUSES = ['sent', 'viewed', 'unpaid', 'partially_paid', 'overdue'];

const BUCKETS = [
  { key: 'current', labelKey: 'fin_bucket_current', min: -Infinity, max: 0,        cls: '' },
  { key: '1_30',    labelKey: 'fin_bucket_1_30',    min: 1,         max: 30,       cls: '' },
  { key: '31_60',   labelKey: 'fin_bucket_31_60',   min: 31,        max: 60,       cls: 'aging-tile--warn' },
  { key: '61_90',   labelKey: 'fin_bucket_61_90',   min: 61,        max: 90,       cls: 'aging-tile--warn' },
  { key: '90_plus', labelKey: 'fin_bucket_90_plus', min: 91,        max: Infinity, cls: 'aging-tile--danger' },
];

const INCOME_COLOR  = '#9ccaff';   // primary-fixed-dim — matches every key figure
const EXPENSE_COLOR = '#ffb781';   // tertiary-fixed-dim — matches warning amounts

let _yearData      = {};   // year → { payments: [], expenses: [] } fetched live from Zoho
let _subscriptions = [];
let _editingSubId  = null; // null = creating

async function initFinancial() {
  document.getElementById('pl-period').addEventListener('change', renderPeriodSections);
  document.getElementById('annual-year').addEventListener('change', renderAnnual);
  document.getElementById('annual-print-btn').addEventListener('click', () => window.print());

  document.getElementById('sub-add-btn').addEventListener('click', () => openSubscriptionModal(null));
  document.getElementById('sub-save-btn').addEventListener('click', saveSubscription);
  document.getElementById('subs-list').addEventListener('click', onSubscriptionAction);
  document.getElementById('modal-subscription').querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.getElementById('modal-subscription').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-subscription')) closeModal('modal-subscription');
  });

  buildYearOptions();

  try {
    const year = new Date().getFullYear();
    // The trend + "last 6 months" period can reach into the previous year,
    // so both years load up front, in parallel with the cached invoices
    // (AR aging only) and the manual subscriptions list.
    const [invoices, subs] = await Promise.all([
      api.zohoAllInvoices(),
      api.subscriptions(),
      loadYear(year),
      loadYear(year - 1),
    ]);
    _subscriptions = subs;

    renderAging(invoices);
    renderSubscriptions();
    renderTrend();
    renderPeriodSections();
    await renderAnnual();

    document.getElementById('fin-loading').classList.add('hidden');
    document.getElementById('fin-content').classList.remove('hidden');
    document.getElementById('aging-loading').classList.add('hidden');
    document.getElementById('aging-content').classList.remove('hidden');
  } catch (err) {
    const messages = {
      zoho_not_connected:        'Zoho is not connected yet — use Connect Zoho Invoice on the dashboard first.',
      zoho_organization_missing: 'Zoho connection has no organization — reconnect from the dashboard.',
      zoho_api_error:            'Zoho rejected the request. Please try again.',
    };
    const text = messages[err.message] || err.message;
    document.getElementById('fin-loading').textContent = text;
    document.getElementById('aging-loading').textContent = text;
  }
}

// ---- Live Zoho data, one calendar year at a time ------------------
// The date filter is passed to Zoho AND re-applied here, so totals stay
// correct even if Zoho ignores a filter param.

async function loadYear(year) {
  if (_yearData[year]) return _yearData[year];
  const range  = `?date_start=${year}-01-01&date_end=${year}-12-31`;
  const within = (r) => r.date && r.date >= `${year}-01-01` && r.date <= `${year}-12-31`;
  const [payments, expenses] = await Promise.all([
    api.zohoPayments(range),
    api.zohoExpenses(range),
  ]);
  _yearData[year] = {
    payments: payments.filter(within),
    expenses: expenses.filter(within),
  };
  return _yearData[year];
}

function loadedRecords(kind) {
  return Object.values(_yearData).flatMap(d => d[kind]);
}

const sum = (rows, field) => rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);

// ---- Period selection ---------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }
function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function lastDayOf(year, month1) { return new Date(year, month1, 0).getDate(); }

// Returns { start, end } as yyyy-mm-dd for the P&L period selector.
function periodRange(period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();  // m: 0-based
  const today = `${y}-${pad2(m + 1)}-${pad2(now.getDate())}`;
  if (period === 'this_month') return { start: `${y}-${pad2(m + 1)}-01`, end: today };
  if (period === 'last_month') {
    const d = new Date(y, m - 1, 1);
    const ly = d.getFullYear(), lm = d.getMonth() + 1;
    return { start: `${ly}-${pad2(lm)}-01`, end: `${ly}-${pad2(lm)}-${pad2(lastDayOf(ly, lm))}` };
  }
  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3 + 1;
    return { start: `${y}-${pad2(qStart)}-01`, end: today };
  }
  if (period === 'year') return { start: `${y}-01-01`, end: today };
  // 6mo — from the 1st of the month five months back through today
  const d = new Date(y, m - 5, 1);
  return { start: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`, end: today };
}

function inRange(row, range) {
  return row.date && row.date >= range.start && row.date <= range.end;
}

// P&L tiles + category breakdown follow the same period selector.
function renderPeriodSections() {
  const range    = periodRange(document.getElementById('pl-period').value);
  const payments = loadedRecords('payments').filter(r => inRange(r, range));
  const expenses = loadedRecords('expenses').filter(r => inRange(r, range));

  const income = sum(payments, 'amount');
  const spent  = sum(expenses, 'total');
  setAmount('pl-income',   income);
  setAmount('pl-expenses', spent);
  setAmount('pl-net',      income - spent, /* signColor */ true);

  renderCategories(expenses);
}

function setAmount(id, value, signColor = false) {
  const el = document.getElementById(id);
  el.textContent = money(value);
  if (signColor) el.classList.toggle('aging-tile__amount--negative', value < 0);
}

// ---- Six-month trend chart (inline SVG, grouped bars) --------------

function renderTrend() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key:   monthKey(d),
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      income: 0, expenses: 0,
    });
  }
  const byKey = Object.fromEntries(months.map(mo => [mo.key, mo]));
  for (const p of loadedRecords('payments')) {
    const mo = byKey[(p.date || '').slice(0, 7)];
    if (mo) mo.income += Number(p.amount) || 0;
  }
  for (const e of loadedRecords('expenses')) {
    const mo = byKey[(e.date || '').slice(0, 7)];
    if (mo) mo.expenses += Number(e.total) || 0;
  }

  const W = 720, H = 220, padL = 8, padR = 8, padB = 24, padT = 10;
  const plotH  = H - padT - padB;
  const max    = Math.max(1, ...months.flatMap(mo => [mo.income, mo.expenses]));
  const slotW  = (W - padL - padR) / 6;
  const barW   = Math.min(34, slotW / 2 - 6);

  const bars = months.map((mo, i) => {
    const cx = padL + slotW * i + slotW / 2;
    const bar = (value, color, dx, label) => {
      const h = Math.round((value / max) * plotH);
      const yTop = padT + plotH - h;
      return `
        <rect x="${cx + dx}" y="${yTop}" width="${barW}" height="${Math.max(h, value > 0 ? 2 : 0)}"
              rx="3" fill="${color}">
          <title>${esc(mo.label)} — ${esc(label)}: ${esc(money(value))}</title>
        </rect>`;
    };
    return bar(mo.income, INCOME_COLOR, -barW - 2, t('fin_income')) +
           bar(mo.expenses, EXPENSE_COLOR, 2, t('fin_expenses')) + `
      <text x="${cx}" y="${H - 7}" text-anchor="middle"
            font-family="Plus Jakarta Sans, sans-serif" font-size="11" fill="#717781">${esc(mo.label)}</text>`;
  }).join('');

  document.getElementById('trend-chart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px; display:block;" role="img"
         aria-label="${esc(t('fin_trend_heading'))}">
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"
            stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
      ${bars}
    </svg>`;
}

// ---- Expense-by-category breakdown (horizontal bars) ---------------

function groupByCategory(expenses) {
  const totals = {};
  for (const e of expenses) {
    const cat = e.category_name || 'Uncategorized';
    totals[cat] = (totals[cat] || 0) + (Number(e.total) || 0);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function renderCategories(expenses) {
  const groups = groupByCategory(expenses);
  const list   = document.getElementById('cat-list');
  const empty  = document.getElementById('cat-empty');
  empty.classList.toggle('hidden', groups.length > 0);

  const max = Math.max(1, ...groups.map(([, v]) => v));
  list.innerHTML = groups.map(([cat, total]) => `
    <div class="cat-row" title="${esc(cat)}: ${esc(money(total))}">
      <span class="cat-row__label">${esc(cat)}</span>
      <div class="cat-row__track"><div class="cat-row__bar" style="width:${Math.max(1, (total / max) * 100)}%;"></div></div>
      <span class="cat-row__amount">${esc(money(total))}</span>
    </div>`).join('');
}

// ---- Subscriptions — manual list, full CRUD ------------------------

function renderSubscriptions() {
  const list  = document.getElementById('subs-list');
  const empty = document.getElementById('subs-empty');
  empty.classList.toggle('hidden', _subscriptions.length > 0);

  list.innerHTML = _subscriptions.map(s => `
    <div class="sub-row">
      <span class="text-primary-fixed-dim text-[13px] font-semibold">${esc(s.name)}</span>
      <span class="text-outline-variant text-[13px]">${esc(money(s.amount))}</span>
      <span class="sub-cell--optional text-outline-variant text-[13px]">${esc(t('fin_cycle_' + s.billing_cycle))}</span>
      <span class="sub-cell--optional text-outline-variant text-[13px]">${esc(s.next_due_date || '—')}</span>
      <div class="flex items-center gap-2 justify-end">
        <button data-action="edit" data-id="${s.id}"
                class="text-outline-variant hover:text-primary-fixed-dim text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 transition-colors">
          ${esc(t('inv_edit'))}
        </button>
        <button data-action="delete" data-id="${s.id}"
                class="text-outline-variant hover:text-red-400 text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 transition-colors">
          ${esc(t('delete'))}
        </button>
      </div>
    </div>`).join('');
}

function subError(msg) {
  const el = document.getElementById('sub-error');
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function openSubscriptionModal(sub) {
  _editingSubId = sub?.id ?? null;
  subError(null);
  document.getElementById('sub-modal-title').textContent = sub ? t('inv_edit') : t('fin_subs_add');
  document.getElementById('sub-name').value     = sub?.name ?? '';
  document.getElementById('sub-amount').value   = sub?.amount ?? '';
  document.getElementById('sub-cycle').value    = sub?.billing_cycle ?? 'monthly';
  document.getElementById('sub-next-due').value = sub?.next_due_date ?? '';
  openModal('modal-subscription');
}

async function saveSubscription() {
  subError(null);
  const data = {
    name:          document.getElementById('sub-name').value.trim(),
    amount:        parseFloat(document.getElementById('sub-amount').value),
    billing_cycle: document.getElementById('sub-cycle').value,
    next_due_date: document.getElementById('sub-next-due').value || null,
  };
  if (!data.name)                          { subError('Enter a name.'); return; }
  if (isNaN(data.amount) || data.amount < 0) { subError('Enter a valid amount.'); return; }

  const btn = document.getElementById('sub-save-btn');
  btn.disabled = true;
  try {
    const row = await (_editingSubId
      ? api.updateSubscription(_editingSubId, data)
      : api.createSubscription(data));
    const idx = _subscriptions.findIndex(s => s.id === row.id);
    if (idx >= 0) _subscriptions[idx] = row; else _subscriptions.push(row);
    renderSubscriptions();
    closeModal('modal-subscription');
    toast(_editingSubId ? 'Subscription updated.' : 'Subscription added.', 'success');
  } catch (err) {
    subError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function onSubscriptionAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const sub = _subscriptions.find(s => s.id === +btn.dataset.id);
  if (!sub) return;

  if (btn.dataset.action === 'edit') return openSubscriptionModal(sub);

  if (btn.dataset.action === 'delete') {
    if (!confirm(t('fin_subs_delete_confirm'))) return;
    btn.disabled = true;
    try {
      await api.deleteSubscription(sub.id);
      _subscriptions = _subscriptions.filter(s => s.id !== sub.id);
      renderSubscriptions();
      toast('Subscription deleted.', 'success');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }
}

// ---- Annual Tax-Filing Summary --------------------------------------
// Strictly income + expenses for the chosen year — no tax fields exist.

function buildYearOptions() {
  const y = new Date().getFullYear();
  const select = document.getElementById('annual-year');
  select.innerHTML = '';
  for (let year = y; year >= y - 4; year--) {
    select.insertAdjacentHTML('beforeend', `<option value="${year}">${year}</option>`);
  }
}

async function renderAnnual() {
  const year    = parseInt(document.getElementById('annual-year').value);
  const loading = document.getElementById('annual-loading');
  const body    = document.getElementById('annual-body');

  loading.classList.remove('hidden');
  body.classList.add('hidden');
  try {
    const { payments, expenses } = await loadYear(year);

    const income = sum(payments, 'amount');
    const spent  = sum(expenses, 'total');
    setAmount('annual-income',   income);
    setAmount('annual-expenses', spent);
    setAmount('annual-net',      income - spent, /* signColor */ true);

    const groups = groupByCategory(expenses);
    document.getElementById('annual-cats').innerHTML = groups.length
      ? groups.map(([cat, total]) => `
          <div class="annual-cat-row">
            <span>${esc(cat)}</span>
            <span class="text-primary-fixed-dim font-semibold">${esc(money(total))}</span>
          </div>`).join('')
      : `<div class="text-outline-variant text-[13px] py-4 text-center">${esc(t('fin_cat_empty'))}</div>`;
  } catch (err) {
    toast(err.message, 'error');
  }
  loading.classList.add('hidden');
  body.classList.remove('hidden');
}

// ---- AR Aging (unchanged) -------------------------------------------

// Whole days the invoice is past due as of today; <= 0 means current.
function daysPastDue(dueDate, now = new Date()) {
  if (!dueDate) return 0;
  const due = new Date(dueDate + 'T00:00:00');
  return Math.floor((now - due) / 86400000);
}

function renderAging(invoices) {
  const open = invoices.filter(inv =>
    inv.is_archived !== 1 && OPEN_STATUSES.includes(inv.status) && (inv.balance ?? 0) > 0
  );

  const sums   = {};
  const counts = {};
  BUCKETS.forEach(b => { sums[b.key] = 0; counts[b.key] = 0; });

  let total = 0;
  for (const inv of open) {
    const days = daysPastDue(inv.due_date);
    const bucket = BUCKETS.find(b => days >= b.min && days <= b.max) ?? BUCKETS[0];
    sums[bucket.key]   += inv.balance;
    counts[bucket.key] += 1;
    total += inv.balance;
  }

  document.getElementById('aging-total').textContent = money(total);
  document.getElementById('fin-subtitle').textContent =
    `${open.length} open invoice${open.length !== 1 ? 's' : ''}`;

  document.getElementById('aging-grid').innerHTML = BUCKETS.map(b => `
    <div class="aging-tile ${counts[b.key] ? b.cls : ''}">
      <div class="aging-tile__label">${esc(t(b.labelKey))}</div>
      <div class="aging-tile__amount">${esc(money(sums[b.key]))}</div>
      <div class="aging-tile__count">${counts[b.key]} ${esc(t('fin_invoices_count'))}</div>
    </div>`).join('');
}

// ============================================================
// Panel: Financial Tools — manual expense entry + client
// billing details. Expenses write straight to Zoho (no local
// cache), so they show up in Financial Health's P&L / category
// breakdown immediately. The "recently added" list here is
// session-only, just a receipt of what this page just created.
// ============================================================

let _recentExpenses = [];   // session-only, newest first
let _toolsClients    = null;

async function initTools() {
  document.getElementById('exp-save-btn').addEventListener('click', createExpense);
  document.getElementById('exp-recent-list').addEventListener('click', onExpenseAction);

  document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  loadExpenseCategoryOptions();

  document.getElementById('billing-client').addEventListener('change', onBillingClientChange);
  document.getElementById('billing-save-btn').addEventListener('click', saveBillingDetails);
  await loadBillingClients();

  renderRecentExpenses();
}

// ---- Manual expense entry ----

async function loadExpenseCategoryOptions() {
  try {
    const categories = await api.zohoExpenseCategories();
    document.getElementById('exp-category-list').innerHTML =
      categories.map(c => `<option value="${esc(c.category_name)}"></option>`).join('');
  } catch (err) { /* datalist is a convenience — silently skip on failure */ }
}

function expError(msg) {
  const el = document.getElementById('exp-error');
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function createExpense() {
  expError(null);
  const data = {
    description:  document.getElementById('exp-description').value.trim(),
    amount:       parseFloat(document.getElementById('exp-amount').value),
    date:         document.getElementById('exp-date').value,
    category:     document.getElementById('exp-category').value.trim(),
    paid_through: document.getElementById('exp-paid-through').value.trim(),
  };
  if (!data.description)                      { expError('Enter a description.'); return; }
  if (isNaN(data.amount) || data.amount <= 0)  { expError('Enter a valid amount.'); return; }
  if (!data.date)                              { expError('Pick a date.'); return; }
  if (!data.category)                          { expError('Enter a category.'); return; }
  if (!data.paid_through)                      { expError('Enter a paid-through account.'); return; }

  const btn = document.getElementById('exp-save-btn');
  btn.disabled = true;
  try {
    const expense = await api.zohoCreateExpense(data);
    _recentExpenses.unshift(expense);
    renderRecentExpenses();

    document.getElementById('exp-description').value  = '';
    document.getElementById('exp-amount').value        = '';
    document.getElementById('exp-category').value      = '';
    document.getElementById('exp-paid-through').value  = '';
    toast('Expense added in Zoho.', 'success');
  } catch (err) {
    const messages = {
      zoho_not_connected:                    'Zoho is not connected — use Connect Zoho Invoice on the dashboard first.',
      zoho_organization_missing:             'Zoho connection has no organization — reconnect from the dashboard.',
      zoho_paid_through_account_not_found:   'No Zoho account matches that Paid Through name exactly — check spelling against Zoho.',
      zoho_paid_through_lookup_unavailable:  'Could not look up Paid Through accounts in Zoho right now.',
      zoho_expense_category_create_failed:   'Could not create that expense category in Zoho.',
      zoho_expense_create_failed:            'Zoho did not accept the expense. Please try again.',
      zoho_api_error:                        'Zoho rejected the request. Please try again.',
    };
    expError(messages[err.message] || err.message);
  } finally {
    btn.disabled = false;
  }
}

function renderRecentExpenses() {
  const list  = document.getElementById('exp-recent-list');
  const empty = document.getElementById('exp-recent-empty');
  empty.classList.toggle('hidden', _recentExpenses.length > 0);

  list.innerHTML = _recentExpenses.map(e => `
    <div class="sub-row" data-expense-id="${esc(e.expense_id)}">
      <span class="text-primary-fixed-dim text-[13px] font-semibold">${esc(e.description)}</span>
      <span class="text-outline-variant text-[13px]">${esc(money(e.total))}</span>
      <span class="sub-cell--optional text-outline-variant text-[13px]">${esc(e.category_name || '—')}</span>
      <span class="sub-cell--optional text-outline-variant text-[13px]">${esc(e.date || '—')}</span>
      <div class="flex items-center gap-2 justify-end">
        <button data-action="delete" data-id="${esc(e.expense_id)}"
                class="text-outline-variant hover:text-red-400 text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 transition-colors">
          ${esc(t('delete'))}
        </button>
      </div>
    </div>`).join('');
}

async function onExpenseAction(e) {
  const btn = e.target.closest('button[data-action="delete"]');
  if (!btn) return;
  if (!confirm(t('fin_exp_delete_confirm'))) return;

  btn.disabled = true;
  try {
    await api.zohoDeleteExpense(btn.dataset.id);
    _recentExpenses = _recentExpenses.filter(x => x.expense_id !== btn.dataset.id);
    renderRecentExpenses();
    toast('Expense deleted.', 'success');
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

// ---- Client Billing Details ----

async function loadBillingClients() {
  const select = document.getElementById('billing-client');
  select.innerHTML = `<option value="">${esc(t('loading'))}</option>`;
  try {
    _toolsClients = await api.clients();
    select.innerHTML = `<option value="">—</option>` + _toolsClients.map(c =>
      `<option value="${c.id}">${esc(c.business_name || c.name)}</option>`
    ).join('');
  } catch (err) {
    select.innerHTML = `<option value="">—</option>`;
    toast(err.message, 'error');
  }
}

function billingError(msg) {
  const el = document.getElementById('billing-error');
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function onBillingClientChange() {
  billingError(null);
  const id = document.getElementById('billing-client').value;
  const fields = document.getElementById('billing-fields');
  if (!id) { fields.classList.add('hidden'); return; }

  const client = (_toolsClients || []).find(c => String(c.id) === id);
  document.getElementById('billing-email').value   = client?.email   || '';
  document.getElementById('billing-phone').value   = client?.whatsapp || client?.phone || '';
  document.getElementById('billing-address').value = client?.address || '';
  fields.classList.remove('hidden');
}

async function saveBillingDetails() {
  billingError(null);
  const id = document.getElementById('billing-client').value;
  if (!id) return;

  const data = {
    email:    document.getElementById('billing-email').value.trim() || null,
    whatsapp: document.getElementById('billing-phone').value.trim() || null,
    address:  document.getElementById('billing-address').value.trim() || null,
  };

  const btn = document.getElementById('billing-save-btn');
  btn.disabled = true;
  try {
    const updated = await api.updateClient(id, data);
    const idx = (_toolsClients || []).findIndex(c => c.id === updated.id);
    if (idx >= 0) _toolsClients[idx] = { ..._toolsClients[idx], ...updated };
    toast('Billing details saved.', 'success');
  } catch (err) {
    billingError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// Panel: Bank Reconciliation (formerly reconciliation.js)
// CSV-imported bank transactions matched against cached
// invoices. Tabs: Unmatched / Matched / Excluded. Actions:
// Match, Unmatch, Exclude, Restore. The CSV is parsed in the
// browser and stored via the Worker into D1.
// ============================================================

let _txns      = [];
let _reconInvoices  = null;   // lazy-loaded for the match picker
let _activeReconTab = 'unmatched';
let _matchingTxnId  = null;

async function initReconciliation() {
  document.querySelectorAll('.recon-tab').forEach(btn => {
    btn.addEventListener('click', () => switchReconTab(btn.dataset.reconTab));
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
  document.getElementById('txn-list').addEventListener('click', onTxnRowAction);
  document.getElementById('match-save-btn').addEventListener('click', saveMatch);
  document.getElementById('modal-match').querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.getElementById('modal-match').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-match')) closeModal('modal-match');
  });

  await loadTransactions();
}

async function loadTransactions() {
  document.getElementById('txn-loading').classList.remove('hidden');
  try {
    _txns = await api.bankTransactions();
    renderReconTabs();
    renderTxnList();
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

function switchReconTab(tab) {
  _activeReconTab = tab;
  document.querySelectorAll('.recon-tab').forEach(btn => {
    btn.classList.toggle('books-tab--active', btn.dataset.reconTab === tab);
  });
  renderTxnList();
}

function renderReconTabs() {
  ['unmatched', 'matched', 'excluded'].forEach(tab => {
    document.getElementById(`count-${tab}`).textContent = `(${tabTxns(tab).length})`;
  });
}

function reconMoney(v, currency = 'USD') {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
}

function renderTxnList() {
  const list  = document.getElementById('txn-list');
  const empty = document.getElementById('txn-empty');
  const rows  = tabTxns(_activeReconTab);

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
        <span class="text-outline-variant text-[13px]">${esc(reconMoney(x.amount))}</span>
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

async function onTxnRowAction(e) {
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
    renderReconTabs();
    renderTxnList();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

// ---- Match modal ----

async function openMatchModal(txn) {
  _matchingTxnId = txn.id;
  document.getElementById('match-txn-summary').textContent =
    `${txn.txn_date || ''} · ${txn.description || ''} · ${reconMoney(txn.amount)}`;

  const select = document.getElementById('match-invoice');
  select.innerHTML = `<option>${esc(t('loading'))}</option>`;
  openModal('modal-match');

  if (!_reconInvoices) {
    try { _reconInvoices = await api.zohoAllInvoices(); }
    catch (err) { toast(err.message, 'error'); return; }
  }

  // Exact-amount matches (against balance or total) float to the top
  const amount = Math.abs(txn.amount ?? 0);
  const candidates = _reconInvoices
    .filter(inv => inv.status !== 'void')
    .map(inv => ({
      inv,
      suggested: Math.abs((inv.balance ?? -1) - amount) < 0.005 ||
                 Math.abs((inv.amount  ?? -1) - amount) < 0.005,
    }))
    .sort((a, b) => (b.suggested - a.suggested));

  select.innerHTML = candidates.map(({ inv, suggested }) => {
    const label = `${inv.invoice_number || inv.zoho_invoice_id} · ${inv.client_business_name || inv.client_name || ''} · ${reconMoney(inv.balance ?? inv.amount, inv.currency_code)}` +
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
      const inv = (_reconInvoices || []).find(i => i.id === invoiceId);
      txn.matched_invoice_number        = inv?.invoice_number ?? null;
      txn.matched_client_business_name  = inv?.client_business_name ?? null;
      txn.matched_client_name           = inv?.client_name ?? null;
    }
    renderReconTabs();
    renderTxnList();
    closeModal('modal-match');
    toast('Transaction matched.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

init();
