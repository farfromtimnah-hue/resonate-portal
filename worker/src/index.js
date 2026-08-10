// ============================================================
// Resonate Business Systems — Client Portal API
// Cloudflare Worker — handles all data operations
// Verifies Firebase ID tokens, enforces role-based access,
// reads/writes from Cloudflare D1.
// ============================================================

import { routeInterview } from './interview.js';
import { routeZoho, handleZohoOAuthCallback, handlePublicInvoice } from './zoho.js';

export default {
  async fetch(request, env, ctx) {
    let response = await this.handle(request, env, ctx);
    // CORS_ORIGIN may be a comma-separated allowlist (GitHub Pages + custom domain).
    // Echo back the request's Origin when it is on the list; fall back to the first entry.
    if (response.headers.get('Access-Control-Allow-Origin') !== null) {
      response = new Response(response.body, response);   // some responses have immutable headers
      response.headers.set('Access-Control-Allow-Origin', resolveCorsOrigin(request, env));
      response.headers.append('Vary', 'Origin');
    }
    return response;
  },

  async handle(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(env);
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // Public health check
      if (method === 'GET' && path === '/api/health') {
        return jsonResponse({ status: 'ok' }, 200, env);
      }

      // POST /api/login — verify Firebase token, return user role (convenience endpoint)
      if (method === 'POST' && path === '/api/login') {
        const user = await authenticate(request, env);
        return jsonResponse(user, 200, env);
      }

      // GET /api/public/projects/:id — no auth required (public read-only project view)
      const publicParams = match('/api/public/projects/:id', path);
      if (publicParams && method === 'GET') {
        return handlePublicProject(publicParams.id, env);
      }

      // GET /api/public/invoices/:zoho_invoice_id — no auth required; keyed by the
      // long Zoho invoice id so View Invoice links work from WhatsApp/email
      const publicInvoiceParams = match('/api/public/invoices/:zid', path);
      if (publicInvoiceParams && method === 'GET') {
        return handlePublicInvoice(publicInvoiceParams.zid, env);
      }

      // GET /api/zoho/oauth/callback — hit by Zoho's browser redirect (no Firebase token)
      if (method === 'GET' && path === '/api/zoho/oauth/callback') {
        return handleZohoOAuthCallback(url, env);
      }

      // All other routes require a valid Firebase token
      const user = await authenticate(request, env);

      // ---- PREVIEW WRITE GATE ----
      // Sits here, after authentication and BEFORE route dispatch, so it
      // protects every route at once — including routes added later, which
      // are covered without anyone remembering to protect them.
      //
      // Enforced at the API layer and NOT by hiding buttons in the interface,
      // because a hidden button is not a security control. This gate must
      // still refuse if the portal's banner logic were absent, wrong, or
      // bypassed entirely.
      if (method !== 'GET') {
        const previewing = previewClientId(user, request);
        if (previewing !== null && !(await previewWriteAllowed(env, request, previewing))) {
          // Two distinguishable refusals, so the reader knows which wall they hit.
          const isTestClient = await isTestClientRow(env, previewing);
          const error = isTestClient
            ? 'Preview is read-only. Writing can be enabled from the banner. / '
              + 'A pre-visualizacao e somente leitura. A escrita pode ser ativada no banner.'
            : 'Preview is read-only for this client. Writing is only possible on a client marked as a test client. / '
              + 'A pre-visualizacao e somente leitura para este cliente. A escrita so e possivel em um cliente marcado como cliente de teste.';
          return jsonResponse({ error }, 403, env);
        }
      }

      return await router(request, env, user, url, method, path);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonResponse({ error: err.message }, err.status, env);
      }
      console.error('Unhandled error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, env);
    }
  }
};

// ============================================================
// ROUTER
// ============================================================

async function router(request, env, user, url, method, path) {
  let params;

  // GET /api/me — current user info
  if (method === 'GET' && path === '/api/me') {
    return handleGetMe(env, user, request);
  }

  // POST /api/me/password-changed — client clears the must_change_password flag after setting new password
  if (method === 'POST' && path === '/api/me/password-changed') {
    await env.DB.prepare(
      'UPDATE users SET must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = ?'
    ).bind(user.uid).run();
    return jsonResponse({ success: true }, 200, env);
  }

  // ---- USER MANAGEMENT (admin only) ----
  if (method === 'GET' && path === '/api/users') {
    requireAdmin(user);
    return handleListUsers(env);
  }
  if (method === 'POST' && path === '/api/users') {
    requireAdmin(user);
    return handleUpsertUser(request, env);
  }
  params = match('/api/users/:uid', path);
  if (params) {
    if (method === 'DELETE') { requireAdmin(user); return handleDeleteUser(params, env); }
  }

  // ---- ARCHIVE ----
  if (method === 'GET' && path === '/api/archive') {
    requireAdmin(user);
    return handleListArchive(env);
  }

  // ---- CLIENTS ----
  if (method === 'GET' && path === '/api/clients') {
    requireAdmin(user);
    return handleListClients(env, url);
  }
  if (method === 'POST' && path === '/api/clients') {
    requireAdmin(user);
    return handleCreateClient(request, env, user);
  }

  params = match('/api/clients/:id', path);
  if (params) {
    if (method === 'GET')    return handleGetClient(params.id, env, user);
    if (method === 'PUT')  { requireAdmin(user); return handleUpdateClient(params.id, request, env, user); }
  }

  params = match('/api/clients/:id/archive', path);
  if (params && method === 'POST') {
    requireAdmin(user);
    return handleArchiveClient(params.id, env);
  }

  params = match('/api/clients/:id/restore', path);
  if (params && method === 'POST') {
    requireAdmin(user);
    return handleRestoreClient(params.id, env);
  }

  // ---- PROJECTS ----
  params = match('/api/clients/:id/projects', path);
  if (params) {
    if (method === 'GET')  return handleListProjects(params.id, env, user);
    if (method === 'POST') { requireAdmin(user); return handleCreateProject(params.id, request, env); }
  }

  params = match('/api/clients/:id/projects/:pid', path);
  if (params) {
    if (method === 'PUT')    { requireAdmin(user); return handleUpdateProject(params.id, params.pid, request, env, user); }
    if (method === 'DELETE') { requireAdmin(user); return handleDeleteProject(params.id, params.pid, env); }
  }

  // ---- COMMENTS ----
  params = match('/api/clients/:id/comments', path);
  if (params) {
    if (method === 'GET')  return handleListComments(params.id, env, user);
    if (method === 'POST') return handleAddComment(params.id, request, env, user);
  }

  params = match('/api/clients/:id/comments/:cid', path);
  if (params && method === 'DELETE') {
    requireAdmin(user);
    return handleDeleteComment(params.id, params.cid, env);
  }

  // ---- PRIVATE NOTES (admin only) ----
  params = match('/api/clients/:id/notes', path);
  if (params) {
    if (method === 'GET')  { requireAdmin(user); return handleListNotes(params.id, env); }
    if (method === 'POST') { requireAdmin(user); return handleAddNote(params.id, request, env); }
  }

  params = match('/api/clients/:id/notes/:nid', path);
  if (params) {
    if (method === 'PUT')    { requireAdmin(user); return handleUpdateNote(params.id, params.nid, request, env); }
    if (method === 'DELETE') { requireAdmin(user); return handleDeleteNote(params.id, params.nid, env); }
  }

  // ---- RESOURCE LINKS ----
  params = match('/api/clients/:id/links', path);
  if (params) {
    if (method === 'GET')  return handleListLinks(params.id, env, user);
    if (method === 'POST') { requireAdmin(user); return handleAddLink(params.id, request, env); }
  }

  params = match('/api/clients/:id/links/:lid', path);
  if (params) {
    if (method === 'PUT')    { requireAdmin(user); return handleUpdateLink(params.id, params.lid, request, env); }
    if (method === 'DELETE') { requireAdmin(user); return handleDeleteLink(params.id, params.lid, env); }
  }

  // ---- ZOHO INVOICE INTEGRATION ----
  var zohoResponse = await routeZoho(request, env, user, url, method, path);
  if (zohoResponse) return zohoResponse;

  // ---- AI INTAKE INTERVIEW (adaptive interview engine) ----
  var interviewResponse = await routeInterview(request, env, user, url, method, path);
  if (interviewResponse) return interviewResponse;

  // ---- INTAKE RESPONSES ----
  if (method === 'POST' && path === '/api/intake') {
    return handleSaveIntake(request, env, user);
  }

  params = match('/api/intake/:client_id', path);
  if (params && method === 'GET') {
    return handleGetIntake(params.client_id, env, user);
  }

  // ---- LOGO UPLOAD ----
  if (method === 'POST' && path === '/api/upload-logo') {
    requireAdmin(user);
    return handleUploadLogo(request, env);
  }

  // ---- PROJECT FEEDBACK (favorite / suggestion per project) ----
  // GET  /api/clients/:id/feedback?project_id=X  — returns feedback rows for that project
  // PUT  /api/clients/:id/feedback               — upsert a row by (client_id, project_id, comment_type)
  // PUT  /api/clients/:id/feedback/translation   — admin saves admin_translation on a row
  params = match('/api/clients/:id/feedback/translation', path);
  if (params && method === 'PUT') {
    requireAdmin(user);
    return handleUpsertFeedbackTranslation(params.id, request, env);
  }

  params = match('/api/clients/:id/feedback', path);
  if (params) {
    if (method === 'GET') return handleGetFeedback(params.id, url, env, user);
    if (method === 'PUT') return handleUpsertFeedback(params.id, request, env, user);
  }

  return jsonResponse({ error: 'Not found' }, 404, env);
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

async function handleGetMe(env, user, request) {
  // portal.js resolves the client it renders from _profile.client_id, so
  // preview identity is applied here once rather than at each portal call site.
  // effectiveClientId returns the caller's own client_id unless an ADMIN is
  // previewing, so a client session is never redirected by a query parameter.
  const previewing = previewClientId(user, request);
  if (previewing === null) return jsonResponse(user, 200, env);

  const clientId = effectiveClientId(user, request);
  // Tell the banner whether writing is even possible for this client. The
  // answer comes from the server so the interface cannot decide it locally.
  const testClient = await isTestClientRow(env, clientId);
  const client = await env.DB.prepare(
    'SELECT business_display_name, business_name, name FROM clients WHERE id = ?'
  ).bind(clientId).first();

  return jsonResponse({
    ...user,
    client_id: clientId,
    preview: {
      active:         true,
      client_id:      clientId,
      client_name:    client
        ? (client.business_display_name || client.business_name || client.name || `Client ${clientId}`)
        : `Client ${clientId}`,
      can_enable_write: testClient,
      write_enabled:  await previewWriteAllowed(env, request, clientId),
    },
  }, 200, env);
}

// ---- Users ----

async function handleListUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, firebase_uid, email, role, client_id, language_preference, created_at FROM users ORDER BY created_at DESC'
  ).all();
  return jsonResponse(results, 200, env);
}

async function handleUpsertUser(request, env) {
  const body = await request.json();
  const { firebase_uid, email, role, client_id, language_preference, first_name, last_name,
          interview_role, intake_enabled } = body;
  if (!firebase_uid || !email || !role) throw new ApiError('firebase_uid, email, role required', 400);
  if (!['admin', 'client'].includes(role)) throw new ApiError('role must be admin or client', 400);

  await env.DB.prepare(`
    INSERT INTO users (firebase_uid, email, role, client_id, language_preference, first_name, last_name,
                       interview_role, intake_enabled,
                       must_change_password, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      email               = excluded.email,
      role                = excluded.role,
      client_id           = excluded.client_id,
      language_preference = excluded.language_preference,
      first_name          = excluded.first_name,
      last_name           = excluded.last_name,
      interview_role      = excluded.interview_role,
      intake_enabled      = excluded.intake_enabled,
      updated_at          = CURRENT_TIMESTAMP
      -- must_change_password intentionally NOT updated here: only reset by the user themselves
  `).bind(firebase_uid, email, role, client_id ?? null, language_preference ?? 'en',
          first_name ?? null, last_name ?? null,
          interview_role ?? null, intake_enabled ? 1 : 0).run();

  const user = await env.DB.prepare('SELECT * FROM users WHERE firebase_uid = ?').bind(firebase_uid).first();
  return jsonResponse(user, 200, env);
}

async function handleDeleteUser(params, env) {
  await env.DB.prepare('DELETE FROM users WHERE firebase_uid = ?').bind(params.uid).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Clients ----

async function handleListClients(env, url) {
  const search = url.searchParams.get('search') || '';
  const statusFilter = url.searchParams.get('status') || '';
  const langFilter = url.searchParams.get('lang') || '';

  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM client_projects p WHERE p.client_id = c.id AND p.status != 'completed') AS active_projects,
      (SELECT COUNT(*) FROM client_projects p WHERE p.client_id = c.id AND p.status = 'completed') AS completed_projects,
      (SELECT COUNT(*) FROM client_projects p WHERE p.client_id = c.id) AS total_projects
    FROM clients c
    WHERE c.is_archived = 0
  `;
  const bindings = [];

  if (search) {
    sql += ` AND (c.name LIKE ? OR c.business_name LIKE ? OR c.email LIKE ?)`;
    const s = `%${search}%`;
    bindings.push(s, s, s);
  }
  if (statusFilter) {
    sql += ` AND c.overall_status = ?`;
    bindings.push(statusFilter);
  }
  if (langFilter) {
    sql += ` AND c.language_preference = ?`;
    bindings.push(langFilter);
  }

  sql += ` ORDER BY c.updated_at DESC`;

  const stmt = env.DB.prepare(sql);
  const { results } = bindings.length ? await stmt.bind(...bindings).all() : await stmt.all();
  return jsonResponse(results, 200, env);
}

// Generate a secure temporary password: 8 random chars + uppercase + digit + symbol
function generateTempPassword() {
  const chars   = 'abcdefghijkmnpqrstuvwxyz'; // no l/o to avoid confusion
  const uppers  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits  = '23456789';
  const symbols = '!@#$';
  let pw = '';
  for (let i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  pw += uppers[Math.floor(Math.random() * uppers.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += symbols[Math.floor(Math.random() * symbols.length)];
  // Shuffle so special chars aren't always at the end
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

async function handleCreateClient(request, env, user) {
  const body = await request.json();
  const {
    name, business_name, business_display_name, legal_name,
    overall_status = 'active', language_preference = 'en',
    brand_color_primary, brand_color_secondary,
    phone, whatsapp, email, website, address, contact_notes,
    first_name, last_name,
  } = body;
  if (!name && !business_display_name) throw new ApiError('name or business_display_name is required', 400);

  const displayName = business_display_name || business_name || name || '';
  const contactName = name || displayName;

  const result = await env.DB.prepare(`
    INSERT INTO clients (
      name, business_name,
      business_display_name, legal_name,
      brand_color_primary, brand_color_secondary,
      overall_status, language_preference,
      phone, whatsapp, email, website, address, contact_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    contactName, displayName,
    displayName, legal_name ?? null,
    brand_color_primary ?? null, brand_color_secondary ?? null,
    overall_status, language_preference,
    phone ?? null, whatsapp ?? null, email ?? null,
    website ?? null, address ?? null, contact_notes ?? null
  ).run();

  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(result.meta.last_row_id).first();

  // ── Auto-create Firebase account if email + API key are present ──
  let temp_password = null;
  let firebase_uid  = null;

  if (email && env.FIREBASE_API_KEY && env.FIREBASE_API_KEY !== 'REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY') {
    try {
      temp_password = generateTempPassword();

      // Extract first/last name from contact name
      const nameParts  = contactName.trim().split(/\s+/);
      const fn = first_name || nameParts[0] || '';
      const ln = last_name  || nameParts.slice(1).join(' ') || '';

      // Create Firebase Auth account via REST API
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password:    temp_password,
            displayName: contactName,
          }),
        }
      );

      if (fbRes.ok) {
        const fbData = await fbRes.json();
        firebase_uid = fbData.localId;

        // Save user record in D1
        await env.DB.prepare(`
          INSERT INTO users (firebase_uid, email, role, client_id, language_preference,
                             first_name, last_name, must_change_password)
          VALUES (?, ?, 'client', ?, ?, ?, ?, 1)
          ON CONFLICT(firebase_uid) DO UPDATE SET
            email = excluded.email, client_id = excluded.client_id,
            language_preference = excluded.language_preference,
            first_name = excluded.first_name, last_name = excluded.last_name,
            updated_at = CURRENT_TIMESTAMP
        `).bind(firebase_uid, email, client.id, language_preference, fn || null, ln || null).run();
      } else {
        // Log the error but don't fail the client creation
        const fbErr = await fbRes.json().catch(() => ({}));
        console.error('Firebase account creation failed:', fbErr);
        temp_password = null; // signal to front-end that FB creation failed
      }
    } catch (fbErr) {
      console.error('Firebase account creation error:', fbErr);
      temp_password = null;
    }
  }

  return jsonResponse({ client, temp_password, firebase_uid }, 201, env);
}

async function handleGetClient(id, env, user) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  // Clients can only view their own record
  if (user.role === 'client') {
    if (user.client_id !== parseInt(id)) throw new ApiError('Forbidden', 403);
    return buildClientPortalResponse(client, env, user);
  }

  // Admin gets full record
  return buildAdminClientResponse(client, env);
}

async function buildClientPortalResponse(client, env, viewer) {
  // Intake is enabled per person now, with the client flag as the overall
  // switch for the business. The portal card is offered only when both are on,
  // so turning intake on for a client no longer offers it to everyone there.
  const personIntakeEnabled = viewer && viewer.db_id
    ? !!(await env.DB.prepare('SELECT intake_enabled FROM users WHERE id = ?')
          .bind(viewer.db_id).first())?.intake_enabled
    : false;

  const safeClient = {
    id: client.id,
    name: client.name,
    business_name: client.business_name,
    overall_status: client.overall_status,
    language_preference: client.language_preference,
    phone: client.phone,
    whatsapp: client.whatsapp,
    email: client.email,
    website: client.website,
    logo_url: client.logo_url ?? null,
    // Both grains must be on for this person to be offered the interview.
    intake_enabled: !!client.intake_enabled && personIntakeEnabled,
    // The business-level switch on its own, so the portal can tell
    // "not enabled here at all" from "enabled, but not for you".
    client_intake_enabled: !!client.intake_enabled,
    updated_at: client.updated_at
  };

  const { results: projects } = await env.DB.prepare(
    `SELECT id, title, description_en, description_pt, future_features_en, future_features_pt,
            status, link_type, urls, due_date, updated_at
     FROM client_projects
     WHERE client_id = ? AND is_client_visible = 1
     ORDER BY sort_order ASC, created_at ASC`
  ).bind(client.id).all();

  const { results: comments } = await env.DB.prepare(
    'SELECT id, author_role, author_name, content, parent_comment_id, created_at FROM client_comments WHERE client_id = ? ORDER BY created_at ASC'
  ).bind(client.id).all();

  const { results: links } = await env.DB.prepare(
    'SELECT id, project_id, label, url, link_type FROM client_resource_links WHERE client_id = ? AND is_client_visible = 1 ORDER BY created_at ASC'
  ).bind(client.id).all();

  projects.forEach(p => { try { p.urls = JSON.parse(p.urls); } catch { p.urls = []; } });

  return jsonResponse({ client: safeClient, projects, comments, links }, 200, null);
}

async function buildAdminClientResponse(client, env) {
  const { results: projects } = await env.DB.prepare(
    'SELECT * FROM client_projects WHERE client_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(client.id).all();

  const { results: comments } = await env.DB.prepare(
    'SELECT * FROM client_comments WHERE client_id = ? ORDER BY created_at ASC'
  ).bind(client.id).all();

  const { results: notes } = await env.DB.prepare(
    'SELECT * FROM client_private_notes WHERE client_id = ? ORDER BY created_at DESC'
  ).bind(client.id).all();

  const { results: links } = await env.DB.prepare(
    'SELECT * FROM client_resource_links WHERE client_id = ? ORDER BY project_id ASC, created_at ASC'
  ).bind(client.id).all();

  // Every person on this client, not just one. A business often has more than
  // one person worth interviewing (the owner and whoever runs the back
  // office), and the previous .first() silently dropped everyone after the
  // first row. Each carries their interview status so Nicole can see who she
  // is still waiting on without opening anything.
  const { results: people } = await env.DB.prepare(`
    SELECT u.id, u.firebase_uid, u.email, u.role, u.language_preference,
           u.first_name, u.last_name, u.interview_role, u.intake_enabled,
           (SELECT s.status FROM intake_sessions s
             WHERE s.user_id = u.id ORDER BY s.created_at DESC LIMIT 1) AS interview_status,
           (SELECT s.completed_at FROM intake_sessions s
             WHERE s.user_id = u.id AND s.status = 'completed'
             ORDER BY s.completed_at DESC LIMIT 1) AS interview_completed_at,
           (SELECT COUNT(*) FROM intake_sessions s WHERE s.user_id = u.id) AS session_count
    FROM users u
    WHERE u.client_id = ?
    ORDER BY u.created_at ASC
  `).bind(client.id).all();

  // Whether this client has any interview at all, including sessions that
  // predate the user_id column and belong to nobody. The results page link is
  // shown only when this is non-zero, so a client who has never interviewed
  // does not get a dead link.
  const sessionCountRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM intake_sessions WHERE client_id = ?'
  ).bind(client.id).first();

  // Kept for backward compatibility with any caller still reading a single
  // linked user. New code should read `people`.
  const linkedUser = people.length ? people[0] : null;

  const { results: history } = await env.DB.prepare(
    'SELECT * FROM status_history WHERE client_id = ? ORDER BY changed_at DESC LIMIT 20'
  ).bind(client.id).all();

  projects.forEach(p => { try { p.urls = JSON.parse(p.urls); } catch { p.urls = []; } });

  return jsonResponse({
    client, projects, comments, notes, links,
    people,
    linked_user: linkedUser ?? null,
    intake_session_count: sessionCountRow ? sessionCountRow.n : 0,
    history,
  }, 200, null);
}

async function handleUpdateClient(id, request, env, user) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  const body = await request.json();
  const {
    name, business_name, business_display_name, legal_name,
    overall_status, language_preference,
    brand_color_primary, brand_color_secondary, intake_complete, intake_enabled,
    is_test_client,
    phone, whatsapp, email, website, address, contact_notes
  } = body;

  // Track status change
  if (overall_status && overall_status !== client.overall_status) {
    await env.DB.prepare(
      'INSERT INTO status_history (entity_type, client_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?, ?)'
    ).bind('client', id, client.overall_status, overall_status, user.uid).run();
  }

  await env.DB.prepare(`
    UPDATE clients SET
      name                  = ?,
      business_name         = ?,
      business_display_name = ?,
      legal_name            = ?,
      overall_status        = ?,
      language_preference   = ?,
      brand_color_primary   = ?,
      brand_color_secondary = ?,
      intake_complete       = ?,
      intake_enabled        = ?,
      is_test_client        = ?,
      phone                 = ?,
      whatsapp              = ?,
      email                 = ?,
      website               = ?,
      address               = ?,
      contact_notes         = ?,
      updated_at            = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    name                ?? client.name,
    business_name       ?? client.business_name,
    business_display_name ?? client.business_display_name,
    legal_name          ?? client.legal_name,
    overall_status      ?? client.overall_status,
    language_preference ?? client.language_preference,
    brand_color_primary   !== undefined ? brand_color_primary   : client.brand_color_primary,
    brand_color_secondary !== undefined ? brand_color_secondary : client.brand_color_secondary,
    intake_complete     !== undefined ? (intake_complete ? 1 : 0) : client.intake_complete,
    intake_enabled      !== undefined ? (intake_enabled ? 1 : 0) : client.intake_enabled,
    is_test_client      !== undefined ? (is_test_client ? 1 : 0) : client.is_test_client,
    phone               ?? client.phone,
    whatsapp            ?? client.whatsapp,
    email               ?? client.email,
    website             ?? client.website,
    address             ?? client.address,
    contact_notes       ?? client.contact_notes,
    id
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  return jsonResponse(updated, 200, env);
}

async function handleArchiveClient(id, env) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  await env.DB.prepare(
    'UPDATE clients SET is_archived = 1, archived_at = CURRENT_TIMESTAMP, overall_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind('archived', id).run();

  return jsonResponse({ success: true, archived_at: new Date().toISOString() }, 200, env);
}

async function handleRestoreClient(id, env) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  await env.DB.prepare(
    'UPDATE clients SET is_archived = 0, archived_at = NULL, overall_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind('active', id).run();

  return jsonResponse({ success: true }, 200, env);
}

// ---- Projects ----

async function handleListProjects(clientId, env, user) {
  let sql = 'SELECT * FROM client_projects WHERE client_id = ?';
  if (user.role === 'client') {
    if (user.client_id !== parseInt(clientId)) throw new ApiError('Forbidden', 403);
    sql += ' AND is_client_visible = 1';
  }
  sql += ' ORDER BY sort_order ASC, created_at ASC';

  const { results } = await env.DB.prepare(sql).bind(clientId).all();
  results.forEach(p => { try { p.urls = JSON.parse(p.urls); } catch { p.urls = []; } });
  return jsonResponse(results, 200, env);
}

async function handleCreateProject(clientId, request, env) {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) throw new ApiError('Client not found', 404);

  const body = await request.json();
  const {
    title, title_en, title_pt,
    description_en, description_pt, future_features_en, future_features_pt,
    status = 'not_started', link_type = 'live_site', urls = [], due_date,
    hours_before, hours_after,
    is_client_visible = 1, sort_order = 0
  } = body;

  const resolvedTitle   = title    || title_en || '';
  const resolvedTitleEn = title_en || title    || '';
  if (!resolvedTitle) throw new ApiError('title or title_en is required', 400);

  const result = await env.DB.prepare(`
    INSERT INTO client_projects
      (client_id, title, title_en, title_pt,
       description_en, description_pt, future_features_en, future_features_pt,
       status, link_type, urls, due_date,
       hours_before, hours_after,
       is_client_visible, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    clientId, resolvedTitle, resolvedTitleEn, title_pt ?? null,
    description_en ?? null, description_pt ?? null,
    future_features_en ?? null, future_features_pt ?? null,
    status, link_type, JSON.stringify(urls), due_date ?? null,
    hours_before ?? null, hours_after ?? null,
    is_client_visible ? 1 : 0, sort_order
  ).run();

  // Update client's updated_at
  await env.DB.prepare('UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(clientId).run();

  const project = await env.DB.prepare('SELECT * FROM client_projects WHERE id = ?').bind(result.meta.last_row_id).first();
  try { project.urls = JSON.parse(project.urls); } catch { project.urls = []; }
  return jsonResponse(project, 201, env);
}

async function handleUpdateProject(clientId, projectId, request, env, user) {
  const project = await env.DB.prepare('SELECT * FROM client_projects WHERE id = ? AND client_id = ?').bind(projectId, clientId).first();
  if (!project) throw new ApiError('Project not found', 404);

  const body = await request.json();
  const {
    title, title_en, title_pt,
    description_en, description_pt, future_features_en, future_features_pt,
    status, link_type, urls, due_date,
    hours_before, hours_after,
    is_client_visible, sort_order
  } = body;

  // Track status change
  if (status && status !== project.status) {
    await env.DB.prepare(
      'INSERT INTO status_history (entity_type, client_id, project_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('project', clientId, projectId, project.status, status, user.uid).run();
  }

  const resolvedTitle   = title    ?? title_en ?? project.title;
  const resolvedTitleEn = title_en ?? title    ?? project.title_en;

  await env.DB.prepare(`
    UPDATE client_projects SET
      title              = ?,
      title_en           = ?,
      title_pt           = ?,
      description_en     = ?,
      description_pt     = ?,
      future_features_en = ?,
      future_features_pt = ?,
      status             = ?,
      link_type          = ?,
      urls               = ?,
      due_date           = ?,
      hours_before       = ?,
      hours_after        = ?,
      is_client_visible  = ?,
      sort_order         = ?,
      updated_at         = CURRENT_TIMESTAMP
    WHERE id = ? AND client_id = ?
  `).bind(
    resolvedTitle,
    resolvedTitleEn,
    title_pt          !== undefined ? title_pt          : project.title_pt,
    description_en    !== undefined ? description_en    : project.description_en,
    description_pt    !== undefined ? description_pt    : project.description_pt,
    future_features_en !== undefined ? future_features_en : project.future_features_en,
    future_features_pt !== undefined ? future_features_pt : project.future_features_pt,
    status    ?? project.status,
    link_type ?? project.link_type,
    urls      !== undefined ? JSON.stringify(urls) : project.urls,
    due_date  !== undefined ? due_date  : project.due_date,
    hours_before !== undefined ? hours_before : project.hours_before,
    hours_after  !== undefined ? hours_after  : project.hours_after,
    is_client_visible !== undefined ? (is_client_visible ? 1 : 0) : project.is_client_visible,
    sort_order !== undefined ? sort_order : project.sort_order,
    projectId, clientId
  ).run();

  await env.DB.prepare('UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(clientId).run();

  const updated = await env.DB.prepare('SELECT * FROM client_projects WHERE id = ?').bind(projectId).first();
  try { updated.urls = JSON.parse(updated.urls); } catch { updated.urls = []; }

  // Check if all projects are now completed
  const { results: allProjects } = await env.DB.prepare(
    'SELECT status FROM client_projects WHERE client_id = ?'
  ).bind(clientId).all();
  const allComplete = allProjects.length > 0 && allProjects.every(p => p.status === 'completed');

  return jsonResponse({ project: updated, all_projects_complete: allComplete }, 200, env);
}

async function handleDeleteProject(clientId, projectId, env) {
  const project = await env.DB.prepare('SELECT id FROM client_projects WHERE id = ? AND client_id = ?').bind(projectId, clientId).first();
  if (!project) throw new ApiError('Project not found', 404);

  await env.DB.prepare('DELETE FROM client_projects WHERE id = ?').bind(projectId).run();
  await env.DB.prepare('UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(clientId).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Comments ----

async function handleListComments(clientId, env, user) {
  if (user.role === 'client' && user.client_id !== parseInt(clientId)) {
    throw new ApiError('Forbidden', 403);
  }
  const { results } = await env.DB.prepare(
    'SELECT * FROM client_comments WHERE client_id = ? ORDER BY created_at ASC'
  ).bind(clientId).all();
  return jsonResponse(results, 200, env);
}

async function handleAddComment(clientId, request, env, user) {
  if (user.role === 'client' && user.client_id !== parseInt(clientId)) {
    throw new ApiError('Forbidden', 403);
  }

  const body = await request.json();
  const { content, body_en, body_pt, project_id, parent_comment_id } = body;
  const resolvedContent = content || body_en || '';
  if (!resolvedContent.trim()) throw new ApiError('content or body_en is required', 400);

  const authorName = user.role === 'admin' ? 'Resonate' : (body.author_name || 'Client');

  const result = await env.DB.prepare(
    `INSERT INTO client_comments
       (client_id, project_id, author_role, author_name, content, body_en, body_pt, parent_comment_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    clientId,
    project_id ?? null,
    user.role,
    authorName,
    resolvedContent.trim(),
    body_en ?? resolvedContent.trim(),
    body_pt ?? null,
    parent_comment_id ?? null
  ).run();

  await env.DB.prepare('UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(clientId).run();

  const comment = await env.DB.prepare('SELECT * FROM client_comments WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(comment, 201, env);
}

async function handleDeleteComment(clientId, commentId, env) {
  await env.DB.prepare('DELETE FROM client_comments WHERE id = ? AND client_id = ?').bind(commentId, clientId).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Private Notes ----

async function handleListNotes(clientId, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM client_private_notes WHERE client_id = ? ORDER BY created_at DESC'
  ).bind(clientId).all();
  return jsonResponse(results, 200, env);
}

async function handleAddNote(clientId, request, env) {
  const body = await request.json();
  const { content, body: bodyText } = body;
  const resolved = (content || bodyText || '').trim();
  if (!resolved) throw new ApiError('content or body is required', 400);

  const result = await env.DB.prepare(
    'INSERT INTO client_private_notes (client_id, content, body) VALUES (?, ?, ?)'
  ).bind(clientId, resolved, resolved).run();

  const note = await env.DB.prepare('SELECT * FROM client_private_notes WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(note, 201, env);
}

async function handleUpdateNote(clientId, noteId, request, env) {
  const body = await request.json();
  const { content, body: bodyText } = body;
  const resolved = (content || bodyText || '').trim();
  if (!resolved) throw new ApiError('content or body is required', 400);

  await env.DB.prepare(
    'UPDATE client_private_notes SET content = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?'
  ).bind(resolved, resolved, noteId, clientId).run();

  const note = await env.DB.prepare('SELECT * FROM client_private_notes WHERE id = ?').bind(noteId).first();
  return jsonResponse(note, 200, env);
}

async function handleDeleteNote(clientId, noteId, env) {
  await env.DB.prepare('DELETE FROM client_private_notes WHERE id = ? AND client_id = ?').bind(noteId, clientId).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Resource Links ----

async function handleListLinks(clientId, env, user) {
  if (user.role === 'client') {
    if (user.client_id !== parseInt(clientId)) throw new ApiError('Forbidden', 403);
    const { results } = await env.DB.prepare(
      'SELECT id, label, url, link_type FROM client_resource_links WHERE client_id = ? AND is_client_visible = 1 ORDER BY created_at ASC'
    ).bind(clientId).all();
    return jsonResponse(results, 200, env);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM client_resource_links WHERE client_id = ? ORDER BY created_at ASC'
  ).bind(clientId).all();
  return jsonResponse(results, 200, env);
}

async function handleAddLink(clientId, request, env) {
  const body = await request.json();
  const {
    label, title_en, title_pt, url,
    link_type = 'other', resource_type = 'link',
    is_client_visible = 1, is_global = 0,
    related_service_id, language = 'both',
    project_id
  } = body;
  const resolvedLabel = label || title_en || '';
  if (!resolvedLabel || !url) throw new ApiError('label (or title_en) and url are required', 400);

  const result = await env.DB.prepare(`
    INSERT INTO client_resource_links
      (client_id, project_id, label, title_en, title_pt, url, link_type, resource_type,
       is_client_visible, is_global, related_service_id, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    clientId,
    project_id ?? null,
    resolvedLabel,
    title_en ?? resolvedLabel,
    title_pt ?? null,
    url,
    link_type,
    resource_type,
    is_client_visible ? 1 : 0,
    is_global ? 1 : 0,
    related_service_id ?? null,
    language
  ).run();

  const link = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(link, 201, env);
}

async function handleUpdateLink(clientId, linkId, request, env) {
  const body = await request.json();
  const {
    label, title_en, title_pt, url,
    link_type, resource_type, is_client_visible, is_global,
    related_service_id, language
  } = body;

  const existing = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ? AND client_id = ?').bind(linkId, clientId).first();
  if (!existing) throw new ApiError('Link not found', 404);

  const resolvedLabel = label ?? title_en ?? existing.label;

  await env.DB.prepare(`
    UPDATE client_resource_links SET
      label              = ?,
      title_en           = ?,
      title_pt           = ?,
      url                = ?,
      link_type          = ?,
      resource_type      = ?,
      is_client_visible  = ?,
      is_global          = ?,
      related_service_id = ?,
      language           = ?,
      updated_at         = CURRENT_TIMESTAMP
    WHERE id = ? AND client_id = ?
  `).bind(
    resolvedLabel,
    title_en ?? existing.title_en ?? resolvedLabel,
    title_pt ?? existing.title_pt,
    url ?? existing.url,
    link_type ?? existing.link_type,
    resource_type ?? existing.resource_type,
    is_client_visible !== undefined ? (is_client_visible ? 1 : 0) : existing.is_client_visible,
    is_global !== undefined ? (is_global ? 1 : 0) : existing.is_global,
    related_service_id !== undefined ? related_service_id : existing.related_service_id,
    language ?? existing.language,
    linkId, clientId
  ).run();

  const link = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ?').bind(linkId).first();
  return jsonResponse(link, 200, env);
}

async function handleDeleteLink(clientId, linkId, env) {
  await env.DB.prepare('DELETE FROM client_resource_links WHERE id = ? AND client_id = ?').bind(linkId, clientId).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Intake Responses ----

async function handleSaveIntake(request, env, user) {
  const body = await request.json();
  const { client_id, question_key, answer_en, answer_pt } = body;
  if (!client_id || !question_key) throw new ApiError('client_id and question_key required', 400);

  // Clients can only save their own intake
  if (user.role === 'client' && user.client_id !== parseInt(client_id)) {
    throw new ApiError('Forbidden', 403);
  }

  await env.DB.prepare(`
    INSERT INTO client_intake_responses (client_id, question_key, answer_en, answer_pt, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(client_id, question_key) DO UPDATE SET
      answer_en  = excluded.answer_en,
      answer_pt  = excluded.answer_pt,
      updated_at = CURRENT_TIMESTAMP
  `).bind(client_id, question_key, answer_en ?? null, answer_pt ?? null).run();

  const row = await env.DB.prepare(
    'SELECT * FROM client_intake_responses WHERE client_id = ? AND question_key = ?'
  ).bind(client_id, question_key).first();

  return jsonResponse(row, 200, env);
}

async function handleGetIntake(clientId, env, user) {
  if (user.role === 'client' && user.client_id !== parseInt(clientId)) {
    throw new ApiError('Forbidden', 403);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM client_intake_responses WHERE client_id = ? ORDER BY question_key ASC'
  ).bind(clientId).all();

  return jsonResponse(results, 200, env);
}

// ---- Logo Upload ----

async function handleUploadLogo(request, env) {
  if (!env.BUCKET) throw new ApiError('R2 bucket not configured', 500);

  const formData = await request.formData();
  const file     = formData.get('file');
  const clientId = formData.get('client_id');

  if (!file || !clientId) throw new ApiError('file and client_id required', 400);

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) throw new ApiError('Client not found', 404);

  const ext      = file.name?.split('.').pop()?.toLowerCase() || 'png';
  const key      = `logos/client-${clientId}-${Date.now()}.${ext}`;
  const buffer   = await file.arrayBuffer();

  await env.BUCKET.put(key, buffer, {
    httpMetadata: { contentType: file.type || 'image/png' }
  });

  // R2 public URL — set BUCKET_PUBLIC_URL in wrangler.toml [vars] to e.g. https://pub-abc123.r2.dev
  const logoUrl = `${env.BUCKET_PUBLIC_URL ?? 'https://pub-CONFIGURE_ME.r2.dev'}/${key}`;

  await env.DB.prepare(
    'UPDATE clients SET logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(logoUrl, clientId).run();

  return jsonResponse({ logo_url: logoUrl, key }, 200, env);
}

// ---- Public project view (no auth) ----

async function handlePublicProject(projectId, env) {
  const project = await env.DB.prepare(`
    SELECT id, client_id, title,
           description_en, description_pt,
           future_features_en, future_features_pt,
           status, due_date, updated_at
    FROM client_projects
    WHERE id = ? AND is_client_visible = 1
  `).bind(projectId).first();

  if (!project) throw new ApiError('Project not found', 404);

  const client = await env.DB.prepare(
    'SELECT business_name, logo_url, language_preference FROM clients WHERE id = ?'
  ).bind(project.client_id).first();

  const { results: links } = await env.DB.prepare(`
    SELECT id, label, url, link_type
    FROM client_resource_links
    WHERE project_id = ? AND is_client_visible = 1
    ORDER BY created_at ASC
  `).bind(projectId).all();

  // Strip client_id from project before sending
  const { client_id: _removed, ...safeProject } = project;

  return jsonResponse({ project: safeProject, client, links }, 200, env);
}

// ---- Project feedback (favorite / suggestion) ----

async function handleGetFeedback(clientId, url, env, user) {
  // Clients can only read their own feedback; admins can read any
  if (user.role !== 'admin' && String(user.client_id) !== String(clientId)) {
    throw new ApiError('Forbidden', 403);
  }
  const projectId = url.searchParams.get('project_id');
  if (!projectId) throw new ApiError('project_id required', 400);

  const { results } = await env.DB.prepare(`
    SELECT id, comment_type, content, body_en, body_pt, is_edited, admin_translation, created_at
    FROM client_comments
    WHERE client_id = ? AND project_id = ? AND comment_type IN ('favorite','suggestion')
    ORDER BY created_at ASC
  `).bind(clientId, projectId).all();
  return jsonResponse(results, 200, env);
}

async function handleUpsertFeedback(clientId, request, env, user) {
  // Only the owning client (or admin) can write feedback
  if (user.role !== 'admin' && String(user.client_id) !== String(clientId)) {
    throw new ApiError('Forbidden', 403);
  }
  const { project_id, comment_type, body } = await request.json();
  if (!project_id) throw new ApiError('project_id required', 400);
  if (!['favorite','suggestion'].includes(comment_type)) throw new ApiError('comment_type must be favorite or suggestion', 400);

  // Check if row already exists
  const existing = await env.DB.prepare(`
    SELECT id FROM client_comments
    WHERE client_id = ? AND project_id = ? AND comment_type = ?
  `).bind(clientId, project_id, comment_type).first();

  if (existing) {
    // Update — mark as edited
    await env.DB.prepare(`
      UPDATE client_comments
      SET content = ?, body_en = ?, body_pt = ?, is_edited = 1
      WHERE id = ?
    `).bind(body, body, body, existing.id).run();
    const row = await env.DB.prepare('SELECT * FROM client_comments WHERE id = ?').bind(existing.id).first();
    return jsonResponse(row, 200, env);
  } else {
    // Insert new
    const result = await env.DB.prepare(`
      INSERT INTO client_comments (client_id, project_id, comment_type, content, body_en, body_pt, author_role, is_edited)
      VALUES (?, ?, ?, ?, ?, ?, 'client', 0)
    `).bind(clientId, project_id, comment_type, body, body, body).run();
    const row = await env.DB.prepare('SELECT * FROM client_comments WHERE id = ?').bind(result.meta.last_row_id).first();
    return jsonResponse(row, 201, env);
  }
}

async function handleUpsertFeedbackTranslation(clientId, request, env) {
  const { project_id, comment_type, admin_translation } = await request.json();
  if (!project_id) throw new ApiError('project_id required', 400);
  if (!['favorite','suggestion'].includes(comment_type)) throw new ApiError('comment_type must be favorite or suggestion', 400);

  await env.DB.prepare(`
    UPDATE client_comments
    SET admin_translation = ?
    WHERE client_id = ? AND project_id = ? AND comment_type = ?
  `).bind(admin_translation ?? null, clientId, project_id, comment_type).run();
  return jsonResponse({ success: true }, 200, env);
}

// ---- Archive list ----

async function handleListArchive(env) {
  const { results } = await env.DB.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM client_projects p WHERE p.client_id = c.id) AS total_projects,
      (SELECT COUNT(*) FROM client_projects p WHERE p.client_id = c.id AND p.status = 'completed') AS completed_projects
    FROM clients c
    WHERE c.is_archived = 1
    ORDER BY c.archived_at DESC
  `).all();
  return jsonResponse(results, 200, env);
}

// ============================================================
// FIREBASE JWT VERIFICATION
// ============================================================

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new ApiError('Missing or invalid Authorization header', 401);

  const token = authHeader.slice(7);
  const payload = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);

  // Look up this user in D1
  const dbUser = await env.DB.prepare(
    'SELECT * FROM users WHERE firebase_uid = ?'
  ).bind(payload.sub).first();

  if (!dbUser) throw new ApiError('User not registered in portal. Contact your administrator.', 403);

  return {
    uid:                  payload.sub,
    email:                payload.email,
    role:                 dbUser.role,
    client_id:            dbUser.client_id,
    language_preference:  dbUser.language_preference,
    must_change_password: dbUser.must_change_password === 1,
    db_id:                dbUser.id,
    first_name:           dbUser.first_name  ?? null,
    last_name:            dbUser.last_name   ?? null,
  };
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError('Malformed token', 401);

  const [headerB64, payloadB64, signatureB64] = parts;
  let header, payload;

  try {
    header  = JSON.parse(b64UrlDecode(headerB64));
    payload = JSON.parse(b64UrlDecode(payloadB64));
  } catch {
    throw new ApiError('Token decode failed', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now)                              throw new ApiError('Token expired', 401);
  if (payload.iat > now + 300)                         throw new ApiError('Token issued in the future', 401);
  if (payload.aud !== projectId)                       throw new ApiError('Token audience mismatch', 401);
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new ApiError('Token issuer mismatch', 401);
  if (!payload.sub)                                    throw new ApiError('Token missing subject', 401);

  // Fetch Google's JWK public keys (cached by Cloudflare CDN)
  const keysRes = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    { cf: { cacheEverything: true, cacheTtl: 3600 } }
  );
  if (!keysRes.ok) throw new ApiError('Could not fetch public keys', 500);
  const { keys } = await keysRes.json();

  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new ApiError('Unknown key ID in token header', 401);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );

  const sigBytes  = b64UrlDecodeBytes(signatureB64);
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid     = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, dataBytes);
  if (!valid) throw new ApiError('Token signature invalid', 401);

  return payload;
}

function b64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded  = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return atob(padded);
}

function b64UrlDecodeBytes(str) {
  const decoded = b64UrlDecode(str);
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}

// ============================================================
// HELPERS
// ============================================================

export class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new ApiError('Forbidden — admin only', 403);
}

// ============================================================
// ADMIN PREVIEW-AS
// An admin can render any client's portal without that client's
// password. Preview only ever NARROWS what an admin can already
// reach through the admin interface, so it grants no new data —
// it only changes which view is rendered.
// ============================================================

// Who is being previewed. Returns null unless the caller is an admin.
//
// The role gate below is the entire point of this helper: a client-role
// caller who appends ?previewAs= to a URL is ignored completely, so a
// client can never view another client by editing a URL.
//
// Note that a filter which silently ignores input from the wrong caller is
// a filter someone will later mistake for an authorization check. This
// returns null for a client rather than throwing, so callers MUST treat a
// null as "not previewing" and fall back to the caller's own client_id —
// never as "allowed".
export function previewClientId(user, request) {
  if (user.role !== 'admin') return null;
  const url = new URL(request.url);
  return url.searchParams.get('previewAs') || null;
}

// The single place any handler resolves "whose data is this request about".
// For a client session this is ALWAYS that session's own client_id: a client
// can never be redirected elsewhere by a query parameter. For an admin it is
// the previewed client when previewing, and otherwise their own (null) value.
//
// Every handler that derives a client from the session must call this rather
// than reading user.client_id directly, so a route added later cannot forget
// the rule by accident.
export function effectiveClientId(user, request) {
  const previewing = previewClientId(user, request);
  if (previewing !== null) return parseInt(previewing);
  return user.client_id;
}

// Read the flag purely to choose which refusal message to show. This is a
// presentation concern only and is never consulted to ALLOW anything —
// previewWriteAllowed above is the sole authority on whether a write proceeds.
async function isTestClientRow(env, clientId) {
  try {
    const row = await env.DB.prepare(
      'SELECT is_test_client FROM clients WHERE id = ?'
    ).bind(clientId).first();
    return !!row && row.is_test_client === 1;
  } catch {
    return false;
  }
}

// Whether a preview WRITE is permitted against this client.
//
// The previewWrite query parameter alone is NEVER sufficient. The database
// flag is the actual control: this reads is_test_client from D1 on every
// single write, never from the URL, never from a cache, and never from a
// header or body the caller controls. That ordering is what makes a mistake
// on a real client structurally impossible rather than merely discouraged —
// a request forged by hand against a real client's portal is refused here
// even if every interface control were bypassed.
//
// This deliberately does not check the role, because it is only ever
// consulted after previewClientId has already established the caller is an admin.
export async function previewWriteAllowed(env, request, clientId) {
  const url = new URL(request.url);
  if (url.searchParams.get('previewWrite') !== 'on') return false;

  try {
    const row = await env.DB.prepare(
      'SELECT is_test_client FROM clients WHERE id = ?'
    ).bind(clientId).first();
    if (!row) return false;                 // missing client row: refuse
    return row.is_test_client === 1;
  } catch {
    return false;                            // any lookup failure: refuse
  }
}

export function match(pattern, path) {
  const pp = pattern.split('/');
  const cp = path.split('/');
  if (pp.length !== cp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      params[pp[i].slice(1)] = decodeURIComponent(cp[i]);
    } else if (pp[i] !== cp[i]) {
      return null;
    }
  }
  return params;
}

export function resolveCorsOrigin(request, env) {
  const configured = (env?.CORS_ORIGIN ?? '*').split(',').map(s => s.trim()).filter(Boolean);
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && configured.includes(requestOrigin)) return requestOrigin;
  return configured[0] ?? '*';
}

export function jsonResponse(data, status, env) {
  const corsOrigin = env?.CORS_ORIGIN ?? '*';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

function corsPreflightResponse(env) {
  const corsOrigin = env?.CORS_ORIGIN ?? '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}
