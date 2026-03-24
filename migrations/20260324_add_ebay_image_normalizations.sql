CREATE TABLE IF NOT EXISTS ebay_image_normalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL,
  source_hash text,
  eps_url text,
  provider text NOT NULL,
  status text NOT NULL,
  failure_code text,
  failure_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ebay_image_normalizations_source_provider_unique
  ON ebay_image_normalizations (source_url, provider);

CREATE INDEX IF NOT EXISTS ebay_image_normalizations_status_idx
  ON ebay_image_normalizations (status, updated_at);
