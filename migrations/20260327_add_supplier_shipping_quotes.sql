CREATE TABLE IF NOT EXISTS supplier_shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_key text NOT NULL,
  supplier_product_id text NOT NULL,
  origin_country text,
  destination_country text NOT NULL,
  destination_region text,
  service_level text NOT NULL DEFAULT 'STANDARD',
  shipping_cost numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  estimated_min_days integer,
  estimated_max_days integer,
  confidence numeric(5,4),
  source_type text NOT NULL DEFAULT 'supplier_snapshot',
  weight_tier text,
  size_tier text,
  last_verified_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_shipping_quotes_unique
  ON supplier_shipping_quotes (supplier_key, supplier_product_id, destination_country, service_level);

CREATE INDEX IF NOT EXISTS supplier_shipping_quotes_lookup_idx
  ON supplier_shipping_quotes (supplier_key, supplier_product_id, destination_country, service_level);

CREATE INDEX IF NOT EXISTS supplier_shipping_quotes_destination_idx
  ON supplier_shipping_quotes (destination_country, last_verified_at);
