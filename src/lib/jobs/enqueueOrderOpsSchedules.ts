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

type OrderOpsSchedule = {
  stage: "order_sync" | "tracking_sync";
  jobName: string;
  jobId: string;
  everyMs: number;
  payload: Record<string, unknown>;
};

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

const MINUTE_MS = 60 * 1000;

export const ORDER_OPS_SCHEDULES: OrderOpsSchedule[] = [
  {
    stage: "order_sync",
    jobName: JOB_NAMES.ORDER_SYNC,
    jobId: "order-sync-recurring-v1-30m",
    everyMs: 30 * MINUTE_MS,
    payload: {
      limit: Number(process.env.ORDER_SYNC_FETCH_LIMIT ?? 25),
      lookbackHours: Number(process.env.ORDER_SYNC_LOOKBACK_HOURS ?? 48),
      triggerSource: "schedule",
    },
  },
  {
    stage: "tracking_sync",
    jobName: JOB_NAMES.TRACKING_SYNC,
    jobId: "tracking-sync-recurring-v1-60m",
    everyMs: 60 * MINUTE_MS,
    payload: {
      limit: Number(process.env.TRACKING_SYNC_LIMIT ?? 20),
      triggerSource: "schedule",
    },
  },
];

function isDesiredEntry(entry: RepeatableEntry, schedule: OrderOpsSchedule): boolean {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId) ||
      Boolean(entry.key))
  );
}

function isDesiredScheduler(entry: SchedulerEntry, schedule: OrderOpsSchedule): boolean {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId) ||
      Boolean(entry.key))
  );
}

function targetsSchedule(entry: RepeatableEntry, schedule: OrderOpsSchedule): boolean {
  return (
    entry.name === schedule.jobName &&
    (String(entry.id ?? "").startsWith(`${schedule.stage}-`) ||
      String(entry.key ?? "").includes(`${schedule.stage}-`) ||
      String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId))
  );
}

export async function getOrderOpsScheduleSnapshot() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  return ORDER_OPS_SCHEDULES.map((schedule) => {
    const matchingRepeatables = repeatables.filter((entry) => isDesiredEntry(entry, schedule));
    const matchingSchedulers = schedulers.filter((entry) => isDesiredScheduler(entry, schedule));
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
}

export async function ensureOrderOpsSchedules() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  let createdCount = 0;
  let removedCount = 0;

  for (const schedule of ORDER_OPS_SCHEDULES) {
    const existing = repeatables.filter((entry) => targetsSchedule(entry, schedule));
    const desired =
      existing.some((entry) => isDesiredEntry(entry, schedule)) ||
      schedulers.some((entry) => isDesiredScheduler(entry, schedule));

    for (const entry of existing) {
      if (isDesiredEntry(entry, schedule)) continue;
      if (String(entry.key ?? "").trim()) {
        await jobsQueue.removeRepeatableByKey(String(entry.key));
        removedCount += 1;
      }
    }

    if (!desired) {
      await jobsQueue.add(schedule.jobName, schedule.payload, {
        jobId: schedule.jobId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        repeat: { every: schedule.everyMs },
      });
      createdCount += 1;
    }
  }

  return {
    createdCount,
    removedCount,
    schedules: await getOrderOpsScheduleSnapshot(),
  };
}
