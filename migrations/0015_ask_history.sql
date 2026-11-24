-- Ask history: every Ask conversation is kept so the painter can find it, star the best answers, save one to a job, and download it.
CREATE TABLE ask_conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  user_id     INTEGER,
  job_id      INTEGER,                       -- the job the chat was opened on, or null for a general chat
  title       TEXT NOT NULL DEFAULT '',
  topic       TEXT NOT NULL DEFAULT 'general', -- pricing | products | customers | business | platform | general
  starred     INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_askc_company ON ask_conversations(company_id, archived, updated_at);

CREATE TABLE ask_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ask_conversations(id),
  company_id      INTEGER NOT NULL,
  role            TEXT NOT NULL,             -- user | assistant
  content         TEXT NOT NULL,
  starred         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_askm_conv ON ask_messages(conversation_id, id);
CREATE INDEX idx_askm_saved ON ask_messages(company_id, starred);
