CREATE UNIQUE INDEX IF NOT EXISTS marketplace_prices_unique_listing_per_product
ON marketplace_prices (marketplace_key, marketplace_listing_id, product_raw_id);
