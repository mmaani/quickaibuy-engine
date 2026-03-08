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
