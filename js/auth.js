// ============================================================
// Firebase Authentication helpers
// ============================================================

import { initializeApp }                                  from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword,
         signInWithPopup, GoogleAuthProvider,
         onAuthStateChanged, signOut as fbSignOut,
         getIdToken, updatePassword,
         reauthenticateWithCredential,
         EmailAuthProvider }                              from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js';
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

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
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

// Change the current user's password.
// Always reauthenticates first so it works even after a long session.
export async function changePassword(currentPassword, newPassword) {
  if (!_fbUser) throw new Error('Not signed in');
  const credential = EmailAuthProvider.credential(_fbUser.email, currentPassword);
  await reauthenticateWithCredential(_fbUser, credential);
  await updatePassword(_fbUser, newPassword);
}

// For first-login: user just authenticated so no reauthentication needed.
export async function setInitialPassword(newPassword) {
  if (!_fbUser) throw new Error('Not signed in');
  await updatePassword(_fbUser, newPassword);
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
    window.location.href = 'index.html';
    return null;
  }
  // An admin previewing a client's portal is legitimately on a client page.
  // profile.preview is set by the Worker and only ever for an admin caller,
  // so this cannot be used by a client to reach a page meant for another role.
  if (expectedRole === 'client' && profile.role === 'admin' && profile.preview?.active) {
    return profile;
  }
  if (expectedRole && profile.role !== expectedRole) {
    // Wrong role — send to the correct page
    if (profile.role === 'admin')  window.location.href = 'dashboard.html';
    if (profile.role === 'client') window.location.href = 'portal.html';
    return null;
  }
  return profile;
}

// ---- Internal ----

async function fetchProfile(fbUser) {
  const token = await getIdToken(fbUser);
  // Carry preview context: this call bypasses the api.js request helper, and
  // /api/me is what reports the previewed client and whether writing is
  // possible. The Worker ignores previewAs entirely for a non-admin caller.
  const page      = new URLSearchParams(window.location.search);
  const previewAs = page.get('previewAs');
  let   query     = '';
  if (previewAs) {
    query = `?previewAs=${encodeURIComponent(previewAs)}`;
    // previewWrite must be forwarded too, otherwise the Worker always reports
    // write_enabled: false and the banner could never show the enabled state.
    const previewWrite = page.get('previewWrite');
    if (previewWrite) query += `&previewWrite=${encodeURIComponent(previewWrite)}`;
  }
  const res   = await fetch(`${API_BASE}/api/me${query}`, {
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
