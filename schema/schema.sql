-- ============================================================
-- Resonate Business Systems — Client Portal
-- Cloudflare D1 Database Schema  (v2 — full schema)
-- Apply:  wrangler d1 execute resonate-portal --file=schema/schema.sql --remote
-- ============================================================

-- Drop in reverse dependency order (safe to re-run on a fresh DB)
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS proposal_line_items;
DROP TABLE IF EXISTS proposals;
DROP TABLE IF EXISTS client_intake_responses;
DROP TABLE IF EXISTS service_library;
DROP TABLE IF EXISTS status_history;
DROP TABLE IF EXISTS client_resource_links;
DROP TABLE IF EXISTS client_private_notes;
DROP TABLE IF EXISTS client_comments;
DROP TABLE IF EXISTS client_projects;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS users;

-- ----------------------------------------------------------
-- USERS
-- Maps Firebase UIDs to roles and client records.
-- admin users have client_id = NULL.
-- ----------------------------------------------------------
CREATE TABLE users (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  firebase_uid        TEXT     UNIQUE NOT NULL,
  email               TEXT     NOT NULL,
  role                TEXT     NOT NULL DEFAULT 'client'
                               CHECK(role IN ('admin', 'client')),
  client_id           INTEGER,
  language_preference TEXT     NOT NULL DEFAULT 'en'
                               CHECK(language_preference IN ('en', 'pt')),
  first_name          TEXT,
  last_name           TEXT,
  -- What this person does in the business ("owner", "back office",
  -- "operations"). Free text: an intake export needs to say whose answers
  -- these are and from what vantage point they saw the work.
  interview_role      TEXT,
  -- Whether THIS PERSON takes an intake interview. clients.intake_enabled
  -- stays the overall on switch for the business; this is the per-person
  -- choice within it, and both must be on. Defaults to 0 so creating a
  -- login never silently enrolls someone in an interview.
  intake_enabled      INTEGER  NOT NULL DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENTS
-- One record per client account.
-- business_display_name = shown in UI; legal_name = entity name.
-- name / business_name kept for backward-compat with existing JS.
-- ----------------------------------------------------------
CREATE TABLE clients (
  id                    INTEGER  PRIMARY KEY AUTOINCREMENT,

  -- Identity (user-spec columns)
  business_display_name TEXT     NOT NULL DEFAULT '',
  legal_name            TEXT,
  logo_url              TEXT,
  brand_color_primary   TEXT,
  brand_color_secondary TEXT,
  intake_complete       INTEGER  NOT NULL DEFAULT 0,
  intake_enabled        INTEGER  NOT NULL DEFAULT 0,
  -- Test client: the ONLY thing that permits admin preview writes.
  -- Defaults to 0 so no real client can ever be written to via preview.
  is_test_client        INTEGER  NOT NULL DEFAULT 0,

  -- Legacy identity fields (referenced by existing frontend JS)
  name                  TEXT     NOT NULL DEFAULT '',   -- contact person name
  business_name         TEXT,                            -- alias/display name

  -- Status
  overall_status        TEXT     NOT NULL DEFAULT 'active',
  language_preference   TEXT     NOT NULL DEFAULT 'en'
                                 CHECK(language_preference IN ('en', 'pt')),
  is_archived           INTEGER  NOT NULL DEFAULT 0,
  archived_at           DATETIME,

  -- Contact
  phone                 TEXT,
  whatsapp              TEXT,
  email                 TEXT,
  website               TEXT,
  address               TEXT,
  contact_notes         TEXT,

  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_PROJECTS
-- Deliverables / sub-cards per client.
-- title kept for backward-compat; title_en / title_pt for bilingual.
-- ----------------------------------------------------------
CREATE TABLE client_projects (
  id                    INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id             INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Bilingual title (user-spec)
  title_en              TEXT     NOT NULL DEFAULT '',
  title_pt              TEXT,

  -- Legacy title field (referenced by existing frontend JS)
  title                 TEXT     NOT NULL DEFAULT '',

  -- Bilingual descriptions
  description_en        TEXT,
  description_pt        TEXT,
  future_features_en    TEXT,
  future_features_pt    TEXT,

  -- Status
  status                TEXT     NOT NULL DEFAULT 'not_started'
                                 CHECK(status IN (
                                   'not_started',
                                   'in_progress',
                                   'waiting_on_client',
                                   'v1_done',
                                   'updates_in_progress',
                                   'completed'
                                 )),

  -- Hours (user-spec)
  hours_before          REAL,
  hours_after           REAL,

  -- Links
  link_type             TEXT     DEFAULT 'live_site',
  urls                  TEXT     NOT NULL DEFAULT '[]',   -- JSON array
  due_date              DATE,

  -- Visibility / ordering
  is_client_visible     INTEGER  NOT NULL DEFAULT 1,
  sort_order            INTEGER  NOT NULL DEFAULT 0,

  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_COMMENTS
-- Messages visible to client and admin.
-- content kept for backward-compat; body_en / body_pt for bilingual.
-- project_id links comment to a specific project (nullable).
-- ----------------------------------------------------------
CREATE TABLE client_comments (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id         INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id        INTEGER  REFERENCES client_projects(id) ON DELETE SET NULL,
  author_role       TEXT     NOT NULL CHECK(author_role IN ('admin', 'client')),
  author_name       TEXT,

  -- Bilingual body (user-spec)
  body_en           TEXT,
  body_pt           TEXT,

  -- Legacy content field (referenced by existing frontend JS)
  content           TEXT     NOT NULL DEFAULT '',

  parent_comment_id INTEGER  REFERENCES client_comments(id),
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_PRIVATE_NOTES
-- Admin-only internal notes.
-- body = user-spec name; content = legacy compat name.
-- ----------------------------------------------------------
CREATE TABLE client_private_notes (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  body        TEXT     NOT NULL DEFAULT '',   -- user-spec
  content     TEXT     NOT NULL DEFAULT '',   -- legacy compat
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_RESOURCE_LINKS
-- Admin-managed links per client (some visible to client).
-- User-spec columns: title_en, title_pt, resource_type, is_global,
--                    related_service_id, language.
-- Legacy: label, link_type, is_client_visible.
-- ----------------------------------------------------------
CREATE TABLE client_resource_links (
  id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id          INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- User-spec columns
  title_en           TEXT,
  title_pt           TEXT,
  resource_type      TEXT     DEFAULT 'link'
                              CHECK(resource_type IN ('video', 'pdf', 'link')),
  is_global          INTEGER  NOT NULL DEFAULT 0,
  related_service_id INTEGER  REFERENCES service_library(id) ON DELETE SET NULL,
  language           TEXT     DEFAULT 'both'
                              CHECK(language IN ('en', 'pt', 'both')),

  -- Legacy columns (referenced by existing frontend JS)
  label              TEXT     NOT NULL DEFAULT '',
  url                TEXT     NOT NULL,
  link_type          TEXT     NOT NULL DEFAULT 'other',
  is_client_visible  INTEGER  NOT NULL DEFAULT 0,

  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- STATUS_HISTORY
-- Audit log for status changes on clients and projects.
-- ----------------------------------------------------------
CREATE TABLE status_history (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  entity_type     TEXT     NOT NULL CHECK(entity_type IN ('client', 'project')),
  client_id       INTEGER  REFERENCES clients(id) ON DELETE CASCADE,
  project_id      INTEGER  REFERENCES client_projects(id) ON DELETE CASCADE,
  old_status      TEXT,
  new_status      TEXT     NOT NULL,
  changed_by      TEXT,   -- Firebase UID of the admin who made the change
  changed_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- CLIENT_INTAKE_RESPONSES
-- One row per intake question per client.
-- ----------------------------------------------------------
CREATE TABLE client_intake_responses (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question_key TEXT     NOT NULL,
  answer_en    TEXT,
  answer_pt    TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id, question_key)
);

-- ----------------------------------------------------------
-- SERVICE_LIBRARY
-- Catalogue of services Resonate offers.
-- tier: tier_1 / tier_2 / tier_3 (names TBD).
-- ----------------------------------------------------------
CREATE TABLE service_library (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  service_name_en     TEXT     NOT NULL,
  service_name_pt     TEXT,
  description_en      TEXT,
  description_pt      TEXT,
  category            TEXT,
  typical_hours_saved REAL,
  base_price          REAL,
  tier                TEXT     DEFAULT 'tier_1'
                               CHECK(tier IN ('tier_1', 'tier_2', 'tier_3')),
  notes               TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- PROPOSALS
-- Quotes / proposals sent to clients.
-- ----------------------------------------------------------
CREATE TABLE proposals (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status      TEXT     NOT NULL DEFAULT 'draft'
                       CHECK(status IN ('draft', 'sent', 'accepted', 'declined')),
  total_price REAL,
  notes_en    TEXT,
  notes_pt    TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- PROPOSAL_LINE_ITEMS
-- Individual service line items within a proposal.
-- ----------------------------------------------------------
CREATE TABLE proposal_line_items (
  id                    INTEGER  PRIMARY KEY AUTOINCREMENT,
  proposal_id           INTEGER  NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_id            INTEGER  REFERENCES service_library(id) ON DELETE SET NULL,
  pain_point_addressed  TEXT,
  hours_before          REAL,
  hours_after           REAL,
  price                 REAL,
  sort_order            INTEGER  NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------
-- REFERRALS
-- Client-to-client referral tracking.
-- ----------------------------------------------------------
CREATE TABLE referrals (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  referring_client_id INTEGER  REFERENCES clients(id) ON DELETE SET NULL,
  referred_name       TEXT,
  referred_email      TEXT,
  referred_business   TEXT,
  status              TEXT     NOT NULL DEFAULT 'pending',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------
CREATE INDEX idx_users_firebase_uid       ON users(firebase_uid);
CREATE INDEX idx_users_client_id          ON users(client_id);
CREATE INDEX idx_clients_is_archived      ON clients(is_archived);
CREATE INDEX idx_clients_updated_at       ON clients(updated_at);
CREATE INDEX idx_projects_client_id       ON client_projects(client_id);
CREATE INDEX idx_projects_status          ON client_projects(status);
CREATE INDEX idx_comments_client_id       ON client_comments(client_id);
CREATE INDEX idx_comments_project_id      ON client_comments(project_id);
CREATE INDEX idx_notes_client_id          ON client_private_notes(client_id);
CREATE INDEX idx_links_client_id          ON client_resource_links(client_id);
CREATE INDEX idx_history_client_id        ON status_history(client_id);
CREATE INDEX idx_intake_client_id         ON client_intake_responses(client_id);
CREATE INDEX idx_proposals_client_id      ON proposals(client_id);
CREATE INDEX idx_line_items_proposal_id   ON proposal_line_items(proposal_id);
CREATE INDEX idx_referrals_referring      ON referrals(referring_client_id);

-- ----------------------------------------------------------
-- SEED DATA — service_library
-- Tier names are TBD; placeholders in place.
-- ----------------------------------------------------------
INSERT INTO service_library (service_name_en, service_name_pt, tier, category, description_en) VALUES
  ('Tier 1 Service (TBD)', 'Serviço Nível 1 (A definir)', 'tier_1', 'operations',  'Placeholder — replace with actual service name and description.'),
  ('Tier 2 Service (TBD)', 'Serviço Nível 2 (A definir)', 'tier_2', 'operations',  'Placeholder — replace with actual service name and description.'),
  ('Tier 3 Service (TBD)', 'Serviço Nível 3 (A definir)', 'tier_3', 'operations',  'Placeholder — replace with actual service name and description.');

-- ----------------------------------------------------------
-- STATUS REFERENCE COMMENT
-- Project statuses (enforced by CHECK constraints above):
--   not_started | in_progress | waiting_on_client |
--   v1_done | updates_in_progress | completed
-- Client overall_status is free-form text (no enum constraint).
-- Proposal statuses: draft | sent | accepted | declined
-- Referral status is free-form text.
-- ----------------------------------------------------------
