// ============================================================
// Financial Health — every money figure is pulled live from the
// connected Zoho account (payments = income, expenses straight
// from GET /expenses, never a local cache table), plus AR Aging
// from cached unpaid invoices and a manual subscriptions list
// stored in D1. No sales tax exists anywhere in the portal.
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t }                     from './t.js';
import { esc, toast, openModal, closeModal } from './utils.js';

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

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  document.getElementById('pl-period').addEventListener('change', renderPeriodSections);
  document.getElementById('annual-year').addEventListener('change', renderAnnual);

  document.getElementById('sub-add-btn').addEventListener('click', () => openSubscriptionModal(null));
  document.getElementById('sub-save-btn').addEventListener('click', saveSubscription);
  document.getElementById('subs-list').addEventListener('click', onSubscriptionAction);
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
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

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    const messages = {
      zoho_not_connected:        'Zoho is not connected yet — use Connect Zoho Invoice on the dashboard first.',
      zoho_organization_missing: 'Zoho connection has no organization — reconnect from the dashboard.',
      zoho_api_error:            'Zoho rejected the request. Please try again.',
    };
    document.getElementById('loading').textContent = messages[err.message] || err.message;
  }
}

function money(v, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v ?? 0);
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

init();
