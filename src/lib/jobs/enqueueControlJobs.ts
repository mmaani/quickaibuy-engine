import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });

export async function enqueueOrderSyncFromControlPlane(actorId: string) {
  const payload = {
    limit: Number(process.env.ORDER_SYNC_FETCH_LIMIT ?? 50),
    lookbackHours: Number(process.env.ORDER_SYNC_LOOKBACK_HOURS ?? 168),
    triggerSource: "control-plane",
    actionType: "order_sync",
    controlPlaneContext: { actorId, path: "runControlQuickAction", enqueuedAt: new Date().toISOString() },
  };
  const job = await jobsQueue.add(JOB_NAMES.ORDER_SYNC, payload, {
    jobId: `order-sync-control-${Date.now()}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
  await markJobQueued({ jobType: JOB_NAMES.ORDER_SYNC, idempotencyKey: String(job.id), payload, attempt: 0, maxAttempts: 2 });
  return job;
}

export async function enqueueLearningRefreshFromControlPlane(actorId: string) {
  const payload = {
    trigger: `admin_control:${actorId}`,
    forceFull: true,
    triggerSource: "control-plane",
    actionType: "learning_refresh",
    controlPlaneContext: { actorId, path: "runControlQuickAction", enqueuedAt: new Date().toISOString() },
  };
  const job = await jobsQueue.add(JOB_NAMES.CONTINUOUS_LEARNING_REFRESH, payload, {
    jobId: `learning-refresh-control-${Date.now()}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
  await markJobQueued({ jobType: JOB_NAMES.CONTINUOUS_LEARNING_REFRESH, idempotencyKey: String(job.id), payload, attempt: 0, maxAttempts: 2 });
  return job;
}
