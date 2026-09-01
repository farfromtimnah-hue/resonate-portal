-- ============================================================
-- Client logins — username/password auth for CLIENT-side users.
--
-- Ported from Apex (farfromtimnah-hue/apex-command-center), which has run
-- this pattern in production with real clients since 2026.
--
-- WHY THIS EXISTS ALONGSIDE FIREBASE:
--   users.firebase_uid is UNIQUE NOT NULL, so every row in `users` requires a
--   Firebase account. Creating one for a client means owning their email
--   address — Firebase treats the address as owned, and an existing Google
--   account on that address returns EMAIL_EXISTS and requires linking by UID,
--   which the client can only produce by signing in first. That is the whole
--   reason adding people to Resonate has been painful.
--
--   Apex sidesteps it: clients get a USERNAME, not an email. Admins stay on
--   Firebase; clients never touch it. No Google account, no email ownership,
--   no verification round trip. Credentials are generated and handed over.
--
-- Resonate difference: clients.id is INTEGER here (TEXT in Apex), so client_id
-- is INTEGER with a real foreign key.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_logins (
  username             TEXT    PRIMARY KEY,
  client_id            INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  password_hash        TEXT    NOT NULL,   -- pbkdf2$<iters>$<b64 salt>$<b64 hash>
  must_change_password INTEGER NOT NULL DEFAULT 1,
  password_changed_at  TEXT,
  last_login_at        TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by           TEXT,
  -- 'client' = the business owner. 'person' = an additional named person at
  -- the same business (Apex calls this 'seller'; Resonate's second person is
  -- a partner or operator, e.g. a spouse who runs a different part of the
  -- business). Both sign in the same way and see the same portal.
  role                 TEXT    NOT NULL DEFAULT 'client',
  person_name          TEXT,
  UNIQUE (client_id, person_name)
);

CREATE INDEX IF NOT EXISTS idx_client_logins_client ON client_logins (client_id);

-- ------------------------------------------------------------
-- Login attempt log — drives the rate limiter.
--
-- Every attempt is recorded BEFORE the password is checked, valid or not.
-- Checking after would mean a brute-force run never trips the counter.
-- Rows are pruned opportunistically on each login attempt.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_login_attempts (
  id         TEXT PRIMARY KEY,
  username   TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cla_username ON client_login_attempts (username, created_at);
CREATE INDEX IF NOT EXISTS idx_cla_ip       ON client_login_attempts (ip, created_at);

-- ------------------------------------------------------------
-- Session tokens.
--
-- Only the SHA-256 hash is stored — a database read never yields a usable
-- token. 30-day expiry, purged lazily on login.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_auth_tokens (
  token_hash TEXT    PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  username   TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,              -- ISO datetime
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_client  ON client_auth_tokens (client_id);
CREATE INDEX IF NOT EXISTS idx_cat_expires ON client_auth_tokens (expires_at);
