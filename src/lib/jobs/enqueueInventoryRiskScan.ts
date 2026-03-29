import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export const INVENTORY_RISK_SCAN_EVERY_MS = 6 * 60 * 60 * 1000;
const INVENTORY_RISK_RECURRING_SUFFIX = "recurring-v1-6h";

type RepeatableEntry = {
  key?: string;
  name?: string;
  id?: string | null;
  every?: number | null;
  next?: number | null;
};

type SchedulerEntry = {
  key?: string;
  name?: string;
  id?: string | null;
  every?: number | null;
  next?: number | null;
};

export type InventoryRiskScheduleSnapshot = {
  recurringJobId: string;
  cadenceMs: number;
  scheduleActive: boolean;
  nextRun: string | null;
  matchedEntries: number;
};

export function getInventoryRiskRecurringJobId(marketplaceKey: "ebay"): string {
  return `inventory-risk-scan-${marketplaceKey}-${INVENTORY_RISK_RECURRING_SUFFIX}`;
}

function containsRecurringId(entry: RepeatableEntry, recurringJobId: string): boolean {
  const key = String(entry.key ?? "");
  const id = String(entry.id ?? "");
  return key.includes(recurringJobId) || id === recurringJobId;
}

function isInventoryRiskRepeatable(entry: RepeatableEntry, recurringJobId: string): boolean {
  if (entry.name !== JOB_NAMES.INVENTORY_RISK_SCAN) return false;
  if (Number(entry.every ?? 0) !== INVENTORY_RISK_SCAN_EVERY_MS) return false;
  return containsRecurringId(entry, recurringJobId) || Boolean(entry.key);
}

function isInventoryRiskScheduler(entry: SchedulerEntry, recurringJobId: string): boolean {
  if (entry.name !== JOB_NAMES.INVENTORY_RISK_SCAN) return false;
  if (Number(entry.every ?? 0) !== INVENTORY_RISK_SCAN_EVERY_MS) return false;
  return containsRecurringId(entry, recurringJobId) || Boolean(entry.key);
}

export function getInventoryRiskScheduleSnapshotFromEntries(input: {
  repeatableJobs: RepeatableEntry[];
  schedulerJobs?: SchedulerEntry[];
  marketplaceKey?: "ebay";
}): InventoryRiskScheduleSnapshot {
  const marketplaceKey = (input.marketplaceKey ?? "ebay") as "ebay";
  const recurringJobId = getInventoryRiskRecurringJobId(marketplaceKey);

  const matching = input.repeatableJobs.filter((entry) =>
    isInventoryRiskRepeatable(entry, recurringJobId)
  );
  const matchingSchedulers = (input.schedulerJobs ?? []).filter((entry) =>
    isInventoryRiskScheduler(entry, recurringJobId)
  );

  const next = [...matchingSchedulers, ...matching]
    .map((entry) => Number(entry.next ?? NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];

  return {
    recurringJobId,
    cadenceMs: INVENTORY_RISK_SCAN_EVERY_MS,
    scheduleActive: matching.length > 0 || matchingSchedulers.length > 0,
    nextRun: typeof next === "number" ? new Date(next).toISOString() : null,
    matchedEntries: matching.length + matchingSchedulers.length,
  };
}

export async function getInventoryRiskScheduleSnapshot(input?: {
  queue?: Queue;
  marketplaceKey?: "ebay";
}): Promise<InventoryRiskScheduleSnapshot> {
  const queue = input?.queue ?? jobsQueue;
  const [repeatableJobs, schedulerJobs] = await Promise.all([
    queue.getRepeatableJobs(0, 500) as Promise<RepeatableEntry[]>,
    queue.getJobSchedulers(0, 500) as Promise<SchedulerEntry[]>,
  ]);
  return getInventoryRiskScheduleSnapshotFromEntries({
    repeatableJobs,
    schedulerJobs,
    marketplaceKey: input?.marketplaceKey,
  });
}

async function findInFlightInventoryRiskJob(marketplaceKey: "ebay", jobId: string) {
  const jobs = await jobsQueue.getJobs(["active", "waiting", "prioritized"], 0, 200);
  return jobs.find(
    (job) =>
      job.name === JOB_NAMES.INVENTORY_RISK_SCAN &&
      String(job.data?.marketplaceKey ?? "ebay") === marketplaceKey &&
      String(job.id ?? "") === jobId
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
  const existing = await findInFlightInventoryRiskJob(marketplaceKey, jobId);
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
  const recurringJobId = getInventoryRiskRecurringJobId(marketplaceKey);
  const [repeatableJobs, schedulerJobs] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 500) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 500) as Promise<SchedulerEntry[]>,
  ]);

  let desiredEntrySeen = false;
  let removedCount = 0;

  for (const entry of repeatableJobs) {
    if (entry.name !== JOB_NAMES.INVENTORY_RISK_SCAN) continue;

    const entryTargetsMarketplace =
      String(entry.key ?? "").includes(`inventory-risk-scan-${marketplaceKey}-`) ||
      String(entry.id ?? "").includes(`inventory-risk-scan-${marketplaceKey}-`);

    const entryIsDesired = isInventoryRiskRepeatable(entry, recurringJobId);

    if (entryIsDesired && !desiredEntrySeen) {
      desiredEntrySeen = true;
      continue;
    }

    if (entryTargetsMarketplace) {
      await jobsQueue.removeRepeatableByKey(String(entry.key));
      removedCount += 1;
    }
  }

  if (schedulerJobs.some((entry) => isInventoryRiskScheduler(entry, recurringJobId))) {
    desiredEntrySeen = true;
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

  const snapshot = await getInventoryRiskScheduleSnapshot({
    queue: jobsQueue,
    marketplaceKey,
  });

  return {
    scheduleEveryMs: INVENTORY_RISK_SCAN_EVERY_MS,
    recurringJobId,
    removedCount,
    scheduleActive: snapshot.scheduleActive,
    nextRun: snapshot.nextRun,
    matchedEntries: snapshot.matchedEntries,
  };
}
