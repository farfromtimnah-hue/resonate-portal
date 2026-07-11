-- ============================================================
-- Zoho Invoice integration — additive migration (Phase 2)
-- Single-row connection table holding the OAuth refresh token
-- and a cached access token. Never touches existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS zoho_connection (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  oauth_state             TEXT,             -- CSRF state for in-flight authorization
  refresh_token           TEXT,             -- permanent token from Zoho (null = not connected)
  access_token            TEXT,             -- cached access token (~3600s lifetime)
  access_token_expires_at INTEGER,          -- epoch ms; refresh only after expiry
  organization_id         TEXT,             -- required on every Zoho Invoice API call
  api_domain              TEXT,             -- e.g. https://www.zohoapis.com
  accounts_server         TEXT,             -- e.g. https://accounts.zoho.com
  connected_at            TEXT,
  updated_at              TEXT
);

INSERT OR IGNORE INTO zoho_connection (id) VALUES (1);
