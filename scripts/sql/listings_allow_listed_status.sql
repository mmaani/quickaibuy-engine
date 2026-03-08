ALTER TABLE listings
DROP CONSTRAINT IF EXISTS listings_status_check;

ALTER TABLE listings
ADD CONSTRAINT listings_status_check
CHECK (
  status IN (
    'DRAFT',
    'PREVIEW',
    'READY',
    'LISTING_IN_PROGRESS',
    'LISTED',
    'FAILED',
    'ARCHIVED'
  )
);
