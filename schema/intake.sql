-- ============================================================
-- Resonate Business Systems — Client Portal
-- AI-Driven Adaptive Intake Interview — D1 tables (additive)
-- Apply:  wrangler d1 execute resonate-portal --file=schema/intake.sql --remote
-- Safe to re-run: uses IF NOT EXISTS only, never drops.
-- (schema/schema.sql is the original full-drop schema; this file
--  is a standalone additive migration so it can be applied to the
--  live database without touching existing client data.)
-- ============================================================

-- ----------------------------------------------------------
-- INTAKE_SESSIONS
-- One row per interview run. language is chosen on Section 0
-- (en / pt only) and everything downstream reads it.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_sessions (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER  NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Which PERSON took this interview. A business often has more than one
  -- person worth interviewing (the owner and whoever runs the back office),
  -- and keying a session on the client alone merged their answers into one
  -- record. Nullable because sessions predating this column cannot always be
  -- attributed to one person, and a guess would be a fabricated attribution.
  -- ON DELETE SET NULL, never CASCADE: removing a portal login must not
  -- destroy an interview that person already completed.
  user_id         INTEGER  REFERENCES users(id) ON DELETE SET NULL,
  language        TEXT     NOT NULL DEFAULT 'en'
                           CHECK(language IN ('en', 'pt')),
  current_section TEXT     NOT NULL DEFAULT 'language'
                           CHECK(current_section IN (
                             'language',      -- Section 0: language selection
                             'preferences',   -- Section 1: four preference questions
                             'tasks',         -- Section 2: task inventory
                             'problems',      -- Section 3: problem inventory
                             'future',        -- Section 4: future / vision
                             'complete'
                           )),
  status          TEXT     NOT NULL DEFAULT 'in_progress'
                           CHECK(status IN ('in_progress', 'completed', 'abandoned')),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME
);

-- ----------------------------------------------------------
-- INTAKE_PREFERENCES
-- The four front-loaded preference answers, one row per session.
-- All four are multiple-choice; stored as enum text values.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_preferences (
  id                         INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id                 INTEGER  NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  format_preference          TEXT     CHECK(format_preference IN
                               ('written', 'spoken', 'visual', 'hands_on')),
  density_preference         TEXT     CHECK(density_preference IN
                               ('short_scannable', 'everything_at_once')),
  data_narrative_preference  TEXT     CHECK(data_narrative_preference IN
                               ('numbers', 'plain_language', 'headline_then_data')),
  control_trust_preference   TEXT     CHECK(control_trust_preference IN
                               ('approve_first', 'flag_exceptions_only', 'depends_on_task')),
  created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id)
);

-- ----------------------------------------------------------
-- INTAKE_ENTRIES
-- One row per task / problem the client describes.
-- The five dimensions are filled in as the interview engine
-- extracts them from answers. solution_jump_note captures a
-- proposed fix/tool the client named instead of their process.
-- followup_count enforces the server-side hard cap (max 2).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_entries (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id          INTEGER  NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  section             TEXT     NOT NULL CHECK(section IN ('task', 'problem')),

  -- Five completeness dimensions
  what                TEXT,
  how                 TEXT,
  why_trigger         TEXT,
  time_cost           TEXT,
  pain_level          TEXT,   -- includes love/hate signal plus any roadblock

  -- Client's proposed-fix text if they jumped to a solution (nullable)
  solution_jump_note  TEXT,

  completeness        TEXT     NOT NULL DEFAULT 'in_progress'
                               CHECK(completeness IN (
                                 'in_progress',
                                 'complete',
                                 'incomplete_needs_review',
                                 'skipped'          -- genuine-uncertainty stop
                               )),
  followup_count      INTEGER  NOT NULL DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- INTAKE_FUTURE_VISION
-- One row per session for Section 4. skipped = client used the
-- upfront click-to-skip gate (no engine calls made at all).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_future_vision (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER  NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  skipped       INTEGER  NOT NULL DEFAULT 0,
  vision_text   TEXT,
  completeness  TEXT     NOT NULL DEFAULT 'in_progress'
                         CHECK(completeness IN (
                           'in_progress',
                           'complete',
                           'incomplete_needs_review',
                           'skipped'
                         )),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id)
);

-- ----------------------------------------------------------
-- INTAKE_MESSAGES
-- Full raw conversation log. Every question shown and every
-- answer submitted is written here immediately, so a dropped
-- connection never loses already-collected data. This is the
-- raw record Nicole reviews alongside the structured entries.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_messages (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER  NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  entry_id          INTEGER  REFERENCES intake_entries(id) ON DELETE SET NULL,
  role              TEXT     NOT NULL CHECK(role IN ('question', 'answer')),
  content           TEXT     NOT NULL,
  target_dimension  TEXT,    -- which dimension the question targeted (nullable)
  section           TEXT,    -- task | problem | future (denormalized for review)
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- INTAKE_TRANSLATIONS
-- Cached English translation of one session, produced on read by the
-- admin results page rather than at interview time: the client never
-- waits on a model call mid-interview, and a translation that turns out
-- wrong stays re-runnable. payload is the JSON translation document.
-- One row per session; a refresh overwrites it in place.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_translations (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER  NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
  payload       TEXT     NOT NULL,
  model         TEXT,
  generated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id)
);

-- ----------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_intake_sessions_client_id  ON intake_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_user_id    ON intake_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_client_user ON intake_sessions(client_id, user_id);
CREATE INDEX IF NOT EXISTS idx_intake_translations_session ON intake_translations(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_prefs_session_id    ON intake_preferences(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_entries_session_id  ON intake_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_future_session_id   ON intake_future_vision(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_messages_session_id ON intake_messages(session_id);
