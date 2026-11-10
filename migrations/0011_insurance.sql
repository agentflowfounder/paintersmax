-- One insurance policy summary per company. The original file is not kept, only what the AI read from it.
CREATE TABLE insurance_policies (
  company_id  INTEGER PRIMARY KEY REFERENCES companies(id),
  file_name   TEXT NOT NULL,
  summary     TEXT NOT NULL,        -- JSON: carrier, dates, limits, covered, exclusions, job guide, upgrade ideas
  policy_text TEXT NOT NULL DEFAULT '',   -- text read from the document, used to answer questions
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
