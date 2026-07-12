// ============================================================
// Zoho Invoice integration — OAuth connect flow + token cache
// One-click connect: admin is sent to Zoho's hosted consent
// screen; the callback exchanges the code server-side and
// stores the refresh token in D1. Nicole never handles tokens.
//
// Zoho specifics (confirmed against live docs + Apex account):
//   - Auth header is  Zoho-oauthtoken {token}  (NOT Bearer)
//   - Every Invoice API call needs the organization id
//   - Access tokens live ~3600s; Zoho hard-limits 10 token
//     requests per 10 min per refresh token, so the access
//     token is cached in D1 and refreshed only on expiry.
// ============================================================

import { ApiError, jsonResponse, match } from './index.js';

var ZOHO_SCOPE           = 'ZohoInvoice.fullaccess.all';
var DEFAULT_ACCOUNTS     = 'https://accounts.zoho.com';
var DEFAULT_API_DOMAIN   = 'https://www.zohoapis.com';
var TOKEN_EXPIRY_MARGIN  = 120 * 1000;   // refresh 2 min before real expiry

function requireAdminRole(user) {
  if (!user || user.role !== 'admin') throw new ApiError('Forbidden', 403);
}

function zohoConfigured(env) {
  return Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET);
}

function callbackUrl(requestUrl) {
  return `${requestUrl.origin}/api/zoho/oauth/callback`;
}

async function getConnectionRow(env) {
  await env.DB.prepare('INSERT OR IGNORE INTO zoho_connection (id) VALUES (1)').run();
  return env.DB.prepare('SELECT * FROM zoho_connection WHERE id = 1').first();
}

// ------------------------------------------------------------
// Authenticated routes (called from the main router)
// ------------------------------------------------------------
export async function routeZoho(request, env, user, url, method, path) {
  // GET /api/zoho/status — connection state for the admin UI
  if (method === 'GET' && path === '/api/zoho/status') {
    requireAdminRole(user);
    if (!zohoConfigured(env)) {
      return jsonResponse({ configured: false, connected: false }, 200, env);
    }
    var row = await getConnectionRow(env);
    return jsonResponse({
      configured: true,
      connected: Boolean(row && row.refresh_token),
      organization_id: row?.organization_id ?? null,
      connected_at: row?.connected_at ?? null,
    }, 200, env);
  }

  // GET /api/zoho/oauth/start — returns the Zoho consent-screen URL.
  // The admin JS navigates the browser there (fetch cannot follow a
  // cross-origin 302 into a page navigation, so JSON is returned).
  if (method === 'GET' && path === '/api/zoho/oauth/start') {
    requireAdminRole(user);
    if (!zohoConfigured(env)) {
      return jsonResponse({
        error: 'zoho_not_configured',
        message: 'ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET secrets are not set on the Worker yet.'
      }, 409, env);
    }
    var state = crypto.randomUUID();
    await getConnectionRow(env);
    await env.DB.prepare(
      "UPDATE zoho_connection SET oauth_state = ?, updated_at = datetime('now') WHERE id = 1"
    ).bind(state).run();

    var authorize = new URL(`${DEFAULT_ACCOUNTS}/oauth/v2/auth`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', env.ZOHO_CLIENT_ID);
    authorize.searchParams.set('scope', ZOHO_SCOPE);
    authorize.searchParams.set('redirect_uri', callbackUrl(url));
    authorize.searchParams.set('access_type', 'offline');
    authorize.searchParams.set('prompt', 'consent');
    authorize.searchParams.set('state', state);
    return jsonResponse({ url: authorize.toString() }, 200, env);
  }

  // POST /api/zoho/disconnect — forget the stored tokens
  if (method === 'POST' && path === '/api/zoho/disconnect') {
    requireAdminRole(user);
    await env.DB.prepare(
      "UPDATE zoho_connection SET refresh_token = NULL, access_token = NULL, access_token_expires_at = NULL, organization_id = NULL, connected_at = NULL, updated_at = datetime('now') WHERE id = 1"
    ).run();
    return jsonResponse({ success: true }, 200, env);
  }

  // GET /api/zoho/invoices — every cached invoice with its client, for the admin books view
  if (method === 'GET' && path === '/api/zoho/invoices') {
    requireAdminRole(user);
    var { results } = await env.DB.prepare(
      `SELECT i.*, c.name AS client_name, c.business_name AS client_business_name,
              c.email AS client_email, c.whatsapp AS client_whatsapp,
              c.language_preference AS client_language
       FROM client_invoices i
       JOIN clients c ON c.id = i.client_id
       ORDER BY i.due_date DESC, i.invoice_number DESC`
    ).all();
    return jsonResponse(results, 200, env);
  }

  // POST /api/zoho/invoices — create a DRAFT invoice in Zoho and cache it
  if (method === 'POST' && path === '/api/zoho/invoices') {
    requireAdminRole(user);
    return handleCreateInvoice(request, env);
  }

  // GET/PUT /api/zoho/invoices/:id/items — read / update a DRAFT invoice's
  // line items against the real Zoho invoice, then re-cache locally.
  params = match('/api/zoho/invoices/:id/items', path);
  if (params && (method === 'GET' || method === 'PUT')) {
    requireAdminRole(user);
    return method === 'GET'
      ? handleGetInvoiceItems(params.id, env)
      : handleUpdateInvoiceItems(params.id, request, env);
  }

  // POST /api/zoho/invoices/:id/finalize — draft → unpaid via Zoho mark-as-sent.
  // Strictly separate from any send action: no email, no WhatsApp, no navigation.
  params = match('/api/zoho/invoices/:id/finalize', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleFinalizeInvoice(params.id, env);
  }

  // POST /api/zoho/invoices/:id/archive|restore — local D1 flag only,
  // never a Zoho status change.
  params = match('/api/zoho/invoices/:id/archive', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSetInvoiceArchived(params.id, 1, env);
  }
  params = match('/api/zoho/invoices/:id/restore', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSetInvoiceArchived(params.id, 0, env);
  }

  // POST /api/zoho/sync — best-effort sync for every client that can be matched to Zoho
  if (method === 'POST' && path === '/api/zoho/sync') {
    requireAdminRole(user);
    return handleSyncAll(env);
  }

  // POST /api/zoho/sync/:client_id — pull this client's invoices from Zoho into D1
  var params = match('/api/zoho/sync/:client_id', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSyncInvoices(params.client_id, env);
  }

  // GET /api/clients/:id/invoices — cached invoice list (admin or the client's own).
  // Archived rows are included; front-ends split them into their Archive tab.
  params = match('/api/clients/:id/invoices', path);
  if (params && method === 'GET') {
    if (user.role === 'client' && user.client_id !== parseInt(params.id)) {
      throw new ApiError('Forbidden', 403);
    }
    var { results } = await env.DB.prepare(
      'SELECT * FROM client_invoices WHERE client_id = ? ORDER BY due_date DESC, invoice_number DESC'
    ).bind(params.id).all();
    return jsonResponse(results, 200, env);
  }

  // ---- Financial Health (live Zoho reads) — admin only ----
  // Always fetched straight from Zoho, never a local cache table, so
  // expenses/payments recorded in Zoho are never missed.

  // GET /api/zoho/expenses?date_start&date_end — live expense list
  if (method === 'GET' && path === '/api/zoho/expenses') {
    requireAdminRole(user);
    return handleListExpenses(url, env);
  }

  // GET /api/zoho/expensecategories — live expense-category list
  if (method === 'GET' && path === '/api/zoho/expensecategories') {
    requireAdminRole(user);
    return handleListExpenseCategories(env);
  }

  // GET /api/zoho/payments?date_start&date_end — live customer payments (income)
  if (method === 'GET' && path === '/api/zoho/payments') {
    requireAdminRole(user);
    return handleListPayments(url, env);
  }

  // ---- Subscriptions (Financial Health) — manual list, admin only ----

  if (method === 'GET' && path === '/api/subscriptions') {
    requireAdminRole(user);
    var { results } = await env.DB.prepare(
      'SELECT * FROM subscriptions ORDER BY next_due_date IS NULL, next_due_date, name'
    ).all();
    return jsonResponse(results, 200, env);
  }
  if (method === 'POST' && path === '/api/subscriptions') {
    requireAdminRole(user);
    return handleCreateSubscription(request, env);
  }
  params = match('/api/subscriptions/:id', path);
  if (params && method === 'PUT') {
    requireAdminRole(user);
    return handleUpdateSubscription(params.id, request, env);
  }
  if (params && method === 'DELETE') {
    requireAdminRole(user);
    return handleDeleteSubscription(params.id, env);
  }

  // ---- Bank reconciliation (Books Phase 9) — admin only ----

  // GET /api/bank/transactions — all imported rows with matched-invoice info
  if (method === 'GET' && path === '/api/bank/transactions') {
    requireAdminRole(user);
    var { results } = await env.DB.prepare(
      `SELECT b.*, i.invoice_number AS matched_invoice_number,
              i.zoho_invoice_id AS matched_zoho_invoice_id,
              c.business_name AS matched_client_business_name, c.name AS matched_client_name
       FROM bank_transactions b
       LEFT JOIN client_invoices i ON i.id = b.matched_invoice_id
       LEFT JOIN clients c ON c.id = i.client_id
       ORDER BY b.txn_date DESC, b.id DESC`
    ).all();
    return jsonResponse(results, 200, env);
  }

  // POST /api/bank/transactions — bulk import parsed CSV rows
  if (method === 'POST' && path === '/api/bank/transactions') {
    requireAdminRole(user);
    return handleImportBankTransactions(request, env);
  }

  // POST /api/bank/transactions/:id/{match|unmatch|exclude|restore}
  params = match('/api/bank/transactions/:id/match', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleMatchBankTransaction(params.id, request, env);
  }
  params = match('/api/bank/transactions/:id/unmatch', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSetBankTransactionStatus(params.id, 'unmatched', env, /* clearMatch */ true);
  }
  params = match('/api/bank/transactions/:id/exclude', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSetBankTransactionStatus(params.id, 'excluded', env);
  }
  params = match('/api/bank/transactions/:id/restore', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSetBankTransactionStatus(params.id, 'unmatched', env);
  }

  return null;
}

// ------------------------------------------------------------
// Financial Health handlers — live Zoho reads (no cache table)
// ------------------------------------------------------------

// Walks Zoho's pagination and returns every record of a list resource.
// listKey names the array in Zoho's response (e.g. 'expenses').
async function zohoGetAll(access, basePathAndQuery, listKey) {
  var sep = basePathAndQuery.includes('?') ? '&' : '?';
  var all = [];
  for (var page = 1; page <= 20; page++) {   // hard cap: 4000 records
    var data = await zohoGet(access, `${basePathAndQuery}${sep}page=${page}&per_page=200`);
    all.push(...(data?.[listKey] ?? []));
    if (!data?.page_context?.has_more_page) break;
  }
  return all;
}

// Builds the optional Zoho date filter from ?date_start=&date_end= query params.
function zohoDateFilter(url) {
  var q = [];
  var start = url.searchParams.get('date_start');
  var end   = url.searchParams.get('date_end');
  if (start) q.push(`date_start=${encodeURIComponent(start)}`);
  if (end)   q.push(`date_end=${encodeURIComponent(end)}`);
  return q.length ? `?${q.join('&')}` : '';
}

async function requireZohoAccess(env) {
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);
  return access;
}

async function handleListExpenses(url, env) {
  var access = await requireZohoAccess(env);
  var expenses = await zohoGetAll(access, `/expenses${zohoDateFilter(url)}`, 'expenses');
  return jsonResponse(expenses.map(e => ({
    expense_id:    String(e.expense_id),
    date:          e.date ?? null,
    category_name: e.category_name || e.account_name || null,
    category_id:   e.category_id != null ? String(e.category_id) : null,
    description:   e.description ?? '',
    total:         e.total ?? 0,
    currency_code: e.currency_code ?? null,
    status:        e.status ?? null,
  })), 200, env);
}

async function handleListExpenseCategories(env) {
  var access = await requireZohoAccess(env);
  var data = await zohoGet(access, '/expensecategories');
  var categories = data?.expense_categories ?? data?.categories ?? [];
  return jsonResponse(categories.map(c => ({
    category_id:   c.category_id != null ? String(c.category_id) : null,
    category_name: c.category_name ?? c.account_name ?? '',
  })), 200, env);
}

async function handleListPayments(url, env) {
  var access = await requireZohoAccess(env);
  var payments = await zohoGetAll(access, `/customerpayments${zohoDateFilter(url)}`, 'customerpayments');
  return jsonResponse(payments.map(p => ({
    payment_id:      String(p.payment_id),
    date:            p.date ?? null,
    amount:          p.amount ?? 0,
    customer_name:   p.customer_name ?? '',
    invoice_numbers: p.invoice_numbers ?? null,
    payment_mode:    p.payment_mode ?? null,
  })), 200, env);
}

// ------------------------------------------------------------
// Subscriptions handlers — plain D1 CRUD, no Zoho involvement
// ------------------------------------------------------------

var BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'];

function readSubscriptionFields(body) {
  var name = (body?.name ?? '').trim();
  if (!name) throw new ApiError('name required', 400);
  var amount = Number(body?.amount);
  if (isNaN(amount) || amount < 0) throw new ApiError('amount must be a non-negative number', 400);
  var cycle = body?.billing_cycle ?? 'monthly';
  if (!BILLING_CYCLES.includes(cycle)) throw new ApiError('invalid billing_cycle', 400);
  return { name, amount, cycle, nextDue: body?.next_due_date || null };
}

async function handleCreateSubscription(request, env) {
  var f = readSubscriptionFields(await request.json());
  var { meta } = await env.DB.prepare(
    'INSERT INTO subscriptions (name, amount, billing_cycle, next_due_date) VALUES (?, ?, ?, ?)'
  ).bind(f.name, f.amount, f.cycle, f.nextDue).run();
  var row = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?')
    .bind(meta.last_row_id).first();
  return jsonResponse(row, 201, env);
}

async function handleUpdateSubscription(id, request, env) {
  var existing = await env.DB.prepare('SELECT id FROM subscriptions WHERE id = ?').bind(id).first();
  if (!existing) throw new ApiError('Subscription not found', 404);
  var f = readSubscriptionFields(await request.json());
  await env.DB.prepare(
    "UPDATE subscriptions SET name = ?, amount = ?, billing_cycle = ?, next_due_date = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(f.name, f.amount, f.cycle, f.nextDue, existing.id).run();
  var row = await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(existing.id).first();
  return jsonResponse(row, 200, env);
}

async function handleDeleteSubscription(id, env) {
  var existing = await env.DB.prepare('SELECT id FROM subscriptions WHERE id = ?').bind(id).first();
  if (!existing) throw new ApiError('Subscription not found', 404);
  await env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(existing.id).run();
  return jsonResponse({ success: true }, 200, env);
}

// ------------------------------------------------------------
// Bank reconciliation handlers
// ------------------------------------------------------------

async function handleImportBankTransactions(request, env) {
  var body = await request.json();
  var rows = body?.transactions;
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError('transactions required', 400);
  if (rows.length > 1000) throw new ApiError('too many rows (max 1000 per upload)', 400);

  var inserted = 0;
  for (var r of rows) {
    if (r.amount == null || isNaN(Number(r.amount))) continue;
    await env.DB.prepare(
      'INSERT INTO bank_transactions (txn_date, description, amount, source) VALUES (?, ?, ?, ?)'
    ).bind(r.date ?? null, r.description ?? null, Number(r.amount), 'csv').run();
    inserted++;
  }
  return jsonResponse({ inserted }, 201, env);
}

async function loadBankTransaction(id, env) {
  var row = await env.DB.prepare('SELECT * FROM bank_transactions WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError('Transaction not found', 404);
  return row;
}

async function handleMatchBankTransaction(id, request, env) {
  var txn = await loadBankTransaction(id, env);
  var body = await request.json();
  var invoiceId = body?.invoice_id;
  if (!invoiceId) throw new ApiError('invoice_id required', 400);

  var invoice = await env.DB.prepare('SELECT id FROM client_invoices WHERE id = ?').bind(invoiceId).first();
  if (!invoice) throw new ApiError('Invoice not found', 404);

  await env.DB.prepare(
    "UPDATE bank_transactions SET status = 'matched', matched_invoice_id = ? WHERE id = ?"
  ).bind(invoice.id, txn.id).run();
  var fresh = await env.DB.prepare('SELECT * FROM bank_transactions WHERE id = ?').bind(txn.id).first();
  return jsonResponse(fresh, 200, env);
}

async function handleSetBankTransactionStatus(id, status, env, clearMatch = false) {
  var txn = await loadBankTransaction(id, env);
  await env.DB.prepare(
    clearMatch
      ? 'UPDATE bank_transactions SET status = ?, matched_invoice_id = NULL WHERE id = ?'
      : 'UPDATE bank_transactions SET status = ? WHERE id = ?'
  ).bind(status, txn.id).run();
  var fresh = await env.DB.prepare('SELECT * FROM bank_transactions WHERE id = ?').bind(txn.id).first();
  return jsonResponse(fresh, 200, env);
}

// ------------------------------------------------------------
// Invoice sync (Phase 3)
// ------------------------------------------------------------

// Maps a Zoho Invoice API v3 invoice object to a client_invoices row.
export function mapZohoInvoice(z) {
  return {
    zoho_invoice_id: String(z.invoice_id),
    invoice_number:  z.invoice_number ?? null,
    status:          z.status ?? null,
    amount:          z.total ?? null,
    balance:         z.balance ?? null,
    currency_code:   z.currency_code ?? null,
    due_date:        z.due_date ?? null,
    payment_url:     z.invoice_url || null,
    sub_total:       z.sub_total ?? null,
    line_items:      Array.isArray(z.line_items) ? JSON.stringify(z.line_items.map(mapZohoLineItem)) : null,
  };
}

// Only the fields the portal needs — the raw Zoho line item carries dozens.
export function mapZohoLineItem(li) {
  return {
    line_item_id: li.line_item_id != null ? String(li.line_item_id) : null,
    name:         li.name ?? '',
    description:  li.description ?? '',
    quantity:     li.quantity ?? 1,
    rate:         li.rate ?? 0,
    amount:       li.item_total ?? li.amount ?? ((li.quantity ?? 1) * (li.rate ?? 0)),
  };
}

async function zohoGet(access, pathAndQuery) {
  var sep = pathAndQuery.includes('?') ? '&' : '?';
  var res = await fetch(
    `${access.apiDomain}/invoice/v3${pathAndQuery}${sep}organization_id=${encodeURIComponent(access.organizationId ?? '')}`,
    {
      headers: {
        'Authorization': `Zoho-oauthtoken ${access.accessToken}`,
        'X-com-zoho-invoice-organizationid': access.organizationId ?? '',
      },
    }
  );
  var data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Zoho API error:', pathAndQuery, res.status, JSON.stringify(data).slice(0, 500));
    throw new ApiError('zoho_api_error', 502);
  }
  return data;
}

// Mirrors zohoGet for write calls — same Zoho-oauthtoken header,
// organization_id handling, and cached-token access object.
async function zohoPost(access, pathAndQuery, body) {
  var sep = pathAndQuery.includes('?') ? '&' : '?';
  var res = await fetch(
    `${access.apiDomain}/invoice/v3${pathAndQuery}${sep}organization_id=${encodeURIComponent(access.organizationId ?? '')}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${access.accessToken}`,
        'X-com-zoho-invoice-organizationid': access.organizationId ?? '',
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
  var data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Zoho API error:', pathAndQuery, res.status, JSON.stringify(data).slice(0, 500));
    throw new ApiError('zoho_api_error', 502);
  }
  return data;
}

// Mirrors zohoPost for updates.
async function zohoPut(access, pathAndQuery, body) {
  var sep = pathAndQuery.includes('?') ? '&' : '?';
  var res = await fetch(
    `${access.apiDomain}/invoice/v3${pathAndQuery}${sep}organization_id=${encodeURIComponent(access.organizationId ?? '')}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Zoho-oauthtoken ${access.accessToken}`,
        'X-com-zoho-invoice-organizationid': access.organizationId ?? '',
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }
  );
  var data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Zoho API error:', pathAndQuery, res.status, JSON.stringify(data).slice(0, 500));
    throw new ApiError('zoho_api_error', 502);
  }
  return data;
}

// Finds the Zoho customer for a portal client (by stored id, else email
// match against Zoho contacts) and stores it on the client row.
async function resolveZohoCustomerId(client, access, env) {
  if (client.zoho_customer_id) return client.zoho_customer_id;
  if (!client.email) throw new ApiError('client_has_no_email_for_zoho_match', 409);

  var data = await zohoGet(access, `/contacts?email=${encodeURIComponent(client.email)}`);
  var contact = data?.contacts?.[0];
  if (!contact) throw new ApiError('zoho_customer_not_found', 404);

  await env.DB.prepare(
    'UPDATE clients SET zoho_customer_id = ? WHERE id = ?'
  ).bind(String(contact.contact_id), client.id).run();
  return String(contact.contact_id);
}

// Like resolveZohoCustomerId, but creates the Zoho contact from the client
// record when no match exists — used by invoice creation.
async function ensureZohoCustomerId(client, access, env) {
  try {
    return await resolveZohoCustomerId(client, access, env);
  } catch (e) {
    // Only fall through to creation when the customer genuinely doesn't
    // exist (or the client has no email to match by) — API errors re-throw.
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 409)) throw e;
  }

  var payload = {
    contact_name: client.business_name || client.name,
    company_name: client.business_name || undefined,
  };
  if (client.email) {
    payload.contact_persons = [{
      first_name: (client.name || '').split(/\s+/)[0] || client.name,
      last_name:  (client.name || '').split(/\s+/).slice(1).join(' ') || undefined,
      email:      client.email,
      is_primary_contact: true,
    }];
  }
  var data = await zohoPost(access, '/contacts', payload);
  var contact = data?.contact;
  if (!contact?.contact_id) throw new ApiError('zoho_contact_create_failed', 502);

  await env.DB.prepare(
    'UPDATE clients SET zoho_customer_id = ? WHERE id = ?'
  ).bind(String(contact.contact_id), client.id).run();
  return String(contact.contact_id);
}

// ------------------------------------------------------------
// Create invoice (Books Phase 3) — always a DRAFT in Zoho.
// Finalizing (mark-as-sent) is a separate, explicit action.
// No tax fields anywhere: this business charges no sales tax.
// ------------------------------------------------------------
async function handleCreateInvoice(request, env) {
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var body = await request.json();
  var { client_id, line_items, due_date, notes } = body;
  if (!client_id) throw new ApiError('client_id required', 400);
  if (!Array.isArray(line_items) || line_items.length === 0) {
    throw new ApiError('line_items required', 400);
  }

  var client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(client_id).first();
  if (!client) throw new ApiError('Client not found', 404);

  var customerId = await ensureZohoCustomerId(client, access, env);

  var payload = {
    customer_id: customerId,
    line_items: line_items.map(li => ({
      name:        li.name || li.description || 'Service',
      description: li.description ?? '',
      quantity:    Number(li.quantity) || 1,
      rate:        Number(li.rate) || 0,
    })),
  };
  if (due_date) payload.due_date = due_date;
  if (notes)    payload.notes    = notes;

  var data = await zohoPost(access, '/invoices', payload);
  var invoice = data?.invoice;
  if (!invoice?.invoice_id) throw new ApiError('zoho_invoice_create_failed', 502);

  await upsertCachedInvoice(client.id, invoice, env);

  var row = await env.DB.prepare(
    'SELECT * FROM client_invoices WHERE zoho_invoice_id = ?'
  ).bind(String(invoice.invoice_id)).first();
  return jsonResponse(row, 201, env);
}

// ------------------------------------------------------------
// Draft line-item editing (Books Phase 4) — reads and writes go
// to the real Zoho invoice; the local row is only a cache.
// ------------------------------------------------------------

async function loadCachedInvoiceRow(id, env) {
  var row = await env.DB.prepare('SELECT * FROM client_invoices WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError('Invoice not found', 404);
  return row;
}

async function handleGetInvoiceItems(id, env) {
  var row    = await loadCachedInvoiceRow(id, env);
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var detail  = await zohoGet(access, `/invoices/${row.zoho_invoice_id}`);
  var invoice = detail?.invoice;
  if (!invoice) throw new ApiError('zoho_invoice_not_found', 404);

  // Freshen the cache while we have the real record
  await upsertCachedInvoice(row.client_id, invoice, env);

  return jsonResponse({
    id:             row.id,
    invoice_number: invoice.invoice_number ?? row.invoice_number,
    status:         invoice.status ?? row.status,
    due_date:       invoice.due_date ?? row.due_date,
    notes:          invoice.notes ?? null,
    sub_total:      invoice.sub_total ?? null,
    total:          invoice.total ?? null,
    line_items:     (invoice.line_items ?? []).map(mapZohoLineItem),
  }, 200, env);
}

async function handleUpdateInvoiceItems(id, request, env) {
  var row    = await loadCachedInvoiceRow(id, env);
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var body = await request.json();
  var lineItems = body?.line_items;
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new ApiError('line_items required', 400);
  }

  // Only drafts are editable — check against the REAL Zoho status,
  // not the possibly-stale cache.
  var detail  = await zohoGet(access, `/invoices/${row.zoho_invoice_id}`);
  var invoice = detail?.invoice;
  if (!invoice) throw new ApiError('zoho_invoice_not_found', 404);
  if (invoice.status !== 'draft') throw new ApiError('invoice_not_draft', 409);

  var payload = {
    customer_id: invoice.customer_id,
    line_items: lineItems.map(li => ({
      // Keeping line_item_id updates the existing Zoho line; omitting it adds a new one
      ...(li.line_item_id ? { line_item_id: li.line_item_id } : {}),
      name:        li.name || li.description || 'Service',
      description: li.description ?? '',
      quantity:    Number(li.quantity) || 1,
      rate:        Number(li.rate) || 0,
    })),
  };
  var updated = await zohoPut(access, `/invoices/${row.zoho_invoice_id}`, payload);
  var updatedInvoice = updated?.invoice;
  if (!updatedInvoice?.invoice_id) throw new ApiError('zoho_invoice_update_failed', 502);

  await upsertCachedInvoice(row.client_id, updatedInvoice, env);

  var fresh = await env.DB.prepare('SELECT * FROM client_invoices WHERE id = ?').bind(row.id).first();
  return jsonResponse(fresh, 200, env);
}

// ------------------------------------------------------------
// Lifecycle (Books Phase 5) — finalize is Zoho's mark-as-sent;
// archive/restore is only the local is_archived flag.
// ------------------------------------------------------------

async function handleFinalizeInvoice(id, env) {
  var row    = await loadCachedInvoiceRow(id, env);
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  // Verify against the real Zoho record — only drafts can be finalized
  var detail  = await zohoGet(access, `/invoices/${row.zoho_invoice_id}`);
  var invoice = detail?.invoice;
  if (!invoice) throw new ApiError('zoho_invoice_not_found', 404);
  if (invoice.status !== 'draft') throw new ApiError('invoice_not_draft', 409);

  await zohoPost(access, `/invoices/${row.zoho_invoice_id}/status/sent`);

  // Re-read so the cache carries Zoho's post-finalize state (status, urls)
  var after = await zohoGet(access, `/invoices/${row.zoho_invoice_id}`);
  if (after?.invoice) await upsertCachedInvoice(row.client_id, after.invoice, env);

  var fresh = await env.DB.prepare('SELECT * FROM client_invoices WHERE id = ?').bind(row.id).first();
  return jsonResponse(fresh, 200, env);
}

async function handleSetInvoiceArchived(id, flag, env) {
  var row = await loadCachedInvoiceRow(id, env);
  await env.DB.prepare(
    'UPDATE client_invoices SET is_archived = ? WHERE id = ?'
  ).bind(flag, row.id).run();
  var fresh = await env.DB.prepare('SELECT * FROM client_invoices WHERE id = ?').bind(row.id).first();
  return jsonResponse(fresh, 200, env);
}

// Pulls one client's invoices from Zoho and upserts them into client_invoices.
// Returns the number of invoices synced.
async function syncClientInvoices(client, access, env) {
  var customerId = await resolveZohoCustomerId(client, access, env);
  var list = await zohoGet(access, `/invoices?customer_id=${encodeURIComponent(customerId)}`);
  var invoices = list?.invoices ?? [];

  var now = new Date().toISOString();
  for (var z of invoices.slice(0, 100)) {
    // The list payload has no line_items (and sometimes no invoice_url) —
    // pull the detail record for the full picture. Non-fatal on failure:
    // the row is still cached from the list fields.
    try {
      var detail = await zohoGet(access, `/invoices/${z.invoice_id}`);
      if (detail?.invoice) z = { ...detail.invoice, invoice_url: detail.invoice.invoice_url || z.invoice_url };
    } catch (e) { /* keep list-level row; line_items stays null */ }
    await upsertCachedInvoice(client.id, z, env, now);
  }
  return invoices.length;
}

// Shared writer — used by the sync loop and by invoice create/edit re-caching.
export async function upsertCachedInvoice(clientId, zohoInvoice, env, now = new Date().toISOString()) {
  var row = mapZohoInvoice(zohoInvoice);
  await env.DB.prepare(
    `INSERT INTO client_invoices
       (client_id, zoho_invoice_id, invoice_number, status, amount, balance,
        currency_code, due_date, payment_url, sub_total, line_items, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(zoho_invoice_id) DO UPDATE SET
       invoice_number = excluded.invoice_number,
       status         = excluded.status,
       amount         = excluded.amount,
       balance        = excluded.balance,
       currency_code  = excluded.currency_code,
       due_date       = excluded.due_date,
       payment_url    = COALESCE(excluded.payment_url, client_invoices.payment_url),
       sub_total      = COALESCE(excluded.sub_total, client_invoices.sub_total),
       line_items     = COALESCE(excluded.line_items, client_invoices.line_items),
       last_synced_at = excluded.last_synced_at`
  ).bind(
    clientId, row.zoho_invoice_id, row.invoice_number, row.status, row.amount,
    row.balance, row.currency_code, row.due_date, row.payment_url,
    row.sub_total, row.line_items, now
  ).run();
  return row;
}

async function handleSyncInvoices(clientId, env) {
  var access = await getZohoAccess(env);   // throws 409 zoho_not_connected when unusable
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) throw new ApiError('Client not found', 404);

  var synced = await syncClientInvoices(client, access, env);

  var { results } = await env.DB.prepare(
    'SELECT * FROM client_invoices WHERE client_id = ? AND is_archived = 0 ORDER BY due_date DESC, invoice_number DESC'
  ).bind(client.id).all();
  return jsonResponse({ synced, invoices: results }, 200, env);
}

// Best-effort sync across all active clients. Clients that cannot be matched
// to a Zoho customer (no email / no contact) are skipped, never fatal.
async function handleSyncAll(env) {
  var access = await getZohoAccess(env);
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var { results: clients } = await env.DB.prepare(
    'SELECT * FROM clients WHERE zoho_customer_id IS NOT NULL OR email IS NOT NULL'
  ).all();

  var synced = 0, skipped = [];
  for (var client of clients) {
    try {
      synced += await syncClientInvoices(client, access, env);
    } catch (e) {
      skipped.push({ client_id: client.id, reason: e.message });
    }
  }
  return jsonResponse({ synced, skipped }, 200, env);
}

// ------------------------------------------------------------
// Public invoice read (Books Phase 6) — powers the custom
// invoice template. No auth: keyed by the long Zoho invoice id
// (same public-read pattern as /api/public/projects/:id) and
// returns only the display fields in the template's JSON contract.
// ------------------------------------------------------------
export async function handlePublicInvoice(zohoInvoiceId, env) {
  var row = await env.DB.prepare(
    'SELECT * FROM client_invoices WHERE zoho_invoice_id = ?'
  ).bind(zohoInvoiceId).first();
  if (!row) throw new ApiError('Invoice not found', 404);

  var client = await env.DB.prepare(
    'SELECT name, business_name, email, address, logo_url, language_preference FROM clients WHERE id = ?'
  ).bind(row.client_id).first();

  var lineItems = [];
  try { lineItems = JSON.parse(row.line_items) ?? []; } catch (e) { lineItems = []; }

  // Shape defined in invoice-template.contract.json — keep the two in sync.
  return jsonResponse({
    invoice_number: row.invoice_number,
    status:         row.status,
    currency_code:  row.currency_code,
    amount:         row.amount,
    balance:        row.balance,
    sub_total:      row.sub_total,
    due_date:       row.due_date,
    last_synced_at: row.last_synced_at,
    payment_url:    row.payment_url,
    line_items:     lineItems,
    client: {
      name:                client?.name ?? null,
      business_name:       client?.business_name ?? null,
      email:               client?.email ?? null,
      address:             client?.address ?? null,
      logo_url:            client?.logo_url ?? null,
      language_preference: client?.language_preference ?? 'en',
    },
  }, 200, env);
}

// ------------------------------------------------------------
// OAuth callback — hit by Zoho's browser redirect, so it runs
// BEFORE authenticate() in the fetch handler (no Firebase token).
// CSRF is covered by the state check against D1.
// ------------------------------------------------------------
export async function handleZohoOAuthCallback(url, env) {
  var portalBase = env.PORTAL_URL || 'https://farfromtimnah-hue.github.io/resonate-portal';
  // Built by hand rather than Response.redirect() so headers stay mutable
  // for the CORS wrapper in the fetch handler.
  var back = (result) => new Response(null, {
    status: 302,
    headers: { 'Location': `${portalBase}/dashboard.html?zoho=${result}` },
  });

  try {
    if (url.searchParams.get('error')) {
      return back('denied');
    }
    var code  = url.searchParams.get('code');
    var state = url.searchParams.get('state');
    if (!code || !zohoConfigured(env)) return back('error');

    var row = await getConnectionRow(env);
    if (!row || !row.oauth_state || row.oauth_state !== state) {
      return back('state_mismatch');
    }

    // Zoho tells us which DC to talk to; default to the US endpoints
    var accountsServer = url.searchParams.get('accounts-server') || DEFAULT_ACCOUNTS;

    var tokenRes = await fetch(`${accountsServer}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.ZOHO_CLIENT_ID,
        client_secret: env.ZOHO_CLIENT_SECRET,
        redirect_uri: callbackUrl(url),
      }),
    });
    var tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.refresh_token) {
      console.error('Zoho token exchange failed:', tokenRes.status, JSON.stringify(tokens));
      return back('token_exchange_failed');
    }

    var apiDomain = tokens.api_domain || DEFAULT_API_DOMAIN;

    // Look up the organization id — required on every Invoice API call
    var organizationId = null;
    try {
      var orgRes = await fetch(`${apiDomain}/invoice/v3/organizations`, {
        headers: { 'Authorization': `Zoho-oauthtoken ${tokens.access_token}` },
      });
      var orgData = await orgRes.json().catch(() => ({}));
      organizationId = orgData?.organizations?.[0]?.organization_id ?? null;
    } catch (e) {
      console.error('Zoho organization lookup failed:', e);
    }

    var expiresAt = Date.now() + ((tokens.expires_in ?? 3600) * 1000);
    await env.DB.prepare(
      `UPDATE zoho_connection SET
         oauth_state = NULL,
         refresh_token = ?,
         access_token = ?,
         access_token_expires_at = ?,
         organization_id = ?,
         api_domain = ?,
         accounts_server = ?,
         connected_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = 1`
    ).bind(tokens.refresh_token, tokens.access_token, expiresAt, organizationId, apiDomain, accountsServer).run();

    return back(organizationId ? 'connected' : 'connected_no_org');
  } catch (err) {
    console.error('Zoho OAuth callback error:', err);
    return back('error');
  }
}

// ------------------------------------------------------------
// Access-token cache — shared by every Zoho API call (Phase 3+).
// Returns { accessToken, apiDomain, organizationId }.
// Throws ApiError 409 'zoho_not_connected' when unusable, so
// dependent features fail with a clear state, never a crash.
// ------------------------------------------------------------
export async function getZohoAccess(env) {
  if (!zohoConfigured(env)) throw new ApiError('zoho_not_connected', 409);
  var row = await getConnectionRow(env);
  if (!row || !row.refresh_token) throw new ApiError('zoho_not_connected', 409);

  if (row.access_token && row.access_token_expires_at &&
      Date.now() < row.access_token_expires_at - TOKEN_EXPIRY_MARGIN) {
    return {
      accessToken: row.access_token,
      apiDomain: row.api_domain || DEFAULT_API_DOMAIN,
      organizationId: row.organization_id,
    };
  }

  var accountsServer = row.accounts_server || DEFAULT_ACCOUNTS;
  var res = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
    }),
  });
  var tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.access_token) {
    console.error('Zoho token refresh failed:', res.status, JSON.stringify(tokens));
    throw new ApiError('zoho_token_refresh_failed', 502);
  }

  var expiresAt = Date.now() + ((tokens.expires_in ?? 3600) * 1000);
  await env.DB.prepare(
    "UPDATE zoho_connection SET access_token = ?, access_token_expires_at = ?, updated_at = datetime('now') WHERE id = 1"
  ).bind(tokens.access_token, expiresAt).run();

  return {
    accessToken: tokens.access_token,
    apiDomain: row.api_domain || DEFAULT_API_DOMAIN,
    organizationId: row.organization_id,
  };
}
