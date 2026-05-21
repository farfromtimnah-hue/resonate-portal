// ============================================================
// CONFIGURATION — fill in your own values before deploying
// ============================================================

// Firebase Web App config
// Where to find it: Firebase Console → Project Settings → Your Apps → Web App → SDK setup
export const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",             // ← REPLACE
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com", // ← REPLACE
  projectId:         "YOUR_PROJECT_ID",          // ← REPLACE
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",    // ← REPLACE
  messagingSenderId: "YOUR_SENDER_ID",           // ← REPLACE
  appId:             "YOUR_APP_ID"               // ← REPLACE
};

// Your Cloudflare Worker URL
// Where to find it: after running `wrangler deploy` in the worker/ directory
// Example: "https://resonate-portal-api.yourname.workers.dev"
export const API_BASE = "https://your-worker.your-subdomain.workers.dev"; // ← REPLACE
