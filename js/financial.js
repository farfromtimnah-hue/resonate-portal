// ============================================================
// Financial Health — AR Aging from cached unpaid invoices plus
// a Tax Summary section that stays zeroed (no tax is charged on
// any invoice; no tax logic exists anywhere in the portal).
// ============================================================

import { requireAuth, signOut } from './auth.js';
import { api }                   from './api.js';
import { t }                     from './t.js';
import { esc }                   from './utils.js';

// Statuses whose balances count as receivable
const OPEN_STATUSES = ['sent', 'viewed', 'unpaid', 'partially_paid', 'overdue'];

const BUCKETS = [
  { key: 'current', labelKey: 'fin_bucket_current', min: -Infinity, max: 0,        cls: '' },
  { key: '1_30',    labelKey: 'fin_bucket_1_30',    min: 1,         max: 30,       cls: '' },
  { key: '31_60',   labelKey: 'fin_bucket_31_60',   min: 31,        max: 60,       cls: 'aging-tile--warn' },
  { key: '61_90',   labelKey: 'fin_bucket_61_90',   min: 61,        max: 90,       cls: 'aging-tile--warn' },
  { key: '90_plus', labelKey: 'fin_bucket_90_plus', min: 91,        max: Infinity, cls: 'aging-tile--danger' },
];

async function init() {
  const profile = await requireAuth('admin');
  if (!profile) return;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut(); window.location.href = 'index.html';
  });

  try {
    const invoices = await api.zohoAllInvoices();
    render(invoices);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading').textContent = err.message;
  }
}

function money(v, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v ?? 0);
}

// Whole days the invoice is past due as of today; <= 0 means current.
function daysPastDue(dueDate, now = new Date()) {
  if (!dueDate) return 0;
  const due = new Date(dueDate + 'T00:00:00');
  return Math.floor((now - due) / 86400000);
}

function render(invoices) {
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
