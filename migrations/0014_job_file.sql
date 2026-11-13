-- Job File: files (photos, receipts, documents, W-9s), AI photo findings, expenses, mileage, workers and time sheets,
-- work orders and change orders, and the lessons-learned library. Every row belongs to one company.

CREATE TABLE job_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  job_id      INTEGER,                       -- null for files that belong to a worker or the company
  worker_id   INTEGER,
  kind        TEXT NOT NULL,                 -- photo | receipt | document | worker_photo | w9
  r2_key      TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT 'painter', -- painter | customer
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_job_files_job ON job_files(company_id, job_id, id);
CREATE INDEX idx_job_files_worker ON job_files(company_id, worker_id);

CREATE TABLE job_photo_findings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  job_id      INTEGER NOT NULL,
  file_id     INTEGER NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',    -- the AI draft: issues, how to fix, rough cost, rough charge
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | approved | discarded
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE INDEX idx_findings_job ON job_photo_findings(company_id, job_id);

CREATE TABLE expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  job_id       INTEGER,                      -- null = general overhead
  spent_on     TEXT NOT NULL,                -- YYYY-MM-DD
  vendor       TEXT,
  amount_cents INTEGER NOT NULL,
  category     TEXT NOT NULL,
  note         TEXT,
  file_id      INTEGER,                      -- receipt photo
  source       TEXT NOT NULL DEFAULT 'manual', -- manual | receipt | import
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_company ON expenses(company_id, spent_on);
CREATE INDEX idx_expenses_job ON expenses(company_id, job_id);

CREATE TABLE mileage_trips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  job_id     INTEGER,
  trip_on    TEXT NOT NULL,
  miles      REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mileage_company ON mileage_trips(company_id, trip_on);

CREATE TABLE workers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'employee', -- employee | contractor
  position      TEXT,
  pay_cents     INTEGER NOT NULL DEFAULT 0,       -- per pay_unit
  pay_unit      TEXT NOT NULL DEFAULT 'hour',     -- hour | day | job
  started_on    TEXT,
  phone         TEXT,
  email         TEXT,
  notes         TEXT,
  w9_file_id    INTEGER,                          -- W-9 file only; we never store tax ID numbers
  photo_file_id INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workers_company ON workers(company_id, active);

CREATE TABLE time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  worker_id  INTEGER NOT NULL,
  job_id     INTEGER,
  work_date  TEXT NOT NULL,                  -- YYYY-MM-DD
  clock_in   TEXT,                           -- HH:MM
  clock_out  TEXT,
  minutes    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_time_worker ON time_entries(company_id, worker_id, work_date);
CREATE INDEX idx_time_job ON time_entries(company_id, job_id);

CREATE TABLE worker_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  worker_id    INTEGER NOT NULL,
  job_id       INTEGER,
  paid_on      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wpay_worker ON worker_payments(company_id, worker_id, paid_on);

CREATE TABLE work_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  job_id     INTEGER NOT NULL,
  number     INTEGER NOT NULL,               -- per company: WO-1, WO-2 ...
  kind       TEXT NOT NULL DEFAULT 'work_order', -- work_order | change_order
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '{}',     -- scope, reason, price (cents), days added, photos
  status     TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | approved | declined
  token_hash TEXT,
  sent_at    TEXT,
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wo_job ON work_orders(company_id, job_id);
CREATE UNIQUE INDEX idx_wo_token ON work_orders(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE lessons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  job_id     INTEGER,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lessons_company ON lessons(company_id, id);
