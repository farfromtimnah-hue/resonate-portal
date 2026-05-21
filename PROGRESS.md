## Status
- Project scaffolded (all backend, JS logic, and HTML structure intact)
- Design system analysis complete
- PROGRESS.md created
- css/app.css rewritten: design tokens, all dynamic component classes, dark/light modes
- index.html done: canvas ripple animation (#0a1628), glassmorphism card, Fraunces wordmark
- dashboard.html done: dark admin dashboard, glass header, pill filters, create-client modal
- archive.html done: dark admin archive, stat pills, pill search, MutationObserver for counts
- client.html done: dark admin client detail, fixed left sidebar nav, two-column content grid
- portal.html done: light mode (#F8F7F4) client portal, sticky header, bilingual lang toggle

## Completed ✓
1. css/app.css — full design system (tokens, dark/light, all dynamic component classes, lang-btn)
2. index.html — login page with canvas ripple + glassmorphism card
3. dashboard.html — dark admin dashboard
4. archive.html — dark admin archive page
5. client.html — dark admin client detail (sidebar layout)
6. portal.html — light mode client portal

## All pages complete — restyling done.

## Key Decisions
- Admin pages use `<html class="dark">` with background #0f1115
- Client portal uses light mode with background #F8F7F4
- Login page uses animated HTML5 canvas (no image file) for ripple background
- Tailwind CDN loaded in every HTML file with shared tailwind.config
- app.css handles ONLY: functional JS-driven classes (.hidden, .modal--open, .toast, .lang-btn),
  status badge colours, and all dynamically-generated HTML component styles
- JS files are NOT touched — only HTML and CSS change
- Custom CSS variables (--bg, --surface, --text-1, etc.) flip between dark/light via html.dark selector
- All buttons and inputs are pill-shaped (border-radius: 9999px)
- Glassmorphism only on login card
- Material Symbols used for icons throughout admin pages
- client.html uses fixed left sidebar (w-72) + ml-72 main content, two-column grid inside
- portal.html: lang-btn / lang-btn--active classes defined in app.css, toggled by portal.js
