BEGIN;

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_key text NOT NULL,
  supplier_product_id text NOT NULL,
  marketplace_key text NOT NULL,
  marketplace_listing_id text NOT NULL,
  match_type text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  first_seen_ts timestamp without time zone NOT NULL DEFAULT NOW(),
  last_seen_ts timestamp without time zone NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_matches_pair
ON matches (
  supplier_key,
  supplier_product_id,
  marketplace_key,
  marketplace_listing_id
);

CREATE INDEX IF NOT EXISTS idx_matches_status
ON matches (status);

CREATE INDEX IF NOT EXISTS idx_matches_confidence
ON matches (confidence DESC);

COMMIT;
