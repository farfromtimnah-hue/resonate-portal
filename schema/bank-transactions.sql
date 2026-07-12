-- ============================================================
-- Bank reconciliation — additive migration (Books Phase 9)
-- Bank-statement rows imported from CSV uploads (date,
-- description, amount). Matching links a row to a cached
-- invoice in client_invoices; Exclude hides noise rows.
-- Live bank-feed ingestion is a separate manual hookup later —
-- this table is the destination either way.
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_date           TEXT,              -- yyyy-mm-dd
  description        TEXT,
  amount             REAL,
  status             TEXT NOT NULL DEFAULT 'unmatched',  -- unmatched | matched | excluded
  matched_invoice_id INTEGER,           -- client_invoices.id when matched
  source             TEXT DEFAULT 'csv',
  created_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (matched_invoice_id) REFERENCES client_invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
