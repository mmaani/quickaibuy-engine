-- Customer intelligence foundation (canonical customers + order linkage)

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,
  customer_external_id text,
  buyer_name text,
  buyer_email_normalized text,
  city text,
  state text,
  country text,
  first_order_at timestamp NOT NULL,
  last_order_at timestamp NOT NULL,
  order_count integer NOT NULL DEFAULT 0,
  total_spent numeric(14,2) NOT NULL DEFAULT 0,
  currency text,
  revenue_policy text NOT NULL DEFAULT 'ORDER_NATIVE_UNNORMALIZED',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_marketplace_idx ON customers (marketplace);
CREATE INDEX IF NOT EXISTS customers_country_city_idx ON customers (country, city);
CREATE UNIQUE INDEX IF NOT EXISTS customers_marketplace_email_unique
  ON customers (marketplace, buyer_email_normalized)
  WHERE buyer_email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_marketplace_external_unique
  ON customers (marketplace, customer_external_id)
  WHERE customer_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  merge_source text NOT NULL,
  identity_confidence text NOT NULL,
  resolution_method text NOT NULL,
  buyer_email_normalized text,
  customer_external_id text,
  buyer_name_snapshot text,
  city_snapshot text,
  state_snapshot text,
  country_snapshot text,
  order_created_at timestamp NOT NULL,
  order_total numeric(12,2),
  order_currency text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_orders_customer_idx ON customer_orders (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_orders_order_unique ON customer_orders (order_id);
CREATE INDEX IF NOT EXISTS customer_orders_marketplace_country_idx
  ON customer_orders (marketplace, country_snapshot);
