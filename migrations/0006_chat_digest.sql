-- Chat follow-ups are emailed once per conversation (after a quiet period) instead of once per message.
ALTER TABLE leads ADD COLUMN notes_updated_at TEXT;   -- last time the chat saved a note (UTC, datetime('now') format)
ALTER TABLE leads ADD COLUMN notes_emailed_at TEXT;   -- last time a chat digest email went out

-- Testing period: the demo site runs on the Pro plan so limits do not get in the way while we find bugs.
UPDATE companies SET plan = 'pro' WHERE slug = 'dfw-painters';
