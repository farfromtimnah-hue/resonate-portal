// ============================================================
// CONFIGURATION
// ============================================================

export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA3YWrys408IlbeViOyzgKDmOlfauM7N30",
  authDomain:        "resonate-portal.firebaseapp.com",
  projectId:         "resonate-portal",
  storageBucket:     "resonate-portal.firebasestorage.app",
  messagingSenderId: "328078804214",
  appId:             "1:328078804214:web:2864592777de63af9618d7"
};

export const API_BASE = "https://resonate-portal-api.farfromtimnah.workers.dev";

// Whisper voice-input server (WebSocket). The actual server is set up
// separately outside this repo, on Nicole's own machine. Leave empty
// until it exists — the intake interview silently falls back to
// text-only input whenever this is empty or unreachable.
export const WHISPER_WS_URL = "";
