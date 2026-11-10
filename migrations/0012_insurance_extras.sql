-- Insurance extras: optional kept copy of the original file, customer-facing proof-of-insurance link, expiry reminders.
ALTER TABLE insurance_policies ADD COLUMN file_key TEXT;                          -- object key in the FILES bucket when the painter chose to keep the original
ALTER TABLE insurance_policies ADD COLUMN file_mime TEXT;
ALTER TABLE insurance_policies ADD COLUMN expires_on TEXT;                        -- YYYY-MM-DD read from the policy, used for reminders
ALTER TABLE insurance_policies ADD COLUMN share_token_hash TEXT;                  -- hash of the customer link token; NULL = sharing off
ALTER TABLE insurance_policies ADD COLUMN share_file INTEGER NOT NULL DEFAULT 0;  -- 1 = the shared page also offers the original file
ALTER TABLE insurance_policies ADD COLUMN reminders_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE insurance_policies ADD COLUMN reminded TEXT;                          -- last reminder stage sent: 30, 7 or 0
CREATE INDEX idx_ins_share ON insurance_policies(share_token_hash);
