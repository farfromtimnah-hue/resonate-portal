-- ============================================================
-- Invoice line items — additive migration (Books Phase 2)
-- Adds a JSON column with each invoice's cached line items
-- (name, description, quantity, rate, amount) and the invoice
-- subtotal. Totals: `amount` (existing column) is Zoho's total;
-- sub_total is cached separately. No tax columns — this business
-- charges no sales tax on any invoice.
-- ============================================================

ALTER TABLE client_invoices ADD COLUMN line_items TEXT;
ALTER TABLE client_invoices ADD COLUMN sub_total REAL;
