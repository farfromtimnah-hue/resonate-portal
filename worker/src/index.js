// ============================================================
// Resonate Business Systems — Client Portal API
// Cloudflare Worker — handles all data operations
// Verifies Firebase ID tokens, enforces role-based access,
// reads/writes from Cloudflare D1.
// ============================================================

export default {
  async fetch(request, env, ctx) {
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

      // All other routes require a valid Firebase token
      const user = await authenticate(request, env);

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
    return handleGetMe(env, user);
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

  return jsonResponse({ error: 'Not found' }, 404, env);
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

async function handleGetMe(env, user) {
  return jsonResponse(user, 200, env);
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
  const { firebase_uid, email, role, client_id, language_preference } = body;
  if (!firebase_uid || !email || !role) throw new ApiError('firebase_uid, email, role required', 400);
  if (!['admin', 'client'].includes(role)) throw new ApiError('role must be admin or client', 400);

  await env.DB.prepare(`
    INSERT INTO users (firebase_uid, email, role, client_id, language_preference, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      email = excluded.email,
      role = excluded.role,
      client_id = excluded.client_id,
      language_preference = excluded.language_preference,
      updated_at = CURRENT_TIMESTAMP
  `).bind(firebase_uid, email, role, client_id ?? null, language_preference ?? 'en').run();

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

async function handleCreateClient(request, env, user) {
  const body = await request.json();
  const {
    name, business_name, overall_status = 'active', language_preference = 'en',
    phone, whatsapp, email, website, address, contact_notes
  } = body;
  if (!name) throw new ApiError('name is required', 400);

  const result = await env.DB.prepare(`
    INSERT INTO clients (name, business_name, overall_status, language_preference, phone, whatsapp, email, website, address, contact_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(name, business_name ?? null, overall_status, language_preference, phone ?? null, whatsapp ?? null, email ?? null, website ?? null, address ?? null, contact_notes ?? null).run();

  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(client, 201, env);
}

async function handleGetClient(id, env, user) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  // Clients can only view their own record
  if (user.role === 'client') {
    if (user.client_id !== parseInt(id)) throw new ApiError('Forbidden', 403);
    return buildClientPortalResponse(client, env);
  }

  // Admin gets full record
  return buildAdminClientResponse(client, env);
}

async function buildClientPortalResponse(client, env) {
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
    'SELECT id, label, url, link_type FROM client_resource_links WHERE client_id = ? AND is_client_visible = 1 ORDER BY created_at ASC'
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
    'SELECT * FROM client_resource_links WHERE client_id = ? ORDER BY created_at ASC'
  ).bind(client.id).all();

  const linkedUser = await env.DB.prepare(
    'SELECT id, firebase_uid, email, role, language_preference FROM users WHERE client_id = ?'
  ).bind(client.id).first();

  const { results: history } = await env.DB.prepare(
    'SELECT * FROM status_history WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(client.id).all();

  projects.forEach(p => { try { p.urls = JSON.parse(p.urls); } catch { p.urls = []; } });

  return jsonResponse({ client, projects, comments, notes, links, linked_user: linkedUser ?? null, history }, 200, null);
}

async function handleUpdateClient(id, request, env, user) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new ApiError('Client not found', 404);

  const body = await request.json();
  const {
    name, business_name, overall_status, language_preference,
    phone, whatsapp, email, website, address, contact_notes
  } = body;

  // Track status change
  if (overall_status && overall_status !== client.overall_status) {
    await env.DB.prepare(
      'INSERT INTO status_history (entity_type, client_id, old_status, new_status, changed_by_uid) VALUES (?, ?, ?, ?, ?)'
    ).bind('client', id, client.overall_status, overall_status, user.uid).run();
  }

  await env.DB.prepare(`
    UPDATE clients SET
      name = ?,
      business_name = ?,
      overall_status = ?,
      language_preference = ?,
      phone = ?,
      whatsapp = ?,
      email = ?,
      website = ?,
      address = ?,
      contact_notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    name ?? client.name,
    business_name ?? client.business_name,
    overall_status ?? client.overall_status,
    language_preference ?? client.language_preference,
    phone ?? client.phone,
    whatsapp ?? client.whatsapp,
    email ?? client.email,
    website ?? client.website,
    address ?? client.address,
    contact_notes ?? client.contact_notes,
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
    title, description_en, description_pt, future_features_en, future_features_pt,
    status = 'not_started', link_type = 'live_site', urls = [], due_date,
    is_client_visible = 1, sort_order = 0
  } = body;
  if (!title) throw new ApiError('title is required', 400);

  const result = await env.DB.prepare(`
    INSERT INTO client_projects
      (client_id, title, description_en, description_pt, future_features_en, future_features_pt,
       status, link_type, urls, due_date, is_client_visible, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    clientId, title,
    description_en ?? null, description_pt ?? null,
    future_features_en ?? null, future_features_pt ?? null,
    status, link_type, JSON.stringify(urls), due_date ?? null,
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
    title, description_en, description_pt, future_features_en, future_features_pt,
    status, link_type, urls, due_date, is_client_visible, sort_order
  } = body;

  // Track status change
  if (status && status !== project.status) {
    await env.DB.prepare(
      'INSERT INTO status_history (entity_type, client_id, project_id, old_status, new_status, changed_by_uid) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('project', clientId, projectId, project.status, status, user.uid).run();
  }

  await env.DB.prepare(`
    UPDATE client_projects SET
      title = ?, description_en = ?, description_pt = ?,
      future_features_en = ?, future_features_pt = ?,
      status = ?, link_type = ?, urls = ?, due_date = ?,
      is_client_visible = ?, sort_order = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND client_id = ?
  `).bind(
    title ?? project.title,
    description_en !== undefined ? description_en : project.description_en,
    description_pt !== undefined ? description_pt : project.description_pt,
    future_features_en !== undefined ? future_features_en : project.future_features_en,
    future_features_pt !== undefined ? future_features_pt : project.future_features_pt,
    status ?? project.status,
    link_type ?? project.link_type,
    urls !== undefined ? JSON.stringify(urls) : project.urls,
    due_date !== undefined ? due_date : project.due_date,
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
  const { content, parent_comment_id } = body;
  if (!content?.trim()) throw new ApiError('content is required', 400);

  const authorName = user.role === 'admin' ? 'Resonate' : (body.author_name || 'Client');

  const result = await env.DB.prepare(
    'INSERT INTO client_comments (client_id, author_role, author_name, content, parent_comment_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(clientId, user.role, authorName, content.trim(), parent_comment_id ?? null).run();

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
  const { content } = body;
  if (!content?.trim()) throw new ApiError('content is required', 400);

  const result = await env.DB.prepare(
    'INSERT INTO client_private_notes (client_id, content) VALUES (?, ?)'
  ).bind(clientId, content.trim()).run();

  const note = await env.DB.prepare('SELECT * FROM client_private_notes WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(note, 201, env);
}

async function handleUpdateNote(clientId, noteId, request, env) {
  const body = await request.json();
  const { content } = body;
  if (!content?.trim()) throw new ApiError('content is required', 400);

  await env.DB.prepare(
    'UPDATE client_private_notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?'
  ).bind(content.trim(), noteId, clientId).run();

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
  const { label, url, link_type = 'other', is_client_visible = 0 } = body;
  if (!label || !url) throw new ApiError('label and url are required', 400);

  const result = await env.DB.prepare(
    'INSERT INTO client_resource_links (client_id, label, url, link_type, is_client_visible) VALUES (?, ?, ?, ?, ?)'
  ).bind(clientId, label, url, link_type, is_client_visible ? 1 : 0).run();

  const link = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse(link, 201, env);
}

async function handleUpdateLink(clientId, linkId, request, env) {
  const body = await request.json();
  const { label, url, link_type, is_client_visible } = body;

  const existing = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ? AND client_id = ?').bind(linkId, clientId).first();
  if (!existing) throw new ApiError('Link not found', 404);

  await env.DB.prepare(
    'UPDATE client_resource_links SET label = ?, url = ?, link_type = ?, is_client_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ?'
  ).bind(
    label ?? existing.label,
    url ?? existing.url,
    link_type ?? existing.link_type,
    is_client_visible !== undefined ? (is_client_visible ? 1 : 0) : existing.is_client_visible,
    linkId, clientId
  ).run();

  const link = await env.DB.prepare('SELECT * FROM client_resource_links WHERE id = ?').bind(linkId).first();
  return jsonResponse(link, 200, env);
}

async function handleDeleteLink(clientId, linkId, env) {
  await env.DB.prepare('DELETE FROM client_resource_links WHERE id = ? AND client_id = ?').bind(linkId, clientId).run();
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
    uid: payload.sub,
    email: payload.email,
    role: dbUser.role,
    client_id: dbUser.client_id,
    language_preference: dbUser.language_preference,
    db_id: dbUser.id
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

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new ApiError('Forbidden — admin only', 403);
}

function match(pattern, path) {
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

function jsonResponse(data, status, env) {
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
