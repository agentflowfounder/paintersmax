-- AI project brief (JSON) and number of customer photos on a quote.
ALTER TABLE quotes ADD COLUMN brief TEXT;
ALTER TABLE quotes ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0;
