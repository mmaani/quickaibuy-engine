UPDATE matches
SET supplier_key = lower(supplier_key)
WHERE supplier_key <> lower(supplier_key);

UPDATE profitable_candidates
SET supplier_key = lower(supplier_key)
WHERE supplier_key <> lower(supplier_key);

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
