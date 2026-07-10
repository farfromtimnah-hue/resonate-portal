// ============================================================
// API client — wraps all Worker calls with auth headers
// ============================================================

import { getToken }  from './auth.js';
import { API_BASE }  from './config.js';

async function req(method, path, body) {
  const token = await getToken();
  const opts  = {
    method,
    cache: 'no-store',   // never serve stale data from the browser cache
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---- User / auth ----
export const api = {
  me:              ()    => req('GET',  '/api/me'),
  passwordChanged: ()    => req('POST', '/api/me/password-changed'),

  // Users (admin)
  users:        ()               => req('GET',    '/api/users'),
  upsertUser:   (data)           => req('POST',   '/api/users', data),
  deleteUser:   (uid)            => req('DELETE', `/api/users/${uid}`),

  // Clients (admin)
  clients:      (params = '')    => req('GET',    `/api/clients${params}`),
  createClient: (data)           => req('POST',   '/api/clients', data),
  getClient:    (id)             => req('GET',    `/api/clients/${id}`),
  updateClient: (id, data)       => req('PUT',    `/api/clients/${id}`, data),
  archiveClient: (id)            => req('POST',   `/api/clients/${id}/archive`),
  restoreClient: (id)            => req('POST',   `/api/clients/${id}/restore`),
  archive:      ()               => req('GET',    '/api/archive'),

  // Projects
  projects:      (clientId)      => req('GET',    `/api/clients/${clientId}/projects`),
  createProject: (clientId, d)   => req('POST',   `/api/clients/${clientId}/projects`, d),
  updateProject: (clientId, id, d) => req('PUT',  `/api/clients/${clientId}/projects/${id}`, d),
  deleteProject: (clientId, id)  => req('DELETE', `/api/clients/${clientId}/projects/${id}`),

  // Comments
  comments:      (clientId)      => req('GET',    `/api/clients/${clientId}/comments`),
  addComment:    (clientId, d)   => req('POST',   `/api/clients/${clientId}/comments`, d),
  deleteComment: (clientId, id)  => req('DELETE', `/api/clients/${clientId}/comments/${id}`),

  // Private notes (admin)
  notes:         (clientId)      => req('GET',    `/api/clients/${clientId}/notes`),
  addNote:       (clientId, d)   => req('POST',   `/api/clients/${clientId}/notes`, d),
  updateNote:    (clientId, id, d) => req('PUT',  `/api/clients/${clientId}/notes/${id}`, d),
  deleteNote:    (clientId, id)  => req('DELETE', `/api/clients/${clientId}/notes/${id}`),

  // Resource links
  links:         (clientId)      => req('GET',    `/api/clients/${clientId}/links`),
  addLink:       (clientId, d)   => req('POST',   `/api/clients/${clientId}/links`, d),
  updateLink:    (clientId, id, d) => req('PUT',  `/api/clients/${clientId}/links/${id}`, d),
  deleteLink:    (clientId, id)  => req('DELETE', `/api/clients/${clientId}/links/${id}`),

  // Project feedback (favorite / suggestion inputs on portal project cards)
  getFeedback:   (clientId, projectId) => req('GET', `/api/clients/${clientId}/feedback?project_id=${projectId}`),
  upsertFeedback:(clientId, d)         => req('PUT', `/api/clients/${clientId}/feedback`, d),
  saveFeedbackTranslation: (clientId, d) => req('PUT', `/api/clients/${clientId}/feedback/translation`, d),

  // AI intake interview (adaptive interview engine)
  interviewCurrent:       ()          => req('GET',  '/api/interview/current'),
  interviewCreateSession: (d)         => req('POST', '/api/interview/sessions', d),
  interviewUpdateSession: (sid, d)    => req('PUT',  `/api/interview/sessions/${sid}`, d),
  interviewSavePrefs:     (sid, d)    => req('PUT',  `/api/interview/sessions/${sid}/preferences`, d),
  interviewStartSection:  (sid, d)    => req('POST', `/api/interview/sessions/${sid}/start`, d),
  interviewAnswer:        (sid, d)    => req('POST', `/api/interview/sessions/${sid}/answer`, d),
  interviewFuture:        (sid, d)    => req('POST', `/api/interview/sessions/${sid}/future`, d),
  interviewFutureSkip:    (sid)       => req('POST', `/api/interview/sessions/${sid}/future/skip`, {}),
  interviewExport:        (clientId)  => req('GET',  `/api/interview/clients/${clientId}/export`),

  // Logo upload (multipart/form-data — bypasses the JSON req() helper)
  uploadLogo: async (clientId, file) => {
    const token = await getToken();
    const body  = new FormData();
    body.append('file', file);
    body.append('client_id', String(clientId));
    const res  = await fetch(`${API_BASE}/api/upload-logo`, {
      method: 'POST',
      cache:  'no-store',
      headers: { 'Authorization': `Bearer ${token}` },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
};
