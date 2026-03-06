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
