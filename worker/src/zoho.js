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

  // POST /api/zoho/sync/:client_id — pull this client's invoices from Zoho into D1
  var params = match('/api/zoho/sync/:client_id', path);
  if (params && method === 'POST') {
    requireAdminRole(user);
    return handleSyncInvoices(params.client_id, env);
  }

  // GET /api/clients/:id/invoices — cached invoice list (admin or the client's own)
  params = match('/api/clients/:id/invoices', path);
  if (params && method === 'GET') {
    if (user.role === 'client' && user.client_id !== parseInt(params.id)) {
      throw new ApiError('Forbidden', 403);
    }
    var { results } = await env.DB.prepare(
      'SELECT * FROM client_invoices WHERE client_id = ? AND is_archived = 0 ORDER BY due_date DESC, invoice_number DESC'
    ).bind(params.id).all();
    return jsonResponse(results, 200, env);
  }

  return null;
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

async function handleSyncInvoices(clientId, env) {
  var access = await getZohoAccess(env);   // throws 409 zoho_not_connected when unusable
  if (!access.organizationId) throw new ApiError('zoho_organization_missing', 409);

  var client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) throw new ApiError('Client not found', 404);

  var customerId = await resolveZohoCustomerId(client, access, env);
  var list = await zohoGet(access, `/invoices?customer_id=${encodeURIComponent(customerId)}`);
  var invoices = list?.invoices ?? [];

  var now = new Date().toISOString();
  for (var z of invoices.slice(0, 100)) {
    // The list payload usually carries invoice_url; fall back to the
    // detail endpoint when it does not.
    if (!z.invoice_url) {
      try {
        var detail = await zohoGet(access, `/invoices/${z.invoice_id}`);
        if (detail?.invoice) z = { ...z, invoice_url: detail.invoice.invoice_url };
      } catch (e) { /* keep row without payment_url; button stays hidden */ }
    }
    var row = mapZohoInvoice(z);
    await env.DB.prepare(
      `INSERT INTO client_invoices
         (client_id, zoho_invoice_id, invoice_number, status, amount, balance,
          currency_code, due_date, payment_url, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(zoho_invoice_id) DO UPDATE SET
         invoice_number = excluded.invoice_number,
         status         = excluded.status,
         amount         = excluded.amount,
         balance        = excluded.balance,
         currency_code  = excluded.currency_code,
         due_date       = excluded.due_date,
         payment_url    = COALESCE(excluded.payment_url, client_invoices.payment_url),
         last_synced_at = excluded.last_synced_at`
    ).bind(
      client.id, row.zoho_invoice_id, row.invoice_number, row.status, row.amount,
      row.balance, row.currency_code, row.due_date, row.payment_url, now
    ).run();
  }

  var { results } = await env.DB.prepare(
    'SELECT * FROM client_invoices WHERE client_id = ? AND is_archived = 0 ORDER BY due_date DESC, invoice_number DESC'
  ).bind(client.id).all();
  return jsonResponse({ synced: invoices.length, invoices: results }, 200, env);
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
