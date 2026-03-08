WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY marketplace_key, marketplace_listing_id, product_raw_id
      ORDER BY snapshot_ts DESC, id DESC
    ) AS rn
  FROM marketplace_prices
)
DELETE FROM marketplace_prices
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE rn > 1
);
