-- ============================================================
-- Client materials — files and short typed answers a client sends us
-- during onboarding, before and after a contract.
--
-- WHY THIS IS NOT clients.logo_url:
--   logo_url is a single column, so every upload overwrites the last one. A
--   materials page collects several distinct things (seal, assessment wheel,
--   example replies, a result page, the application form) and several files
--   can belong to ONE slot — she may send ten screenshots of outfit replies.
--   So: one row per uploaded file, keyed by (client_id, slot).
--
--   The seal is the exception that ALSO writes clients.logo_url, because the
--   client profile renders a logo from that column and the empty placeholder
--   there is what the seal is meant to fill.
--
-- SLOTS are open text rather than a CHECK constraint: the set of things we
-- ask a client for changes per engagement, and a migration to add "send us X"
-- would be silly. The page defines the vocabulary.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_materials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  slot          TEXT    NOT NULL,           -- 'seal' | 'wheel' | 'outfits' | ...
  kind          TEXT    NOT NULL DEFAULT 'file',  -- 'file' | 'note'

  -- For kind='file'
  r2_key        TEXT,                       -- object key in the bucket
  url           TEXT,                       -- public URL as stored
  filename      TEXT,                       -- original name, for recognising it later
  content_type  TEXT,
  size_bytes    INTEGER,

  -- For kind='note' (a typed answer, e.g. the extraction app's name or link)
  value         TEXT,

  -- Who put it there. A client upload records the username; an admin upload
  -- records the admin email. Never rendered on a client-facing screen.
  uploaded_by   TEXT,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_materials_client ON client_materials (client_id);
CREATE INDEX IF NOT EXISTS idx_client_materials_slot   ON client_materials (client_id, slot);

-- A typed answer is a single value per slot, not a history: re-typing the app
-- name should replace it, not append. Files deliberately have no such
-- constraint — many files per slot is the normal case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_materials_note_unique
  ON client_materials (client_id, slot) WHERE kind = 'note';
