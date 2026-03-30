import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });

type TriggerSource = "control-plane" | "review-console";

export async function enqueueAdminMutationJob(input: {
  jobName:
    | typeof JOB_NAMES.ADMIN_REVIEW_DECISION
    | typeof JOB_NAMES.ADMIN_LISTING_PROMOTE_READY
    | typeof JOB_NAMES.ADMIN_LISTING_RESUME
    | typeof JOB_NAMES.ADMIN_LISTING_REEVALUATE
    | typeof JOB_NAMES.ADMIN_REVIEW_PREPARE_PREVIEW;
  actorId: string;
  triggerSource: TriggerSource;
  controlPath: string;
  actionType: string;
  payload: Record<string, unknown>;
  idempotencySuffix?: string;
}) {
  const idempotencySuffix = String(input.idempotencySuffix ?? Date.now()).trim() || String(Date.now());
  const payload = {
    ...input.payload,
    triggerSource: input.triggerSource,
    actionType: input.actionType,
    controlPlaneContext: {
      actorId: input.actorId,
      path: input.controlPath,
      enqueuedAt: new Date().toISOString(),
    },
  };

  const job = await jobsQueue.add(input.jobName, payload, {
    jobId: `${input.jobName}-${idempotencySuffix}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });

  await markJobQueued({
    jobType: input.jobName,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 2,
  });

  return job;
}
