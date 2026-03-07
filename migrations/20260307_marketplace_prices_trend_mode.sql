ALTER TABLE marketplace_prices
  ADD COLUMN IF NOT EXISTS product_raw_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_key text,
  ADD COLUMN IF NOT EXISTS supplier_product_id text,
  ADD COLUMN IF NOT EXISTS trend_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS search_query text,
  ADD COLUMN IF NOT EXISTS matched_title text,
  ADD COLUMN IF NOT EXISTS title_similarity_score numeric(6,4),
  ADD COLUMN IF NOT EXISTS keyword_score numeric(6,4),
  ADD COLUMN IF NOT EXISTS final_match_score numeric(6,4);

CREATE INDEX IF NOT EXISTS marketplace_prices_listing_idx
  ON marketplace_prices (marketplace_key, marketplace_listing_id);

CREATE INDEX IF NOT EXISTS marketplace_prices_product_idx
  ON marketplace_prices (product_raw_id);

CREATE INDEX IF NOT EXISTS marketplace_prices_score_idx
  ON marketplace_prices (final_match_score);

CREATE INDEX IF NOT EXISTS marketplace_prices_snapshot_idx
  ON marketplace_prices (snapshot_ts);
