import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueProfitEval(input?: {
  limit?: number;
  idempotencySuffix?: string;
  triggerSource?: "manual" | "schedule" | "follow-up";
}) {
  const limit = Number(input?.limit ?? 100);
  const idempotencySuffix = String(input?.idempotencySuffix ?? "latest").trim() || "latest";
  const triggerSource = (input?.triggerSource ?? "manual") as "manual" | "schedule" | "follow-up";
  const payload = { limit, triggerSource };
  const jobId = `profit-eval-${idempotencySuffix}`;

  const job = await jobsQueue.add(JOB_NAMES.EVAL_PROFIT, payload, {
    jobId,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });

  await markJobQueued({
    jobType: JOB_NAMES.EVAL_PROFIT,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}

