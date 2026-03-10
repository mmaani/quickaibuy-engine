-- Normalize existing statuses to canonical operational values.
UPDATE worker_runs
SET status = upper(coalesce(status, ''))
WHERE status IS DISTINCT FROM upper(coalesce(status, ''));

UPDATE worker_runs
SET status = 'SUCCEEDED'
WHERE status IN ('SUCCESS', 'DONE', 'COMPLETED');

UPDATE jobs
SET status = upper(coalesce(status, ''))
WHERE status IS DISTINCT FROM upper(coalesce(status, ''));

UPDATE jobs
SET status = 'QUEUED'
WHERE status IN ('NEW', 'PENDING');

UPDATE jobs
SET status = 'SUCCEEDED'
WHERE status IN ('SUCCESS', 'DONE', 'COMPLETED');

UPDATE jobs
SET status = 'FAILED'
WHERE status NOT IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- Harden tables as operator-facing sources of truth.
ALTER TABLE worker_runs
  ALTER COLUMN started_at SET NOT NULL;

ALTER TABLE jobs
  ALTER COLUMN scheduled_ts SET NOT NULL;

ALTER TABLE worker_runs
  DROP CONSTRAINT IF EXISTS worker_runs_status_check;
ALTER TABLE worker_runs
  ADD CONSTRAINT worker_runs_status_check
  CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED'));

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'));

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_recency_idx
  ON jobs ((coalesce(finished_ts, started_ts, scheduled_ts)));
