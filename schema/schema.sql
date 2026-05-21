-- ============================================================
-- Resonate Business Systems — Client Portal
-- Cloudflare D1 Database Schema
-- Run this in: Cloudflare Dashboard > D1 > your database > Console
-- Or via: wrangler d1 execute resonate-portal-db --file=schema/schema.sql
-- ============================================================

-- Drop tables if re-running setup (safe to run fresh)
DROP TABLE IF EXISTS status_history;
DROP TABLE IF EXISTS client_resource_links;
DROP TABLE IF EXISTS client_private_notes;
DROP TABLE IF EXISTS client_comments;
DROP TABLE IF EXISTS client_projects;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS users;

-- ----------------------------------------------------------
-- USERS: maps Firebase UIDs to roles and client records
-- ----------------------------------------------------------
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  firebase_uid        TEXT UNIQUE NOT NULL,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('admin', 'client')),
  client_id           INTEGER,                           -- NULL for admin users
  language_preference TEXT NOT NULL DEFAULT 'en' CHECK(language_preference IN ('en', 'pt')),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENTS: one record per client account
-- ----------------------------------------------------------
CREATE TABLE clients (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,                     -- Contact person's name
  business_name       TEXT,                              -- Company/business name if different
  overall_status      TEXT NOT NULL DEFAULT 'active',    -- Free-form admin-controlled label
  language_preference TEXT NOT NULL DEFAULT 'en' CHECK(language_preference IN ('en', 'pt')),
  is_archived         INTEGER NOT NULL DEFAULT 0,        -- 0 = active, 1 = archived
  archived_at         DATETIME,
  -- Contact info
  phone               TEXT,
  whatsapp            TEXT,                              -- Can differ from phone (separate line/app)
  email               TEXT,
  website             TEXT,
  address             TEXT,
  contact_notes       TEXT,                              -- Misc contact info (Telegram, etc.)
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_PROJECTS: sub-cards / deliverables per client
-- ----------------------------------------------------------
CREATE TABLE client_projects (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id             INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  description_en        TEXT,
  description_pt        TEXT,
  future_features_en    TEXT,
  future_features_pt    TEXT,
  status                TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN (
                          'not_started',
                          'in_progress',
                          'waiting_on_client',
                          'v1_done',
                          'updates_in_progress',
                          'completed'
                        )),
  link_type             TEXT DEFAULT 'live_site',        -- Label for the link(s)
  urls                  TEXT NOT NULL DEFAULT '[]',      -- JSON array of URL strings
  due_date              DATE,
  is_client_visible     INTEGER NOT NULL DEFAULT 1,      -- 0 = admin-only, 1 = show to client
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_COMMENTS: threaded messages visible to client
-- ----------------------------------------------------------
CREATE TABLE client_comments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_role       TEXT NOT NULL CHECK(author_role IN ('admin', 'client')),
  author_name       TEXT,
  content           TEXT NOT NULL,
  parent_comment_id INTEGER REFERENCES client_comments(id),
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_PRIVATE_NOTES: admin-only internal notes
-- ----------------------------------------------------------
CREATE TABLE client_private_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_RESOURCE_LINKS: admin-managed links per client
-- Some may be client-visible (e.g. live site), most are admin-only
-- ----------------------------------------------------------
CREATE TABLE client_resource_links (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,                       -- e.g. "GitHub Repo", "Live Site"
  url               TEXT NOT NULL,
  link_type         TEXT NOT NULL DEFAULT 'other',       -- github_repo, github_project, cloudflare,
                                                         -- live_site, staging, test, admin, other
  is_client_visible INTEGER NOT NULL DEFAULT 0,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- STATUS_HISTORY: audit log for status changes
-- ----------------------------------------------------------
CREATE TABLE status_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type     TEXT NOT NULL CHECK(entity_type IN ('client', 'project')),
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES client_projects(id) ON DELETE CASCADE,
  old_status      TEXT,
  new_status      TEXT NOT NULL,
  changed_by_uid  TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------
CREATE INDEX idx_users_firebase_uid        ON users(firebase_uid);
CREATE INDEX idx_users_client_id           ON users(client_id);
CREATE INDEX idx_clients_is_archived       ON clients(is_archived);
CREATE INDEX idx_clients_updated_at        ON clients(updated_at);
CREATE INDEX idx_projects_client_id        ON client_projects(client_id);
CREATE INDEX idx_projects_status           ON client_projects(status);
CREATE INDEX idx_comments_client_id        ON client_comments(client_id);
CREATE INDEX idx_notes_client_id           ON client_private_notes(client_id);
CREATE INDEX idx_links_client_id           ON client_resource_links(client_id);
CREATE INDEX idx_history_client_id         ON status_history(client_id);
