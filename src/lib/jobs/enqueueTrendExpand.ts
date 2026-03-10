import { Queue } from "bullmq";
import { BULL_PREFIX, JOBS_QUEUE_NAME, JOB_NAMES } from "./jobNames";
import { bullConnection } from "../bull";
import { markJobQueued } from "./jobLedger";

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueTrendExpand(trendSignalId: string) {
  const payload = { trendSignalId };
  const job = await jobsQueue.add(
    JOB_NAMES.TREND_EXPAND,
    payload,
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  await markJobQueued({
    jobType: JOB_NAMES.TREND_EXPAND,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}

export async function enqueueProductDiscover(candidateId: string) {
  const normalizedCandidateId = String(candidateId).trim();
  const jobId = `product-discover-${normalizedCandidateId}`;
  const payload = { candidateId: normalizedCandidateId };

  const job = await jobsQueue.add(
    JOB_NAMES.PRODUCT_DISCOVER,
    payload,
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  await markJobQueued({
    jobType: JOB_NAMES.PRODUCT_DISCOVER,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}

export async function enqueueProductDiscoverTask(input: {
  candidateId: string;
  marketplace: string;
  keyword: string;
  queryTaskId: string;
}) {
  const candidateId = String(input.candidateId).trim();
  const marketplace = String(input.marketplace).trim().toLowerCase();
  const keyword = String(input.keyword).trim();
  const queryTaskId = String(input.queryTaskId).trim();
  const jobId = `product-discover-${queryTaskId}`;
  const payload = { candidateId, marketplace, keyword, queryTaskId };

  const job = await jobsQueue.add(
    JOB_NAMES.PRODUCT_DISCOVER,
    payload,
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  await markJobQueued({
    jobType: JOB_NAMES.PRODUCT_DISCOVER,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}

export { enqueueMarketplacePriceScan } from "./enqueueMarketplacePriceScan";
