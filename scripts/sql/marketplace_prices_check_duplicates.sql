SELECT
  marketplace_key,
  marketplace_listing_id,
  product_raw_id,
  COUNT(*) AS dup_count,
  MAX(snapshot_ts) AS newest_snapshot_ts
FROM marketplace_prices
GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, newest_snapshot_ts DESC;
