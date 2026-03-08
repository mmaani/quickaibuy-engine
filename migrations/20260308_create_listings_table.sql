CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  candidate_id UUID NOT NULL,
  marketplace_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREVIEW',

  title TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,

  payload JSONB NOT NULL,
  response JSONB,

  idempotency_key TEXT NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT listings_status_check
    CHECK (status IN ('DRAFT', 'PREVIEW', 'READY', 'PUBLISHED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS listings_unique_idempotency_key
  ON listings (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS listings_unique_candidate_marketplace_preview
  ON listings (candidate_id, marketplace_key)
  WHERE status IN ('DRAFT', 'PREVIEW');

CREATE INDEX IF NOT EXISTS listings_candidate_idx
  ON listings (candidate_id);

CREATE INDEX IF NOT EXISTS listings_marketplace_status_idx
  ON listings (marketplace_key, status);
