-- 1) Remove duplicate matches, keep newest
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id
      ORDER BY last_seen_ts DESC, first_seen_ts DESC, id DESC
    ) AS rn
  FROM matches
)
DELETE FROM matches
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- 2) Remove duplicate profitable candidates, keep newest
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id
      ORDER BY calc_ts DESC, id DESC
    ) AS rn
  FROM profitable_candidates
)
DELETE FROM profitable_candidates
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- 3) Add unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS matches_unique_supplier_market_listing
  ON matches (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id);

CREATE UNIQUE INDEX IF NOT EXISTS profitable_candidates_unique_supplier_market_listing
  ON profitable_candidates (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id);
