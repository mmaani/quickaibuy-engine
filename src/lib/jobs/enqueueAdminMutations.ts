import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });

type TriggerSource = "control-plane" | "review-console";

async function enqueueAdminMutationJobInternal(input: {
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

export async function enqueueReviewDecisionJob(input: {
  actorId: string;
  triggerSource: TriggerSource;
  payload: {
    decisionStatus: string;
    reason: string | null;
    candidateIds: string[];
    enforceBatchSafeApprove: boolean;
  };
  mode: "single" | "batch";
  idempotencySuffix?: string;
}) {
  return enqueueAdminMutationJobInternal({
    jobName: JOB_NAMES.ADMIN_REVIEW_DECISION,
    actorId: input.actorId,
    triggerSource: input.triggerSource,
    controlPath: "api/admin/review/decision",
    actionType: input.mode === "batch" ? "candidate_review_decision_batch" : "candidate_review_decision_single",
    payload: input.payload,
    idempotencySuffix: input.idempotencySuffix,
  });
}

export async function enqueueReviewPreparePreviewJob(input: {
  actorId: string;
  triggerSource: TriggerSource;
  payload: { candidateId: string; marketplace: "ebay" | "amazon"; forceRefresh: boolean };
  idempotencySuffix?: string;
}) {
  return enqueueAdminMutationJobInternal({
    jobName: JOB_NAMES.ADMIN_REVIEW_PREPARE_PREVIEW,
    actorId: input.actorId,
    triggerSource: input.triggerSource,
    controlPath: "api/admin/review/prepare-preview",
    actionType: "review_prepare_preview",
    payload: input.payload,
    idempotencySuffix: input.idempotencySuffix,
  });
}

export async function enqueueListingPromoteReadyJob(input: {
  actorId: string;
  triggerSource: TriggerSource;
  payload: { listingId: string; candidateId: string };
  idempotencySuffix?: string;
}) {
  return enqueueAdminMutationJobInternal({
    jobName: JOB_NAMES.ADMIN_LISTING_PROMOTE_READY,
    actorId: input.actorId,
    triggerSource: input.triggerSource,
    controlPath: "api/admin/listings/promote-ready",
    actionType: "listing_promote_ready",
    payload: input.payload,
    idempotencySuffix: input.idempotencySuffix,
  });
}

export async function enqueueListingResumeJob(input: {
  actorId: string;
  triggerSource: TriggerSource;
  payload: { listingId: string; candidateId: string };
  idempotencySuffix?: string;
}) {
  return enqueueAdminMutationJobInternal({
    jobName: JOB_NAMES.ADMIN_LISTING_RESUME,
    actorId: input.actorId,
    triggerSource: input.triggerSource,
    controlPath: "api/admin/listings/resume",
    actionType: "listing_resume",
    payload: input.payload,
    idempotencySuffix: input.idempotencySuffix,
  });
}

export async function enqueueListingReevaluateJob(input: {
  actorId: string;
  triggerSource: TriggerSource;
  payload: { listingId: string; candidateId: string };
  idempotencySuffix?: string;
}) {
  return enqueueAdminMutationJobInternal({
    jobName: JOB_NAMES.ADMIN_LISTING_REEVALUATE,
    actorId: input.actorId,
    triggerSource: input.triggerSource,
    controlPath: "api/admin/listings/re-evaluate",
    actionType: "listing_reevaluate_recovery",
    payload: input.payload,
    idempotencySuffix: input.idempotencySuffix,
  });
}
