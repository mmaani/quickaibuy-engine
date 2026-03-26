import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

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

type StageSchedule = {
  stage: "trend" | "supplier" | "marketplace" | "matching" | "profit" | "listing_performance";
  jobName: string;
  jobId: string;
  everyMs: number;
  payload: Record<string, unknown>;
};

const HOUR_MS = 60 * 60 * 1000;

const UPSTREAM_STAGE_SCHEDULES: StageSchedule[] = [
  {
    stage: "trend",
    jobName: JOB_NAMES.TREND_EXPAND_REFRESH,
    jobId: "trend-expand-refresh-recurring-v1-6h",
    everyMs: 6 * HOUR_MS,
    payload: { limit: 25, triggerSource: "schedule" },
  },
  {
    stage: "supplier",
    jobName: JOB_NAMES.SUPPLIER_DISCOVER,
    jobId: "supplier-discover-recurring-v1-6h",
    everyMs: 6 * HOUR_MS,
    payload: { limitPerKeyword: 20, reason: "recurring-refresh", triggerSource: "schedule" },
  },
  {
    stage: "marketplace",
    jobName: JOB_NAMES.SCAN_MARKETPLACE_PRICE,
    jobId: "marketplace-scan-recurring-v1-4h",
    everyMs: 4 * HOUR_MS,
    payload: { limit: 100, platform: "ebay", triggerSource: "schedule" },
  },
  {
    stage: "matching",
    jobName: JOB_NAMES.MATCH_PRODUCT,
    jobId: "match-product-recurring-v1-4h",
    everyMs: 4 * HOUR_MS,
    payload: { limit: 100, triggerSource: "schedule" },
  },
  {
    stage: "profit",
    jobName: JOB_NAMES.EVAL_PROFIT,
    jobId: "eval-profit-recurring-v1-4h",
    everyMs: 4 * HOUR_MS,
    payload: { limit: 100, triggerSource: "schedule" },
  },
  {
    stage: "listing_performance",
    jobName: JOB_NAMES.LISTING_OPTIMIZE,
    jobId: "listing-optimize-recurring-v1-6h",
    everyMs: 6 * HOUR_MS,
    payload: { limit: 25, triggerSource: "schedule" },
  },
];

function isDesiredEntry(entry: RepeatableEntry, schedule: StageSchedule): boolean {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (
      String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId) ||
      Boolean(entry.key)
    )
  );
}

function isDesiredScheduler(entry: SchedulerEntry, schedule: StageSchedule): boolean {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (String(entry.id ?? "") === schedule.jobId || String(entry.key ?? "").includes(schedule.jobId))
  );
}

function stagePrefix(stage: StageSchedule): string {
  return `${stage.stage}-`;
}

function targetsStage(entry: RepeatableEntry, schedule: StageSchedule): boolean {
  if (entry.name !== schedule.jobName) return false;
  const stageIdPrefix = stagePrefix(schedule);
  return (
    String(entry.id ?? "").startsWith(stageIdPrefix) ||
    String(entry.id ?? "") === schedule.jobId ||
    String(entry.key ?? "").includes(stageIdPrefix) ||
    String(entry.key ?? "").includes(schedule.jobId) ||
    Number(entry.every ?? 0) === schedule.everyMs
  );
}

export async function ensureUpstreamRecurringSchedules() {
  const repeatableJobs = (await jobsQueue.getRepeatableJobs(0, 1000)) as RepeatableEntry[];
  const schedulers = (await jobsQueue.getJobSchedulers(0, 1000)) as SchedulerEntry[];
  let removedCount = 0;
  let createdCount = 0;

  for (const schedule of UPSTREAM_STAGE_SCHEDULES) {
    let desiredSeen =
      schedulers.some((entry) => isDesiredScheduler(entry, schedule)) ||
      repeatableJobs.some((entry) => isDesiredEntry(entry, schedule));

    for (const entry of repeatableJobs) {
      if (!targetsStage(entry, schedule)) continue;

      if (isDesiredEntry(entry, schedule)) {
        desiredSeen = true;
        continue;
      }

      if (String(entry.key ?? "").trim()) {
        await jobsQueue.removeRepeatableByKey(String(entry.key));
        removedCount += 1;
      }
    }

    if (!desiredSeen) {
      await jobsQueue.add(schedule.jobName, schedule.payload, {
        jobId: schedule.jobId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        repeat: {
          every: schedule.everyMs,
        },
      });
      createdCount += 1;
    }
  }

  const [repeatableSnapshot, schedulerSnapshot] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  const schedules = UPSTREAM_STAGE_SCHEDULES.map((schedule) => {
    const matchingRepeatables = repeatableSnapshot.filter((entry) => isDesiredEntry(entry, schedule));
    const matchingSchedulers = schedulerSnapshot.filter((entry) => isDesiredScheduler(entry, schedule));
    const nextRunMs = [...matchingSchedulers, ...matchingRepeatables]
      .map((entry) => Number(entry.next ?? NaN))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b)[0];

    return {
      stage: schedule.stage,
      jobName: schedule.jobName,
      jobId: schedule.jobId,
      everyMs: schedule.everyMs,
      active: matchingSchedulers.length > 0 || matchingRepeatables.length > 0,
      matchedEntries: matchingSchedulers.length + matchingRepeatables.length,
      nextRun: Number.isFinite(nextRunMs) ? new Date(nextRunMs).toISOString() : null,
    };
  });

  return {
    removedCount,
    createdCount,
    schedules,
  };
}
