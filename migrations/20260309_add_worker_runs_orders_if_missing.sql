CREATE TABLE IF NOT EXISTS worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker text NOT NULL,
  job_name text NOT NULL,
  job_id text NOT NULL,
  status text NOT NULL,
  duration_ms integer,
  ok boolean NOT NULL DEFAULT false,
  error text,
  stats jsonb,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp
);

CREATE INDEX IF NOT EXISTS worker_runs_started_idx ON worker_runs (started_at);
CREATE INDEX IF NOT EXISTS worker_runs_status_idx ON worker_runs (status);
CREATE INDEX IF NOT EXISTS worker_runs_job_idx ON worker_runs (job_name, job_id);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid,
  marketplace_key text NOT NULL,
  order_id text NOT NULL,
  status text NOT NULL DEFAULT 'NEW',
  quantity integer NOT NULL DEFAULT 1,
  total_amount numeric(12,2),
  currency text DEFAULT 'USD',
  raw_payload jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_marketplace_idx ON orders (marketplace_key);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE UNIQUE INDEX IF NOT EXISTS orders_unique_marketplace_order ON orders (marketplace_key, order_id);
