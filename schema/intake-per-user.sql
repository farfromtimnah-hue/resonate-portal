-- ============================================================
-- Resonate Business Systems — Client Portal
-- Intake interview: an interview belongs to a PERSON, not a company
-- D1 migration (additive)
--
-- Apply LOCAL:  wrangler d1 execute resonate-portal --file=schema/intake-per-user.sql --local
-- Apply REMOTE: wrangler d1 execute resonate-portal --file=schema/intake-per-user.sql --remote
--
-- Safe to re-run: every statement is IF NOT EXISTS, and the two ALTER TABLE
-- statements are the only exception — SQLite has no ADD COLUMN IF NOT EXISTS,
-- so a re-run fails on "duplicate column name". That failure is harmless and
-- means the migration was already applied.
--
-- WHY THIS EXISTS
-- A client is a business, and a business often has more than one person whose
-- work is worth capturing: the owner who runs it, and the spouse or manager who
-- runs the back office. Before this migration intake_sessions keyed only on
-- client_id, so two people at one client sharing a portal login merged their
-- answers into a single session with no way to separate them afterwards.
-- ============================================================

-- ----------------------------------------------------------
-- INTAKE_SESSIONS.USER_ID
-- Which PERSON took this interview. Nullable on purpose: sessions
-- recorded before this migration cannot always be attributed to one
-- person, and a guess there would be a fabricated attribution.
-- ON DELETE SET NULL, never CASCADE: removing someone's portal login
-- must not destroy the interview they already completed. That data is
-- the consultant's working material and outlives the login.
-- ----------------------------------------------------------
ALTER TABLE intake_sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------
-- USERS.INTERVIEW_ROLE
-- Short free-text label for what this person does in the business
-- ("owner", "back office", "operations"). Free text rather than an
-- enum because the vantage point is the point: an export needs to say
-- whose answers these are and from what angle they saw the work.
-- ----------------------------------------------------------
ALTER TABLE users ADD COLUMN interview_role TEXT;

-- ----------------------------------------------------------
-- USERS.INTAKE_ENABLED
-- Whether THIS PERSON takes an interview. The client-level
-- clients.intake_enabled flag remains the overall on switch for the
-- business; this is the per-person choice within it. Both must be on
-- for a person to be offered the interview.
-- Defaults to 0: adding a login never silently enrolls someone.
-- ----------------------------------------------------------
ALTER TABLE users ADD COLUMN intake_enabled INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------
-- INTAKE_TRANSLATIONS
-- Cached English translation of one session, produced on read by the
-- admin results page — never at interview time, so a client never waits
-- on a model call mid-interview and a bad translation stays re-runnable.
-- payload is the JSON translation document keyed by field.
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
CREATE INDEX IF NOT EXISTS idx_intake_sessions_user_id      ON intake_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_client_user  ON intake_sessions(client_id, user_id);
CREATE INDEX IF NOT EXISTS idx_users_client_id              ON users(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_translations_session  ON intake_translations(session_id);

-- ----------------------------------------------------------
-- BACKFILL
-- Attribute existing sessions to the client's portal user where that
-- is unambiguous, and leave them NULL where it is not.
--
-- The "exactly one" subquery guard is deliberate. A client with two
-- logins has no single correct answer, and picking the newest or the
-- lowest id would invent an attribution that reads as fact on the
-- results page. NULL is honest; a guess is not.
-- ----------------------------------------------------------
UPDATE intake_sessions
SET user_id = (
  SELECT u.id FROM users u
  WHERE u.client_id = intake_sessions.client_id AND u.role = 'client'
)
WHERE user_id IS NULL
  AND (
    SELECT COUNT(*) FROM users u
    WHERE u.client_id = intake_sessions.client_id AND u.role = 'client'
  ) = 1;

-- Existing clients that already had intake turned on keep working: the one
-- linked person inherits the client-level flag, so nobody who was mid-interview
-- is locked out by the grain change.
UPDATE users
SET intake_enabled = 1
WHERE role = 'client'
  AND client_id IN (SELECT id FROM clients WHERE intake_enabled = 1)
  AND (
    SELECT COUNT(*) FROM users u2
    WHERE u2.client_id = users.client_id AND u2.role = 'client'
  ) = 1;
