-- Stripe billing: remember which Stripe customer and subscription belong to each client,
-- and which Stripe events were already handled (Stripe can send the same event more than once).
ALTER TABLE companies ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE companies ADD COLUMN stripe_subscription_id TEXT;
CREATE TABLE stripe_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
