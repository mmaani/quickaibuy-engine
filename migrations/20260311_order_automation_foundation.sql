-- Order automation foundation (eBay-first, marketplace-reusable)
-- Safe/additive migration: evolve existing orders table and add child entities.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS marketplace text,
  ADD COLUMN IF NOT EXISTS marketplace_order_id text,
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS buyer_country text,
  ADD COLUMN IF NOT EXISTS total_price numeric(12,2);

-- Backfill from legacy columns when present.
UPDATE orders
SET
  marketplace = COALESCE(NULLIF(BTRIM(marketplace), ''), marketplace_key),
  marketplace_order_id = COALESCE(NULLIF(BTRIM(marketplace_order_id), ''), order_id),
  total_price = COALESCE(total_price, total_amount),
  currency = COALESCE(NULLIF(BTRIM(currency), ''), 'USD')
WHERE
  marketplace IS NULL
  OR marketplace_order_id IS NULL
  OR total_price IS NULL
  OR currency IS NULL
  OR BTRIM(currency) = '';

ALTER TABLE orders
  ALTER COLUMN marketplace SET NOT NULL,
  ALTER COLUMN marketplace_order_id SET NOT NULL,
  ALTER COLUMN currency SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_marketplace_marketplace_order_unique
  ON orders (marketplace, marketplace_order_id);

CREATE INDEX IF NOT EXISTS orders_marketplace_marketplace_order_idx
  ON orders (marketplace, marketplace_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  supplier_key text NOT NULL,
  supplier_product_id text NOT NULL,
  quantity integer NOT NULL,
  item_price numeric(12,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx
  ON order_items (order_id);

CREATE INDEX IF NOT EXISTS order_items_listing_id_idx
  ON order_items (listing_id);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_ts timestamp NOT NULL DEFAULT now(),
  details jsonb
);

CREATE INDEX IF NOT EXISTS order_events_order_id_idx
  ON order_events (order_id);

CREATE INDEX IF NOT EXISTS order_events_event_type_idx
  ON order_events (event_type);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_key text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  supplier_order_ref text,
  purchase_status text NOT NULL,
  tracking_number text,
  tracking_status text NOT NULL DEFAULT 'NOT_AVAILABLE',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_orders_order_id_idx
  ON supplier_orders (order_id);

CREATE INDEX IF NOT EXISTS supplier_orders_purchase_status_idx
  ON supplier_orders (purchase_status);

CREATE INDEX IF NOT EXISTS supplier_orders_tracking_status_idx
  ON supplier_orders (tracking_status);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_orders_order_supplier_attempt_unique
  ON supplier_orders (order_id, supplier_key, attempt_no);
