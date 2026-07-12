-- ============================================================
-- Subscriptions — additive migration (Financial Health rebuild)
-- Manually managed recurring costs shown on financial.html.
-- No auto-detection: every row is entered by hand in the UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',  -- weekly | monthly | quarterly | yearly
  next_due_date TEXT,                             -- yyyy-mm-dd
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
