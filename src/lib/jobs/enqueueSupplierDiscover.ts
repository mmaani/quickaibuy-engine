import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";
import { assertLearningHubReady } from "@/lib/enforcement/runtimeSovereignty";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueSupplierDiscoverRefresh(input?: {
  limitPerKeyword?: number;
  idempotencySuffix?: string;
  reason?: string;
}) {
  await assertLearningHubReady({
    blockedAction: "enqueue_supplier_discover_refresh",
    path: "enqueueSupplierDiscoverRefresh",
    actorId: "enqueueSupplierDiscoverRefresh",
    actorType: "SYSTEM",
    requiredDomains: [
      "supplier_intelligence",
      "shipping_intelligence",
      "control_plane_scorecards",
    ],
  });

  const limitPerKeyword = Number(input?.limitPerKeyword ?? 20);
  const idempotencySuffix = String(input?.idempotencySuffix ?? "latest").trim() || "latest";
  const reason = String(input?.reason ?? "supplier-snapshot-stale").trim() || "supplier-snapshot-stale";
  const jobId = `supplier-discover-refresh-${idempotencySuffix}`;

  const payload = { limitPerKeyword, reason };
  const job = await jobsQueue.add(
    JOB_NAMES.SUPPLIER_DISCOVER,
    payload,
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  await markJobQueued({
    jobType: JOB_NAMES.SUPPLIER_DISCOVER,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}
