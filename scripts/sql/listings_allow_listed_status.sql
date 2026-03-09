-- NOTE: v1 listing gate uses ACTIVE/PUBLISH_* statuses (not LISTED).
-- Keep this helper aligned with migrations/20260309_controlled_listing_gate_v1.sql.
ALTER TABLE listings
DROP CONSTRAINT IF EXISTS listings_status_check;

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
