-- Plans and AI usage metering (per company, per month or day).
ALTER TABLE companies ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';   -- free | starter | basic | pro

CREATE TABLE usage_counters (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  feature    TEXT NOT NULL,       -- e.g. ai_quote, smart_select, hd_render, or "<feature>:missed", "<feature>:v:<visitor>"
  period     TEXT NOT NULL,       -- YYYY-MM for monthly counters, YYYY-MM-DD for daily ones
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, feature, period)
);

-- The demo site runs on the full Basic plan.
UPDATE companies SET plan = 'basic' WHERE slug = 'dfw-painters';
