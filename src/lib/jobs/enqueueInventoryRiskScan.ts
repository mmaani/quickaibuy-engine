import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

const INVENTORY_RISK_SCAN_EVERY_MS = 6 * 60 * 60 * 1000;
const INVENTORY_RISK_RECURRING_SUFFIX = "recurring-v1-6h";

function recurringJobIdForMarketplace(marketplaceKey: "ebay"): string {
  return `inventory-risk-scan-${marketplaceKey}-${INVENTORY_RISK_RECURRING_SUFFIX}`;
}

async function findInFlightInventoryRiskJob(marketplaceKey: "ebay") {
  const jobs = await jobsQueue.getJobs(["active", "waiting", "prioritized"], 0, 200);
  return jobs.find(
    (job) =>
      job.name === JOB_NAMES.INVENTORY_RISK_SCAN &&
      String(job.data?.marketplaceKey ?? "ebay") === marketplaceKey
  );
}

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
  const existing = await findInFlightInventoryRiskJob(marketplaceKey);
  if (existing) {
    return existing;
  }

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

export async function ensureInventoryRiskScanSchedule(input?: {
  limit?: number;
  marketplaceKey?: "ebay";
}) {
  const limit = Number(input?.limit ?? 200);
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const payload = { limit, marketplaceKey };
  const recurringJobId = recurringJobIdForMarketplace(marketplaceKey);
  const repeatableJobs = await jobsQueue.getRepeatableJobs(0, 200);
  const inventoryRepeatables = repeatableJobs.filter(
    (job) => job.name === JOB_NAMES.INVENTORY_RISK_SCAN
  );

  let desiredEntrySeen = false;
  let removedCount = 0;

  for (const entry of inventoryRepeatables) {
    const sameMarketplace = String(entry.id ?? "").includes(`inventory-risk-scan-${marketplaceKey}-`);
    const matchesCadence =
      entry.id === recurringJobId && Number(entry.every ?? 0) === INVENTORY_RISK_SCAN_EVERY_MS;

    if (matchesCadence && !desiredEntrySeen) {
      desiredEntrySeen = true;
      continue;
    }

    if (sameMarketplace || matchesCadence) {
      await jobsQueue.removeRepeatableByKey(entry.key);
      removedCount += 1;
    }
  }

  if (!desiredEntrySeen) {
    await jobsQueue.add(JOB_NAMES.INVENTORY_RISK_SCAN, payload, {
      jobId: recurringJobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      repeat: {
        every: INVENTORY_RISK_SCAN_EVERY_MS,
      },
    });
  }

  return {
    scheduleEveryMs: INVENTORY_RISK_SCAN_EVERY_MS,
    recurringJobId,
    removedCount,
    scheduleActive: true,
  };
}
