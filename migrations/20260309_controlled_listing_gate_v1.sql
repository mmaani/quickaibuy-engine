BEGIN;

ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS listings_status_check;

UPDATE listings
SET status = 'ACTIVE'
WHERE status = 'LISTED';

UPDATE listings
SET status = 'READY_TO_PUBLISH'
WHERE status = 'READY';

UPDATE listings
SET status = 'ACTIVE'
WHERE status = 'PUBLISHED';

UPDATE listings
SET status = 'PREVIEW'
WHERE status = 'DRAFT';

ALTER TABLE profitable_candidates
  ADD COLUMN IF NOT EXISTS approved_ts TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS approved_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS listing_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS listing_eligible_ts TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS listing_block_reason TEXT NULL;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS publish_marketplace TEXT NULL,
  ADD COLUMN IF NOT EXISTS publish_started_ts TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS publish_finished_ts TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS published_external_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS publish_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_publish_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS listing_date DATE NULL;

CREATE TABLE IF NOT EXISTS listing_daily_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_key TEXT NOT NULL,
  cap_date DATE NOT NULL,
  cap_limit INTEGER NOT NULL,
  cap_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_daily_caps_marketplace_date_uidx
  ON listing_daily_caps (marketplace_key, cap_date);

CREATE INDEX IF NOT EXISTS listings_marketplace_status_updated_idx
  ON listings (marketplace_key, status, updated_at);

DROP INDEX IF EXISTS listings_unique_candidate_marketplace_preview;
DROP INDEX IF EXISTS listings_unique_candidate_marketplace_live_path;

CREATE UNIQUE INDEX IF NOT EXISTS listings_unique_candidate_marketplace_live_path
  ON listings (candidate_id, marketplace_key)
  WHERE status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE');

ALTER TABLE listings
  ADD CONSTRAINT listings_status_check
  CHECK (
    status IN (
      'PREVIEW',
      'READY_TO_PUBLISH',
      'PUBLISH_IN_PROGRESS',
      'ACTIVE',
      'PUBLISH_FAILED',
      'PAUSED',
      'ENDED'
    )
  );

COMMIT;
