## Status
- Project scaffolded (all backend, JS logic, and HTML structure intact)
- Design system analysis complete
- All 6 HTML/CSS pages complete and deployed on GitHub Pages
- Firebase Auth connected (real config wired in)
- Cloudflare Worker complete with all routes
- D1 schema v2 complete (12 tables, seed data)
- wrangler.toml fully configured and bound

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
9. worker/src/index.js — complete Worker with all routes:
   - GET  /api/health
   - POST /api/login       ← new: verify token, return role
   - GET  /api/me
   - GET  /api/users        (admin)
   - POST /api/users        (admin upsert, now includes first_name/last_name)
   - DELETE /api/users/:uid (admin)
   - GET  /api/clients      (admin)
   - POST /api/clients      (admin, now includes brand colors + display/legal name)
   - GET  /api/clients/:id
   - PUT  /api/clients/:id  (admin, now includes brand colors + intake_complete)
   - POST /api/clients/:id/archive
   - POST /api/clients/:id/restore
   - GET  /api/archive      (admin)
   - GET  /api/clients/:id/projects
   - POST /api/clients/:id/projects  (now includes title_en/pt, hours_before/after)
   - PUT  /api/clients/:id/projects/:pid
   - DELETE /api/clients/:id/projects/:pid
   - GET  /api/clients/:id/comments
   - POST /api/clients/:id/comments  (now includes body_en/pt, project_id)
   - DELETE /api/clients/:id/comments/:cid
   - GET  /api/clients/:id/notes      (admin)
   - POST /api/clients/:id/notes      (now writes both body + content)
   - PUT  /api/clients/:id/notes/:nid
   - DELETE /api/clients/:id/notes/:nid
   - GET  /api/clients/:id/links
   - POST /api/clients/:id/links      (now includes title_en/pt, resource_type, is_global, language)
   - PUT  /api/clients/:id/links/:lid
   - DELETE /api/clients/:id/links/:lid
   - POST /api/intake       ← new: upsert intake response row
   - GET  /api/intake/:client_id  ← new: get all intake responses for a client
   - POST /api/upload-logo  ← new: R2 upload, updates clients.logo_url
10. schema/schema.sql — v2 full schema (12 tables):
    - users (+ first_name, last_name)
    - clients (+ business_display_name, legal_name, logo_url, brand colors, intake_complete)
    - client_projects (+ title_en, title_pt, hours_before, hours_after)
    - client_comments (+ body_en, body_pt, project_id)
    - client_private_notes (+ body column, keeps content for compat)
    - client_resource_links (+ title_en, title_pt, resource_type, is_global, related_service_id, language)
    - status_history (changed_by_uid → changed_by)
    - client_intake_responses ← new
    - service_library ← new (with tier_1/2/3 seed rows)
    - proposals ← new
    - proposal_line_items ← new
    - referrals ← new
11. worker/wrangler.toml — D1 ID bound, Firebase project ID set, CORS locked to GitHub Pages, R2 bucket stub
12. firebase.json — hosting config created

## Key Decisions
- Admin pages use `<html class="dark">` with background #0f1115
- Client portal uses light mode with background #F8F7F4
- Login page uses animated HTML5 canvas (no image file) for ripple background
- Tailwind CDN loaded in every HTML file with shared tailwind.config
- app.css handles ONLY: functional JS-driven classes, status badge colours, dynamic component styles
- JS files are NOT touched for HTML/CSS changes — API response shapes maintain backward compat
- Custom CSS variables (--bg, --surface, --text-1, etc.) flip between dark/light via html.dark selector
- All buttons and inputs are pill-shaped (border-radius: 9999px)
- Glassmorphism only on login card
- Material Symbols used for icons throughout admin pages
- client.html uses fixed left sidebar (w-72) + ml-72 main content, two-column grid inside
- portal.html: lang-btn / lang-btn--active classes defined in app.css, toggled by portal.js
- Firebase Auth only (no Firestore/RTDB) — security enforced by Worker JWT verification
- All new schema columns additive — old JS field names still returned in API responses for compat
- R2 logo upload requires: (1) create bucket `resonate-logos`, (2) enable public access, (3) set BUCKET_PUBLIC_ID env var

## Next Steps
- Create R2 bucket: `wrangler r2 bucket create resonate-logos`
- Apply schema: `wrangler d1 execute resonate-portal --file=schema/schema.sql --remote`
- Deploy worker: `cd worker && wrangler deploy`
- In Firebase Console → Authentication → Settings → Authorized domains:
  add `farfromtimnah-hue.github.io`
- Create first admin user in Firebase Auth, then add to D1 users table with role='admin'
