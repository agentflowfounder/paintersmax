-- Vendors and their price lists (Rogelio said "Run it", 2026-11-24).
-- A painter keeps accounts with paint stores (Sherwin-Williams Pro, Home Depot Pro, Lowe's Pro, Benjamin Moore, PPG, others).
-- Each vendor has a price list: the painter's own negotiated prices, or a customer's (owner = 'customer').
-- Only the last 4 characters of a store account number are kept. Never bank, routing or card numbers.
CREATE TABLE vendors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other',      -- sherwin_williams | home_depot | lowes | benjamin_moore | ppg | other
  owner         TEXT NOT NULL DEFAULT 'mine',       -- mine | customer
  customer_name TEXT NOT NULL DEFAULT '',           -- when owner = customer
  account_last4 TEXT NOT NULL DEFAULT '',
  rep_name      TEXT NOT NULL DEFAULT '',
  rep_phone     TEXT NOT NULL DEFAULT '',
  rep_email     TEXT NOT NULL DEFAULT '',
  discount_pct  REAL NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vendors_company ON vendors(company_id, owner);

CREATE TABLE vendor_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
  product      TEXT NOT NULL,
  size         TEXT NOT NULL DEFAULT '',             -- gallon, 5 gallon, quart, each
  sku          TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL,
  effective_on TEXT NOT NULL DEFAULT '',             -- YYYY-MM-DD from the price sheet, when shown
  source       TEXT NOT NULL DEFAULT 'manual',       -- manual | sheet
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vprices_vendor ON vendor_prices(vendor_id, product);
CREATE INDEX idx_vprices_company ON vendor_prices(company_id, product);
