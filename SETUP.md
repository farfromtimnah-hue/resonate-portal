# Resonate Business Systems — Client Portal
## Complete Setup Guide

This guide walks you through every step in order. Each step tells you exactly where to click and what to paste. No developer experience required — just follow the steps and ask Claude if you get stuck.

---

## What you're setting up

| Service | What it does |
|---|---|
| **GitHub** | Stores your code and hosts the frontend website |
| **Firebase Authentication** | Handles login — admin and client accounts |
| **Cloudflare Workers** | Your secure backend API between the website and the database |
| **Cloudflare D1** | The database that stores all your client data |

---

## STEP 1 — Create your GitHub repository

1. Go to [github.com](https://github.com) and sign in (or create a free account).
2. Click **New repository** (the green button on the left or top-right +).
3. Name it: `resonate-portal`
4. Set it to **Public** (required for free GitHub Pages) or **Private** if you have a paid plan.
5. Leave everything else unchecked. Click **Create repository**.
6. On your Mac, open Terminal and run:

```bash
cd ~/resonate-portal        # this is where the project files are
git init
git add .
git commit -m "Initial build"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/resonate-portal.git
git push -u origin main
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

---

## STEP 2 — Enable GitHub Pages

1. In your GitHub repository, click **Settings** (tab at the top).
2. In the left sidebar, click **Pages**.
3. Under **Source**, select **GitHub Actions**.
4. That's it. GitHub will deploy automatically every time you push to main.

Your site URL will be: `https://YOUR_GITHUB_USERNAME.github.io/resonate-portal/`

> **Note:** After your first push, GitHub Pages may take 1–2 minutes to build. Check the **Actions** tab to see progress.

---

## STEP 3 — Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com).
2. Click **Add project**.
3. Name it: `resonate-portal` (or anything you like).
4. Disable Google Analytics (not needed). Click **Create project**.

### Enable Email/Password authentication

5. In the left sidebar, click **Authentication**.
6. Click **Get started**.
7. Click on the **Sign-in method** tab.
8. Click **Email/Password**.
9. Toggle the **first switch** to enabled. Leave "Email link" disabled.
10. Click **Save**.

### Get your Firebase config keys

11. In the left sidebar, click the **gear icon** next to "Project Overview" → **Project settings**.
12. Scroll down to **Your apps**.
13. Click the **`</>`** (Web) icon to add a web app.
14. Give it a nickname: `resonate-portal-web`. Click **Register app**.
15. You'll see a block of code like this — **copy all of it**:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "resonate-portal-xyz.firebaseapp.com",
  projectId: "resonate-portal-xyz",
  storageBucket: "resonate-portal-xyz.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

16. Open the file `js/config.js` in your project and **replace** the placeholder values with your real values.

### Create the admin user in Firebase

17. In the Firebase Console, go to **Authentication → Users** tab.
18. Click **Add user**.
19. Enter your email address and create a strong password.
20. Click **Add user**. Note the **User UID** shown in the table — you'll need this in Step 6.

---

## STEP 4 — Set up Cloudflare D1 (the database)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign in (or create a free account).
2. In the left sidebar, click **Workers & Pages**.
3. Click **D1 SQL Database** in the submenu (or search for D1).
4. Click **Create database**.
5. Name it: `resonate-portal-db`
6. Click **Create**.
7. You'll see your database listed with a **Database ID** (looks like `abc12345-...`). **Copy that ID**.

### Apply the schema

8. Click on your new database.
9. Click the **Console** tab.
10. Open the file `schema/schema.sql` from your project.
11. Copy the **entire contents** of that file.
12. Paste it into the D1 Console input and click **Execute**.
13. You should see "Success" messages for each table created.

---

## STEP 5 — Create and deploy the Cloudflare Worker

### Install Wrangler (Cloudflare's CLI tool)

Open Terminal and run:

```bash
npm install -g wrangler
```

If you don't have Node.js installed, first download it from [nodejs.org](https://nodejs.org) (LTS version).

### Log in to Cloudflare

```bash
wrangler login
```

A browser window will open — approve access.

### Update wrangler.toml

Open `worker/wrangler.toml` and fill in your values:

```toml
database_id  = "YOUR_D1_DATABASE_ID"        # paste the ID from Step 4
FIREBASE_PROJECT_ID = "your-firebase-project-id"  # e.g. "resonate-portal-xyz"
CORS_ORIGIN = "https://YOUR_GITHUB_USERNAME.github.io"  # your GitHub Pages URL
```

### Deploy the Worker

```bash
cd ~/resonate-portal/worker
wrangler deploy
```

After it completes, you'll see output like:

```
Published resonate-portal-api (0.05 sec)
  https://resonate-portal-api.YOUR_SUBDOMAIN.workers.dev
```

**Copy that URL** — it's your API base URL.

---

## STEP 6 — Connect frontend to the Worker

1. Open `js/config.js` in your project.
2. Set `API_BASE` to your Worker URL from Step 5:

```javascript
export const API_BASE = "https://resonate-portal-api.your-subdomain.workers.dev";
```

---

## STEP 7 — Register the admin user in the database

The Worker requires every user to be registered in D1. After you've set up everything above, you need to add your admin record.

Go to your **Cloudflare D1 console** for `resonate-portal-db` and run this SQL — replace the values with yours:

```sql
INSERT INTO users (firebase_uid, email, role, language_preference)
VALUES (
  'YOUR_FIREBASE_ADMIN_UID',    -- from Firebase Console > Authentication > Users
  'your@email.com',
  'admin',
  'en'
);
```

You can also do this via Wrangler:

```bash
cd ~/resonate-portal/worker
wrangler d1 execute resonate-portal-db --command="INSERT INTO users (firebase_uid, email, role, language_preference) VALUES ('YOUR_UID', 'your@email.com', 'admin', 'en');"
```

---

## STEP 8 — Push your changes and deploy

```bash
cd ~/resonate-portal
git add .
git commit -m "Add Firebase config and Worker URL"
git push
```

GitHub Actions will automatically deploy to GitHub Pages. Check the **Actions** tab in your GitHub repo to watch it build.

---

## STEP 9 — Test everything

Open your site at `https://YOUR_GITHUB_USERNAME.github.io/resonate-portal/`

**Test checklist:**

- [ ] Admin login with your email/password works
- [ ] Admin is redirected to `/dashboard.html`
- [ ] "New Client" button opens the create modal
- [ ] Create a test client → appears on dashboard
- [ ] Click client card → opens full detail page
- [ ] Add a project with English + Portuguese descriptions
- [ ] Change project status — status history records it
- [ ] Mark all projects "Completed" — archive banner appears
- [ ] Archive the client — moves to Archive tab
- [ ] Restore the client from Archive

**Test client login:**
- Create a client in the app first (with a phone/email)
- In Firebase Console → Authentication → Add user with their email
- In the client's detail page → Portal Access → Add Portal Access → paste Firebase UID + email
- Open a private/incognito window, go to your site, log in as the client
- Should see `/portal.html` with only their data
- Test language toggle (EN / PT)
- Test sending a message — should appear in admin view

---

## STEP 10 — Adding clients and setting up their portal login

**To add a new client:**
1. Log in as admin.
2. Click **New Client** on the dashboard.
3. Fill in their details. Save.
4. Open the client's detail page.

**To give a client portal access:**
1. Go to [Firebase Console](https://console.firebase.google.com) → Authentication → Users → **Add user**.
2. Enter the client's email and a temporary password.
3. Copy the **User UID** shown in the users table.
4. In the client's detail page → **Portal Access** section → **Add Portal Access**.
5. Paste the Firebase UID and email. Save.
6. Share the portal URL and temporary password with the client: `https://YOUR_GITHUB_USERNAME.github.io/resonate-portal/`

---

## Where your config values live

| Value | Where to find it | Where to paste it |
|---|---|---|
| Firebase `apiKey`, `projectId`, etc. | Firebase Console → Project Settings → Your Apps | `js/config.js` |
| Firebase Admin UID | Firebase Console → Authentication → Users | D1 INSERT query (Step 7) |
| Firebase Project ID | Firebase Console → Project Settings | `worker/wrangler.toml` |
| D1 Database ID | Cloudflare Dashboard → D1 → your database | `worker/wrangler.toml` |
| Worker URL | Output of `wrangler deploy` | `js/config.js` |

---

## Recommended folder structure (for reference)

```
resonate-portal/
├── index.html          Login page
├── dashboard.html      Admin: active client cards
├── client.html         Admin: full client detail + edit
├── archive.html        Admin: archived clients
├── portal.html         Client: their portal
├── css/
│   └── app.css         All styles
├── js/
│   ├── config.js       ← YOU FILL THIS IN (Firebase + Worker URL)
│   ├── auth.js         Firebase auth helpers
│   ├── api.js          API request functions
│   ├── t.js            English/Portuguese translations
│   ├── utils.js        Shared utilities
│   ├── dashboard.js    Admin dashboard logic
│   ├── client-page.js  Client detail + all edit logic
│   ├── archive.js      Archive page logic
│   └── portal.js       Client portal logic
├── worker/
│   ├── src/index.js    Cloudflare Worker (API + auth)
│   └── wrangler.toml   ← YOU FILL THIS IN (D1 ID + Firebase Project ID)
├── schema/
│   └── schema.sql      D1 database schema
├── .github/workflows/
│   └── pages.yml       Auto-deploy to GitHub Pages
└── SETUP.md            This file
```

---

## Is there a better architecture?

The GitHub Pages + Firebase Auth + Cloudflare Workers + D1 stack you chose is solid and practical. The one trade-off worth knowing:

**GitHub Pages serves files statically** — that means every HTML page is a real file, and routing uses query params (`?id=123`) rather than clean paths. This works fine and is easy to maintain.

A minor upgrade, if you ever want it, is deploying the frontend to **Cloudflare Pages** (free, same Cloudflare account). It gives you: faster deploys, preview URLs for every branch, and the same Workers/D1 proximity. The code would not change at all — just a different deploy target. But GitHub Pages works well and keeps things simple now.

---

## Getting help

If something isn't working, share the error message with Claude and say "I'm setting up the Resonate Portal, here's the error I'm seeing." The structure is designed to be plain and easy to explain, so Claude can help you fix any step.
