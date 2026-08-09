-- ============================================================
-- Test-client flag — additive migration (admin preview-as)
-- Marks a client as a throwaway test account. This is the ONLY
-- thing that permits an admin to WRITE to a client's portal while
-- previewing it; the Worker refuses preview writes for every
-- client whose is_test_client is 0.
--
-- The default of 0 is the safety property: every existing client,
-- and every client created in future, is NOT a test client unless
-- somebody deliberately marks it one.
--
-- NOTE: run separately once (tolerates duplicate-column error):
--   ALTER TABLE clients ADD COLUMN is_test_client INTEGER NOT NULL DEFAULT 0;
-- ============================================================

ALTER TABLE clients ADD COLUMN is_test_client INTEGER NOT NULL DEFAULT 0;
