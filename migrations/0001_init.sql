-- Multi-tenant core: every lead and quote belongs to a company.
CREATE TABLE companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  notify_email TEXT,
  settings     TEXT NOT NULL DEFAULT '{}',   -- JSON: price rules, service area, etc.
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  zip        TEXT,
  status     TEXT NOT NULL DEFAULT 'new',     -- new | contacted | won | lost
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_company ON leads(company_id, created_at);

CREATE TABLE quotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  job_type    TEXT NOT NULL,
  sqft        INTEGER,
  details     TEXT,
  low_cents   INTEGER NOT NULL,
  high_cents  INTEGER NOT NULL,
  provider    TEXT NOT NULL,                  -- gemini | openai | anthropic | demo
  summary     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quotes_company ON quotes(company_id, created_at);

-- First client: DFW Painters.
INSERT INTO companies (slug, name) VALUES ('dfw-painters', 'DFW Painters');
