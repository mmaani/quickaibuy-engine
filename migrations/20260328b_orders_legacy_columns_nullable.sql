-- Allow canonical-only orders inserts without requiring legacy identifiers.

ALTER TABLE orders
  ALTER COLUMN marketplace_key DROP NOT NULL,
  ALTER COLUMN order_id DROP NOT NULL;
