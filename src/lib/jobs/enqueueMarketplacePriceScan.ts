import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

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
