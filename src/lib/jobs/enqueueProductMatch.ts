import { Queue } from "bullmq";
import { BULL_PREFIX, JOBS_QUEUE_NAME, JOB_NAMES } from "./jobNames";
import { bullConnection } from "../bull";

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueProductMatch(params?: {
  supplierLimit?: number;
  marketplaceLimit?: number;
  minConfidence?: number;
}) {
  return jobsQueue.add(
    JOB_NAMES.MATCH_PRODUCT,
    {
      supplierLimit: params?.supplierLimit ?? 250,
      marketplaceLimit: params?.marketplaceLimit ?? 1000,
      minConfidence: params?.minConfidence ?? 0.75,
    },
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
