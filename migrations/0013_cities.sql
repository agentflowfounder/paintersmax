-- City data shared by every client (one row per city, not per client) and each client's city landing pages.
CREATE TABLE cities (
  key TEXT PRIMARY KEY,            -- state-slug, for example tx-plano
  name TEXT NOT NULL,
  state TEXT NOT NULL,             -- two letters
  lat REAL,
  lng REAL,
  state_fips TEXT,
  place_fips TEXT,
  county_fips TEXT,
  zip TEXT,
  facts TEXT,                      -- JSON from Census: population, housing, business counts
  facts_at TEXT,                   -- refreshed about every 12 months
  construction TEXT,               -- JSON: new residential permits
  construction_at TEXT,            -- refreshed about every 6 months
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cities_facts_at ON cities(facts_at);
CREATE TABLE city_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  city_key TEXT NOT NULL,
  slug TEXT NOT NULL,              -- the address part, for example plano-tx
  data TEXT NOT NULL DEFAULT '{}', -- the client's edits: headline, intro, about, gallery, services
  published INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, city_key),
  UNIQUE (company_id, slug)
);
