CREATE TABLE IF NOT EXISTS seller_account_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_key text NOT NULL,
  feedback_score integer,
  source text,
  raw_payload jsonb,
  fetched_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_account_metrics_marketplace_unique
  ON seller_account_metrics (marketplace_key);
