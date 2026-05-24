// ============================================================
// Firebase Authentication helpers
// ============================================================

import { initializeApp }                                  from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword,
         onAuthStateChanged, signOut as fbSignOut,
         getIdToken }                                     from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
import { FIREBASE_CONFIG, API_BASE }                      from './config.js';

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

// Keep the current Firebase user + portal profile in memory for this session
let _fbUser    = null;   // Firebase User object
let _profile   = null;   // { uid, email, role, client_id, language_preference }

// ---- Public API ----

export function getAuth_() { return auth; }

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  _fbUser  = cred.user;
  _profile = await fetchProfile(cred.user);
  return _profile;
}

export async function signOut() {
  await fbSignOut(auth);
  _fbUser  = null;
  _profile = null;
}

export async function getProfile() {
  if (_profile) return _profile;
  await waitForAuth();
  return _profile;
}

export async function getToken() {
  if (!_fbUser) {
    await waitForAuth();
    if (!_fbUser) return null;
  }
  return getIdToken(_fbUser, /* forceRefresh */ false);
}

// Call this at the top of every protected page.
// Redirects to index.html if not logged in.
// Returns the user profile.
export async function requireAuth(expectedRole = null) {
  const profile = await getProfile();
  if (!profile) {
    window.location.href = '/resonate-portal/index.html';
    return null;
  }
  if (expectedRole && profile.role !== expectedRole) {
    // Wrong role — send to the correct page
    if (profile.role === 'admin')  window.location.href = '/resonate-portal/dashboard.html';
    if (profile.role === 'client') window.location.href = '/resonate-portal/portal.html';
    return null;
  }
  return profile;
}

// ---- Internal ----

async function fetchProfile(fbUser) {
  const token = await getIdToken(fbUser);
  const res   = await fetch(`${API_BASE}/api/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    await fbSignOut(auth);
    throw new Error('Account not registered in portal. Contact your administrator.');
  }
  return res.json();
}

// Waits for Firebase to resolve the auth state on page load
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      unsub();
      if (fbUser) {
        _fbUser = fbUser;
        try { _profile = await fetchProfile(fbUser); } catch { _profile = null; }
      }
      resolve();
    });
  });
}
