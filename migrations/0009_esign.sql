-- Electronic signature requests. The snapshot is the exact page the customer saw; doc_hash is its SHA-256.
CREATE TABLE signature_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  document_id   INTEGER NOT NULL REFERENCES documents(id),
  kind          TEXT NOT NULL,                       -- estimate | contract
  language      TEXT NOT NULL DEFAULT 'en',
  title         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  snapshot      TEXT NOT NULL,
  doc_hash      TEXT NOT NULL,
  signer_name   TEXT NOT NULL,
  signer_email  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending | signed | void
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  viewed_at     TEXT,
  signed_at     TEXT,
  signed_name   TEXT,
  signature_png TEXT,
  signer_ip     TEXT,
  signer_agent  TEXT
);
CREATE INDEX idx_sigreq_job ON signature_requests(company_id, job_id);
