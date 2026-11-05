-- Leads can also come from a client's own website form (no quote attached).
ALTER TABLE leads ADD COLUMN source TEXT;
ALTER TABLE leads ADD COLUMN notes TEXT;
