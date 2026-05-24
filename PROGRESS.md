## Status
- Project scaffolded (all backend, JS logic, and HTML structure intact)
- Design system analysis complete
- All 6 HTML/CSS pages complete and deployed on GitHub Pages
- Firebase Auth connected (real config wired in)
- Cloudflare Worker complete with all routes and deployed
- D1 schema v2 applied to remote database
- Admin user (Nicole LePage) seeded in D1
- GitHub Pages live and routing correctly at farfromtimnah-hue.github.io/resonate-portal

## Completed ✓

### Session 1 — Design system & pages
1. css/app.css — full design system (tokens, dark/light, all dynamic component classes, lang-btn)
2. index.html — login page with canvas ripple + glassmorphism card
3. dashboard.html — dark admin dashboard
4. archive.html — dark admin archive page
5. client.html — dark admin client detail (sidebar layout)
6. portal.html — light mode client portal

### Session 2 — Backend integration
7. js/config.js — real Firebase config + Worker URL filled in
8. js/auth.js — Firebase SDK updated to v12.13.0
9. worker/src/index.js — complete Worker with all routes (see route list below)
10. schema/schema.sql — v2 full schema (12 tables, seed data)
11. worker/wrangler.toml — D1 ID bound, Firebase project ID set, CORS locked to GitHub Pages, R2 bucket stub
12. firebase.json — hosting config created
13. PR #1 opened and merged: backend/firebase-worker-schema → main

### Session 3 — Deployment & live fixes
14. wrangler deploy — Worker deployed to resonate-portal-api.farfromtimnah.workers.dev
15. wrangler d1 execute — schema applied to remote D1 database
16. Admin user seeded in D1:
    - firebase_uid: q7isT9dD0ObKWz08fZrnKdeI6gA2
    - email: nicole@resonateai.online
    - role: admin | first_name: Nicole | last_name: LePage
17. .nojekyll — added to disable Jekyll processing on GitHub Pages
18. GitHub Pages path fixes — all window.location.href and HTML href attributes
    updated to include /resonate-portal/ prefix across all pages and JS files:
    js/auth.js, js/dashboard.js, js/portal.js, js/archive.js, js/client-page.js,
    dashboard.html, archive.html, client.html
19. index.html input text color fix — .pill-input changed from white text on
    near-transparent background to dark text (#0f1115) on opaque white background;
    added -webkit-autofill overrides to prevent browser autofill from making text
    invisible
20. index.html post-login redirect fix — inline script had hardcoded bare paths
    (/dashboard.html, /portal.html) that were missed in the first path-fix pass;
    all four redirects corrected
21. index.html session resume panel — replaced silent auto-redirect on page load
    with an explicit resume panel:
    - getProfile() calls Worker /api/me (D1-confirmed, not just Firebase session)
    - If valid session: shows signed-in email + role, Continue button, Sign out button
    - If no session or Worker error: shows login form
    - Sign out button clears Firebase session and reveals login form
    - All redirects go through a single destFor(role) helper → eliminates
      hardcoded path bugs
    - signOut imported into login page script (was missing)

## Worker API Routes
- GET  /api/health
- POST /api/login        — verify token, return role
- GET  /api/me
- GET  /api/users        (admin)
- POST /api/users        (admin upsert — first_name, last_name supported)
- DELETE /api/users/:uid (admin)
- GET  /api/clients      (admin)
- POST /api/clients      (admin — brand colors, display/legal name supported)
- GET  /api/clients/:id
- PUT  /api/clients/:id  (admin — brand colors, intake_complete supported)
- POST /api/clients/:id/archive
- POST /api/clients/:id/restore
- GET  /api/archive      (admin)
- GET  /api/clients/:id/projects
- POST /api/clients/:id/projects   (title_en/pt, hours_before/after supported)
- PUT  /api/clients/:id/projects/:pid
- DELETE /api/clients/:id/projects/:pid
- GET  /api/clients/:id/comments
- POST /api/clients/:id/comments   (body_en/pt, project_id supported)
- DELETE /api/clients/:id/comments/:cid
- GET  /api/clients/:id/notes      (admin)
- POST /api/clients/:id/notes      (body + content written)
- PUT  /api/clients/:id/notes/:nid
- DELETE /api/clients/:id/notes/:nid
- GET  /api/clients/:id/links
- POST /api/clients/:id/links      (title_en/pt, resource_type, is_global, language)
- PUT  /api/clients/:id/links/:lid
- DELETE /api/clients/:id/links/:lid
- POST /api/intake                 — upsert intake response (ON CONFLICT idempotent)
- GET  /api/intake/:client_id      — list intake responses (admin or own client)
- POST /api/upload-logo            — R2 upload, updates clients.logo_url

## D1 Schema — 12 Tables
- users (firebase_uid, role, first_name, last_name, language_preference, client_id)
- clients (business_display_name, legal_name, logo_url, brand colors, intake_complete,
           name + business_name kept for JS compat, contact fields)
- client_projects (title_en/pt + title for compat, hours_before/after, status CHECK)
- client_comments (body_en/pt + content for compat, project_id FK)
- client_private_notes (body + content for compat)
- client_resource_links (title_en/pt, resource_type, is_global, language,
                          label + link_type + is_client_visible for compat)
- status_history (entity_type, changed_by)
- client_intake_responses (question_key, answer_en, answer_pt — UNIQUE per client)
- service_library (tier_1/2/3 seeded with placeholders)
- proposals (draft/sent/accepted/declined)
- proposal_line_items (hours_before/after, price, sort_order)
- referrals (referring_client_id, status)

## Key Decisions
- Admin pages use `<html class="dark">` with background #0f1115
- Client portal uses light mode with background #F8F7F4
- Login page uses animated HTML5 canvas (no image file) for ripple background
- Tailwind CDN loaded in every HTML file with shared tailwind.config
- app.css handles ONLY: functional JS-driven classes, status badge colours, dynamic component styles
- Firebase Auth only (no Firestore/RTDB) — security enforced by Worker JWT verification
- All new schema columns additive — old JS field names still returned in API responses for compat
- All internal navigation uses /resonate-portal/ prefix for GitHub Pages project subpath
- Login page never auto-redirects — user must confirm resume or re-enter credentials
- R2 logo upload: still needs bucket creation + public access + BUCKET_PUBLIC_ID env var

## Next Steps
- Create a first client record and test the full admin flow end to end
- Create an R2 bucket (wrangler r2 bucket create resonate-logos) when logo upload is needed
- Set Firebase Console → Authentication → Authorized domains → farfromtimnah-hue.github.io
  (if not already done — prevents other origins using the auth project)
- Add client users in Firebase Auth + D1 to test the portal flow
