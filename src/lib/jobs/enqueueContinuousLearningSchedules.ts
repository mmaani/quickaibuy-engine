import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";

type RepeatableEntry = {
  key?: string;
  name?: string;
  id?: string | null;
  every?: number | null;
  next?: number | null;
};

type SchedulerEntry = {
  key?: string;
  name?: string;
  id?: string | null;
  every?: number | null;
  next?: number | null;
};

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

const MINUTE_MS = 60 * 1000;

export const CONTINUOUS_LEARNING_SCHEDULE = {
  stage: "continuous_learning",
  orchestrationOrder: [
    "supplier_score_recompute",
    "shipping_quality_recompute",
    "category_intelligence_recompute",
    "product_profile_intelligence_recompute",
    "marketplace_fit_recompute",
    "attribute_intelligence_recompute",
    "opportunity_score_recompute",
    "drift_anomaly_recompute",
    "scorecard_refresh",
  ],
  jobName: JOB_NAMES.CONTINUOUS_LEARNING_REFRESH,
  jobId: "continuous-learning-refresh-v1-120m",
  everyMs: 120 * MINUTE_MS,
  payload: {
    trigger: "schedule",
    forceFull: true,
  },
} as const;

function isDesiredEntry(entry: RepeatableEntry) {
  return (
    entry.name === CONTINUOUS_LEARNING_SCHEDULE.jobName &&
    Number(entry.every ?? 0) === CONTINUOUS_LEARNING_SCHEDULE.everyMs &&
    (String(entry.id ?? "") === CONTINUOUS_LEARNING_SCHEDULE.jobId ||
      String(entry.key ?? "").includes(CONTINUOUS_LEARNING_SCHEDULE.jobId) ||
      Boolean(entry.key))
  );
}

function isDesiredScheduler(entry: SchedulerEntry) {
  return (
    entry.name === CONTINUOUS_LEARNING_SCHEDULE.jobName &&
    Number(entry.every ?? 0) === CONTINUOUS_LEARNING_SCHEDULE.everyMs &&
    (String(entry.id ?? "") === CONTINUOUS_LEARNING_SCHEDULE.jobId ||
      String(entry.key ?? "").includes(CONTINUOUS_LEARNING_SCHEDULE.jobId) ||
      Boolean(entry.key))
  );
}

function targetsSchedule(entry: RepeatableEntry) {
  return (
    entry.name === CONTINUOUS_LEARNING_SCHEDULE.jobName &&
    (String(entry.id ?? "").startsWith("continuous-learning-refresh") ||
      String(entry.key ?? "").includes("continuous-learning-refresh"))
  );
}

export async function enqueueContinuousLearningRefresh(input?: {
  trigger?: string;
  reason?: string;
  forceFull?: boolean;
}) {
  const trigger = String(input?.trigger ?? "event").trim() || "event";
  const jobId = `continuous-learning-refresh-latest:${trigger}`;

  return jobsQueue.add(
    CONTINUOUS_LEARNING_SCHEDULE.jobName,
    {
      trigger,
      reason: input?.reason ?? null,
      forceFull: Boolean(input?.forceFull),
    },
    {
      jobId,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      delay: trigger === "schedule" ? 0 : 30 * 1000,
    }
  );
}

export async function ensureContinuousLearningSchedules() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);

  let createdCount = 0;
  let removedCount = 0;

  const existing = repeatables.filter((entry) => targetsSchedule(entry));
  const desired =
    existing.some((entry) => isDesiredEntry(entry)) || schedulers.some((entry) => isDesiredScheduler(entry));

  for (const entry of existing) {
    if (isDesiredEntry(entry)) continue;
    if (String(entry.key ?? "").trim()) {
      await jobsQueue.removeRepeatableByKey(String(entry.key));
      removedCount += 1;
    }
  }

  if (!desired) {
    await jobsQueue.add(CONTINUOUS_LEARNING_SCHEDULE.jobName, CONTINUOUS_LEARNING_SCHEDULE.payload, {
      jobId: CONTINUOUS_LEARNING_SCHEDULE.jobId,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      repeat: {
        every: CONTINUOUS_LEARNING_SCHEDULE.everyMs,
      },
    });
    createdCount += 1;
  }

  return {
    createdCount,
    removedCount,
    schedules: await getContinuousLearningScheduleSnapshot(),
  };
}

export async function getContinuousLearningScheduleSnapshot() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  const matchingRepeatables = repeatables.filter((entry) => isDesiredEntry(entry));
  const matchingSchedulers = schedulers.filter((entry) => isDesiredScheduler(entry));
  const nextRunMs = [...matchingSchedulers, ...matchingRepeatables]
    .map((entry) => Number(entry.next ?? Number.NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];

  return {
    stage: CONTINUOUS_LEARNING_SCHEDULE.stage,
    jobName: CONTINUOUS_LEARNING_SCHEDULE.jobName,
    jobId: CONTINUOUS_LEARNING_SCHEDULE.jobId,
    everyMs: CONTINUOUS_LEARNING_SCHEDULE.everyMs,
    active: matchingSchedulers.length > 0 || matchingRepeatables.length > 0,
    matchedEntries: matchingSchedulers.length + matchingRepeatables.length,
    nextRun: Number.isFinite(nextRunMs) ? new Date(nextRunMs).toISOString() : null,
    orchestrationOrder: [...CONTINUOUS_LEARNING_SCHEDULE.orchestrationOrder],
  };
}
