import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

export async function enqueueAutonomousOpsBackbone(input?: {
  phase?: "full" | "diagnostics_refresh" | "prepare" | "publish";
  triggerSource?: "control-plane" | "schedule" | "script" | "system";
  idempotencySuffix?: string;
}) {
  const phase =
    input?.phase === "diagnostics_refresh" || input?.phase === "prepare" || input?.phase === "publish"
      ? input.phase
      : "full";
  const triggerSource =
    input?.triggerSource === "control-plane" ||
    input?.triggerSource === "schedule" ||
    input?.triggerSource === "script"
      ? input.triggerSource
      : "system";
  const idempotencySuffix = String(input?.idempotencySuffix ?? Date.now()).trim() || String(Date.now());

  const payload = {
    phase,
    triggerSource,
  };

  const job = await jobsQueue.add(JOB_NAMES.AUTONOMOUS_OPS_BACKBONE, payload, {
    jobId: `autonomous-ops-${phase}-${idempotencySuffix}`,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });

  await markJobQueued({
    jobType: JOB_NAMES.AUTONOMOUS_OPS_BACKBONE,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 2,
  });

  return job;
}
