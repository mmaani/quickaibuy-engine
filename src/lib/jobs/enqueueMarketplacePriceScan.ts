import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";
import { assertLearningHubReady } from "@/lib/enforcement/runtimeSovereignty";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueMarketplacePriceScan(input?: {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
}) {
  await assertLearningHubReady({
    blockedAction: "enqueue_marketplace_price_scan",
    path: "enqueueMarketplacePriceScan",
    actorId: "enqueueMarketplacePriceScan",
    actorType: "SYSTEM",
    requiredDomains: [
      "marketplace_fit_intelligence",
      "opportunity_scores",
      "control_plane_scorecards",
    ],
  });

  const limit = Number(input?.limit ?? 100);
  const productRawId = input?.productRawId ? String(input.productRawId).trim() : undefined;
  const platform = (input?.platform ?? "all") as "amazon" | "ebay" | "all";

  const jobId = productRawId
    ? `marketplace-scan-${platform}-${productRawId}`
    : `marketplace-scan-${platform}-${limit}`;

  const job = await jobsQueue.add(
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

  await markJobQueued({
    jobType: JOB_NAMES.SCAN_MARKETPLACE_PRICE,
    idempotencyKey: String(job.id),
    payload: { limit, productRawId, platform },
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}
