-- ============================================================
-- Zoho invoice sync — additive migration (Phase 3)
-- Local cache of synced Zoho invoices per client. Rows are
-- archived (is_archived), never hard-deleted.
-- NOTE: run separately once (tolerates duplicate-column error):
--   ALTER TABLE clients ADD COLUMN zoho_customer_id TEXT;
-- ============================================================

CREATE TABLE IF NOT EXISTS client_invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL,
  zoho_invoice_id  TEXT    NOT NULL UNIQUE,
  invoice_number   TEXT,
  status           TEXT,             -- raw Zoho status: draft/sent/viewed/unpaid/partially_paid/overdue/paid/void
  amount           REAL,
  balance          REAL,
  currency_code    TEXT,
  due_date         TEXT,             -- yyyy-mm-dd from Zoho
  payment_url      TEXT,             -- Zoho hosted invoice/payment page (invoice_url)
  last_synced_at   TEXT,
  is_archived      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX IF NOT EXISTS idx_client_invoices_client ON client_invoices(client_id);
