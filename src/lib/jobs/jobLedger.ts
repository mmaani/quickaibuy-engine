import { pool } from "@/lib/db";

type JobLedgerBase = {
  jobType: string;
  idempotencyKey: string;
};

type JobLedgerQueued = JobLedgerBase & {
  payload: unknown;
  attempt?: number;
  maxAttempts?: number;
};

type JobLedgerRunning = JobLedgerBase & {
  payload?: unknown;
  attempt?: number;
  maxAttempts?: number;
};

type JobLedgerTerminal = JobLedgerBase & {
  attempt?: number;
  maxAttempts?: number;
  lastError?: string | null;
};

function normalizeAttempts(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : fallback;
}

export async function markJobQueued(args: JobLedgerQueued) {
  const attempt = normalizeAttempts(args.attempt, 0);
  const maxAttempts = normalizeAttempts(args.maxAttempts, 5);

  await pool.query(
    `
      INSERT INTO jobs (
        job_type,
        idempotency_key,
        payload,
        status,
        attempt,
        max_attempts,
        scheduled_ts,
        started_ts,
        finished_ts,
        last_error
      )
      VALUES ($1, $2, $3::jsonb, 'QUEUED', $4, $5, NOW(), NULL, NULL, NULL)
      ON CONFLICT (job_type, idempotency_key)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        status = 'QUEUED',
        attempt = EXCLUDED.attempt,
        max_attempts = EXCLUDED.max_attempts,
        scheduled_ts = NOW(),
        started_ts = NULL,
        finished_ts = NULL,
        last_error = NULL
    `,
    [args.jobType, args.idempotencyKey, JSON.stringify(args.payload ?? {}), attempt, maxAttempts]
  );
}

export async function markJobRunning(args: JobLedgerRunning) {
  const attempt = normalizeAttempts(args.attempt, 0);
  const maxAttempts = normalizeAttempts(args.maxAttempts, 5);

  await pool.query(
    `
      INSERT INTO jobs (
        job_type,
        idempotency_key,
        payload,
        status,
        attempt,
        max_attempts,
        scheduled_ts,
        started_ts,
        finished_ts,
        last_error
      )
      VALUES ($1, $2, $3::jsonb, 'RUNNING', $4, $5, NOW(), NOW(), NULL, NULL)
      ON CONFLICT (job_type, idempotency_key)
      DO UPDATE SET
        payload = COALESCE(EXCLUDED.payload, jobs.payload),
        status = 'RUNNING',
        attempt = EXCLUDED.attempt,
        max_attempts = EXCLUDED.max_attempts,
        started_ts = COALESCE(jobs.started_ts, NOW()),
        finished_ts = NULL,
        last_error = NULL
    `,
    [args.jobType, args.idempotencyKey, JSON.stringify(args.payload ?? {}), attempt, maxAttempts]
  );
}

export async function markJobSucceeded(args: JobLedgerTerminal) {
  const attempt = normalizeAttempts(args.attempt, 0);
  const maxAttempts = normalizeAttempts(args.maxAttempts, 5);

  await pool.query(
    `
      UPDATE jobs
      SET
        status = 'SUCCEEDED',
        attempt = $3,
        max_attempts = $4,
        finished_ts = NOW(),
        last_error = NULL
      WHERE job_type = $1
        AND idempotency_key = $2
    `,
    [args.jobType, args.idempotencyKey, attempt, maxAttempts]
  );
}

export async function markJobFailed(args: JobLedgerTerminal) {
  const attempt = normalizeAttempts(args.attempt, 0);
  const maxAttempts = normalizeAttempts(args.maxAttempts, 5);

  await pool.query(
    `
      INSERT INTO jobs (
        job_type,
        idempotency_key,
        payload,
        status,
        attempt,
        max_attempts,
        scheduled_ts,
        started_ts,
        finished_ts,
        last_error
      )
      VALUES ($1, $2, '{}'::jsonb, 'FAILED', $3, $4, NOW(), NOW(), NOW(), $5)
      ON CONFLICT (job_type, idempotency_key)
      DO UPDATE SET
        status = 'FAILED',
        attempt = EXCLUDED.attempt,
        max_attempts = EXCLUDED.max_attempts,
        finished_ts = NOW(),
        last_error = EXCLUDED.last_error
    `,
    [args.jobType, args.idempotencyKey, attempt, maxAttempts, args.lastError ?? null]
  );
}
