import { Queue } from "bullmq";
import { pool } from "@/lib/db";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

type StageRecoveryDefinition = {
  key: "trend" | "supplier" | "marketplace" | "matching" | "profit";
  jobName: string;
  cadenceMs: number;
  recoveryJobId: string;
  payload: Record<string, unknown>;
  successJobNames: string[];
};

const HOUR_MS = 60 * 60 * 1000;

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

const STAGE_RECOVERY_DEFINITIONS: StageRecoveryDefinition[] = [
  {
    key: "trend",
    jobName: JOB_NAMES.TREND_EXPAND_REFRESH,
    cadenceMs: 6 * HOUR_MS,
    recoveryJobId: "trend-expand-refresh-recovery-latest",
    payload: { limit: 50, triggerSource: "schedule", recoveryReason: "missed-run-auto-recovery" },
    successJobNames: [JOB_NAMES.TREND_EXPAND_REFRESH, JOB_NAMES.TREND_EXPAND, JOB_NAMES.TREND_INGEST],
  },
  {
    key: "supplier",
    jobName: JOB_NAMES.SUPPLIER_DISCOVER,
    cadenceMs: 6 * HOUR_MS,
    recoveryJobId: "supplier-discover-recovery-latest",
    payload: {
      limitPerKeyword: 30,
      triggerSource: "schedule",
      reason: "missed-run-auto-recovery",
      recoveryReason: "missed-run-auto-recovery",
    },
    successJobNames: [JOB_NAMES.SUPPLIER_DISCOVER],
  },
  {
    key: "marketplace",
    jobName: JOB_NAMES.SCAN_MARKETPLACE_PRICE,
    cadenceMs: 4 * HOUR_MS,
    recoveryJobId: "marketplace-scan-recovery-latest",
    payload: { limit: 150, platform: "ebay", triggerSource: "schedule", recoveryReason: "missed-run-auto-recovery" },
    successJobNames: [JOB_NAMES.SCAN_MARKETPLACE_PRICE],
  },
  {
    key: "matching",
    jobName: JOB_NAMES.MATCH_PRODUCT,
    cadenceMs: 4 * HOUR_MS,
    recoveryJobId: "match-product-recovery-latest",
    payload: { limit: 150, triggerSource: "schedule", recoveryReason: "missed-run-auto-recovery" },
    successJobNames: [JOB_NAMES.MATCH_PRODUCT],
  },
  {
    key: "profit",
    jobName: JOB_NAMES.EVAL_PROFIT,
    cadenceMs: 4 * HOUR_MS,
    recoveryJobId: "eval-profit-recovery-latest",
    payload: { limit: 150, triggerSource: "schedule", recoveryReason: "missed-run-auto-recovery" },
    successJobNames: [JOB_NAMES.EVAL_PROFIT],
  },
];

async function latestSuccessTs(jobNames: string[]): Promise<number | null> {
  const result = await pool.query<{ ts: string | null }>(
    `
      select max(coalesce(finished_at, started_at)) as ts
      from worker_runs
      where worker = 'jobs.worker'
        and upper(coalesce(status, '')) = 'SUCCEEDED'
        and job_name = any($1::text[])
    `,
    [jobNames]
  );

  const raw = result.rows[0]?.ts;
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export async function recoverMissedUpstreamFreshness() {
  const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
    jobsQueue.getWaiting(0, 200),
    jobsQueue.getActive(0, 200),
    jobsQueue.getDelayed(0, 200),
  ]);

  const queuedOrActive = [...waitingJobs, ...activeJobs, ...delayedJobs];
  const recoveredStages: string[] = [];
  const skippedStages: Array<{ stage: string; reason: string }> = [];

  for (const stage of STAGE_RECOVERY_DEFINITIONS) {
    const latestSuccess = await latestSuccessTs(stage.successJobNames);
    const overdueThresholdMs = Math.round(stage.cadenceMs * 1.5);
    const isOverdue = latestSuccess == null || Date.now() - latestSuccess > overdueThresholdMs;
    const alreadyQueued = queuedOrActive.some((job) => job.name === stage.jobName);

    if (!isOverdue) {
      skippedStages.push({ stage: stage.key, reason: "fresh-enough" });
      continue;
    }

    if (alreadyQueued) {
      skippedStages.push({ stage: stage.key, reason: "job-already-queued-or-active" });
      continue;
    }

    const job = await jobsQueue.add(stage.jobName, stage.payload, {
      jobId: stage.recoveryJobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    await markJobQueued({
      jobType: stage.jobName,
      idempotencyKey: String(job.id),
      payload: stage.payload,
      attempt: 0,
      maxAttempts: 3,
    });

    recoveredStages.push(stage.key);
  }

  return {
    ok: true,
    recoveredStages,
    skippedStages,
  };
}
