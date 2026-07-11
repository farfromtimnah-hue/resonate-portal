## Status
- Project scaffolded (all backend, JS logic, and HTML structure intact)
- Design system analysis complete
- All HTML/CSS pages complete and deployed on GitHub Pages
- Firebase Auth connected (real config wired in)
- Cloudflare Worker complete with all routes and deployed
- D1 schema v2 applied to remote database; schema updates applied per session
- Admin user (Nicole LePage) seeded in D1
- GitHub Pages live and routing correctly at farfromtimnah-hue.github.io/resonate-portal
- R2 bucket live: resonate-logos / pub-cec1d75467e245eb85ad5c1a9955a3e2.r2.dev
- Public project view live: public.html?project=<id> (no login required)
- Alice Prata phone/WhatsApp updated to +12144485917 in D1

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

### Sessions 4–6 — Portal features, logo upload, share button, public view

#### Session 4 fixes
19a. isProjectFormDirty() — new projects only; false for edits
19b. New projects created at top (sort_order: 0, existing shifted to idx+1)
19c. openAddProject passes shouldClose dirty-check guard to openModal

#### Session 5 — Logo upload + portal identity + tabs + warm states
20. Logo upload (admin client page): R2 upload via POST /api/upload-logo; preview shows img or initials
21. Client portal identity overhaul: logo_url shown as <img> if set, else styled wordmark
22. Portal greeting with first_name: "Welcome back, Alice" / "Olá, Alice"
    - first_name/last_name added to authenticate() return; available as _profile.first_name
23. Projects / Vision tab navigation with smart default:
    - Defaults to Vision tab when no visible projects; Projects tab when projects exist
    - _tabManuallySet flag prevents auto-switching after user explicitly picks a tab
24. Warm empty states — portal_no_projects and portal_no_comments updated with warm copy
25. Vision tab: bilingual brand manifesto rendered from t.js vision_copy key
26. #portal-vision-extras div reserved for future content
27. Progress section hidden when no projects; shown when projects exist

#### Session 6 — Share button + public project view
28. Share button on each portal project card (event delegation, no per-card listener)
    - navigator.share() on mobile (native sheet: WhatsApp, Messages, etc.)
    - Custom floating menu on desktop: WhatsApp, Email, Copy Link (singleton pattern)
    - Share URL: public.html?project=<id>
29. public.html — new read-only public project page (no login required)
    - Sticky header with EN/PT toggle
    - Renders project card, links, Coming Up, dates
    - Falls back to lang from client.language_preference
30. js/public.js — no auth, raw fetch to /api/public/projects/:id
31. Worker: GET /api/public/projects/:id — unauthenticated route
    - Checked BEFORE authenticate() in main fetch handler
    - Returns { project: safeProject, client, links } — client_id stripped via destructuring
    - Only returns project if is_client_visible = 1
32. wrangler.toml: BUCKET_PUBLIC_URL set to live R2 URL
33. D1: logo_url column confirmed present (ALTER TABLE returned duplicate-column; column pre-existed)

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
- GET  /api/public/projects/:id    — unauthenticated public project view
- GET  /api/clients/:id/feedback   — project feedback (favorite/suggestion rows) by project_id
- PUT  /api/clients/:id/feedback   — upsert feedback row; marks is_edited=1 on update

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
- After implementing Item 11 (Firebase account creation): add FIREBASE_API_KEY to wrangler.toml secrets
- After implementing Item 12 (Google Sign In): whitelist farfromtimnah-hue.github.io in Firebase Console → Authentication → Authorized domains; enable Google provider
- Run `wrangler deploy` after each worker change
- Run D1 ALTER TABLE migrations for Items 9/10 (comment_type, is_edited, admin_translation columns)
2026-07-05 — Added standalone project hub page at hub/index.html. No existing files touched.

## Session 2026-07-11 — Custom domain + Zoho Invoice integration

### Phase 1 — portal.resonateai.online
- CNAME file at repo root (portal.resonateai.online); GitHub Pages picked it up automatically
- Worker CORS_ORIGIN is now a comma-separated allowlist (GitHub Pages + custom domain);
  Worker echoes the matching request Origin and adds Vary: Origin
- HTTPS enforcement pending GitHub cert provisioning (retry in Settings → Pages)
- wrangler.toml PORTAL_URL var = where the Zoho OAuth callback redirects back to;
  UPDATE IT to https://portal.resonateai.online once the domain is verified live

### Phase 2 — Zoho Invoice OAuth connect flow (worker/src/zoho.js)
- GET  /api/zoho/oauth/start     (admin) — returns Zoho consent-screen URL; frontend navigates there
- GET  /api/zoho/oauth/callback  (unauthenticated, Zoho browser redirect) — exchanges code,
  stores refresh token + org id in D1 zoho_connection, redirects back to dashboard ?zoho=<result>
- GET  /api/zoho/status          (admin) — configured / connected state
- POST /api/zoho/disconnect      (admin)
- D1: zoho_connection single-row table (schema/zoho.sql, applied remotely)
- Access token cached in D1 (~3600s, 2-min margin) — Zoho hard-limits 10 token requests/10 min
- Auth header is `Zoho-oauthtoken {token}`; organization_id sent as query param AND
  X-com-zoho-invoice-organizationid header on every call
- Dashboard: Integrations card with Connect Zoho Invoice / Disconnect + graceful states
- NICOLE TODO: register a Server-based Application in Zoho API Console with redirect URI
  https://resonate-portal-api.farfromtimnah.workers.dev/api/zoho/oauth/callback
  then: cd worker && wrangler secret put ZOHO_CLIENT_ID && wrangler secret put ZOHO_CLIENT_SECRET
  then click Connect Zoho Invoice on the dashboard

### Phase 3 — Invoice sync + Pay Now
- D1: client_invoices table + clients.zoho_customer_id column (schema/invoices.sql, applied remotely)
- POST /api/zoho/sync/:client_id (admin) — auto-matches Zoho customer by client email
  (stores zoho_customer_id), pulls invoices, upserts cache incl. hosted invoice_url
- GET  /api/clients/:id/invoices — cached list, admin or own client only
- Admin client page: Invoices card with "Sync from Zoho" button, status badges
  (draft/void=gray, sent/viewed/unpaid=blue, partially_paid=cyan, overdue=amber, paid=green)
- Client portal: bilingual Invoices section (hidden when empty; drafts/void filtered out);
  "Pay Now" opens Zoho hosted payment page in new tab, hidden when no URL synced
- Tested with mock Zoho API responses (documented v3 schema) — token caching, upsert,
  email matching, access control, graceful not-connected states all covered
