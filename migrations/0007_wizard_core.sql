-- Wizard core: customers, properties, jobs, business profile, rate cards, documents and a job timeline.
-- Everything belongs to a company (one painter). Nothing here is shared between companies.

CREATE TABLE customers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES companies(id),
  name                  TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  kind                  TEXT NOT NULL DEFAULT 'person',     -- person | company
  tags                  TEXT NOT NULL DEFAULT '',            -- comma list: repeat, vip, slow_pay, problem ...
  status                TEXT NOT NULL DEFAULT 'active',      -- active | archived
  notes                 TEXT,                                -- private to the painter
  referred_by           INTEGER REFERENCES customers(id),
  referral_code         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_company ON customers(company_id, name);
CREATE INDEX idx_customers_email ON customers(company_id, email);

-- A customer can own many properties (a flipper, a landlord, a property manager).
CREATE TABLE properties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label       TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  kind        TEXT NOT NULL DEFAULT 'residential',           -- residential | commercial
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_properties_customer ON properties(customer_id);

-- One job per piece of work. "data" holds the details that grow as the wizard moves forward (scope, measurements, price lines).
CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  property_id INTEGER REFERENCES properties(id),
  lead_id     INTEGER REFERENCES leads(id),
  title       TEXT NOT NULL,
  trade       TEXT NOT NULL DEFAULT 'interior',              -- interior | exterior | commercial | power_washing | drywall | cabinets | fencing | new_construction ...
  stage       TEXT NOT NULL DEFAULT 'lead',                  -- lead | bid | contract | scheduled | in_progress | punch | invoiced | closed | lost
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_company ON jobs(company_id, stage, updated_at);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);

-- Everything that happens on a job (notes, changes, problems solved), newest last.
CREATE TABLE job_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  kind       TEXT NOT NULL,                                   -- note | stage | photo_brief | chat | change_order | issue
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_job_events_job ON job_events(job_id, id);

-- The painter's business profile, saved once and reused on every job. "data" is JSON (contact, license, insurance summary, labor, warranty, branding, language).
CREATE TABLE company_profiles (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id),
  data       TEXT NOT NULL DEFAULT '{}',
  setup_step TEXT NOT NULL DEFAULT 'start',                   -- where onboarding left off
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One rate card per trade. "method" says how the painter prices it; "data" holds the numbers.
CREATE TABLE rate_cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  trade      TEXT NOT NULL,                                   -- interior | exterior | commercial | power_washing | new_construction ...
  audience   TEXT NOT NULL DEFAULT 'retail',                  -- retail | builder
  method     TEXT NOT NULL,                                   -- room_size | sqft_floor | sqft_wall | items | line_items | lump_sum
  data       TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, trade, audience)
);

-- Generated documents (estimate, contract, material list, schedule, instructions, punch list, invoice, warranty).
CREATE TABLE documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  kind       TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'en',                      -- en | es
  status     TEXT NOT NULL DEFAULT 'draft',                   -- draft | sent | signed
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,                                   -- JSON content, rendered to a printable page
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_job ON documents(job_id, kind);

-- Every lead can be tied to the customer and job created from it.
ALTER TABLE leads ADD COLUMN customer_id INTEGER REFERENCES customers(id);
ALTER TABLE leads ADD COLUMN job_id INTEGER REFERENCES jobs(id);

-- The first clients (companies only; logins are added separately).
INSERT OR IGNORE INTO companies (slug, name, plan) VALUES ('paintersmax-master', 'Master Ideal Template', 'pro');
INSERT OR IGNORE INTO companies (slug, name, plan) VALUES ('tyler-painters', 'Tyler Painters', 'pro');
