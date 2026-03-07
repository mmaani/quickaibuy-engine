import { Queue } from "bullmq";
import { JOB_NAMES } from "./jobNames";
import { bullConnection } from "../bull";

export const jobsQueue = new Queue("jobs", {
  connection: bullConnection,
});

export async function enqueueTrendExpand(trendSignalId: string) {
  return jobsQueue.add(
    JOB_NAMES.TREND_EXPAND,
    { trendSignalId },
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
}

export async function enqueueProductDiscover(candidateId: string) {
  const normalizedCandidateId = String(candidateId).trim();
  const jobId = `product-discover-${normalizedCandidateId}`;

  return jobsQueue.add(
    JOB_NAMES.PRODUCT_DISCOVER,
    { candidateId: normalizedCandidateId },
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

  return jobsQueue.add(
    JOB_NAMES.PRODUCT_DISCOVER,
    { candidateId, marketplace, keyword, queryTaskId },
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
}

export async function enqueueMarketplacePriceScan(input?: {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
}) {
  const limit = Number(input?.limit ?? 100);
  const productRawId = input?.productRawId ? String(input.productRawId).trim() : undefined;
  const platform = (input?.platform ?? "all") as "amazon" | "ebay" | "all";

  const jobId = productRawId
    ? `marketplace-scan-${platform}-${productRawId}`
    : `marketplace-scan-${platform}-${limit}`;

  return jobsQueue.add(
    JOB_NAMES.SCAN_MARKETPLACE_PRICE,
    { limit, productRawId, platform },
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
}
