import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueInventoryRiskScan(input?: {
  limit?: number;
  marketplaceKey?: "ebay";
  idempotencySuffix?: string;
}) {
  const limit = Number(input?.limit ?? 200);
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const idempotencySuffix = String(input?.idempotencySuffix ?? "latest").trim() || "latest";
  const payload = { limit, marketplaceKey };
  const jobId = `inventory-risk-scan-${marketplaceKey}-${idempotencySuffix}`;

  const job = await jobsQueue.add(JOB_NAMES.INVENTORY_RISK_SCAN, payload, {
    jobId,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });

  await markJobQueued({
    jobType: JOB_NAMES.INVENTORY_RISK_SCAN,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}
