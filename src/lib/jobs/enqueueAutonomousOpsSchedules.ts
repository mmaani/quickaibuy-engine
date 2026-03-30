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

const HOUR_MS = 60 * 60 * 1000;
const SCHEDULED_AUTONOMOUS_PUBLISH_ENABLED =
  String(process.env.ENABLE_SCHEDULED_AUTONOMOUS_PUBLISH ?? "false").trim().toLowerCase() === "true";

const BASE_AUTONOMOUS_OPS_SCHEDULES = [
  {
    stage: "diagnostics_refresh",
    jobName: JOB_NAMES.AUTONOMOUS_OPS_BACKBONE,
    jobId: "autonomous-ops-diagnostics-refresh-v1-6h",
    everyMs: 6 * HOUR_MS,
    payload: { phase: "diagnostics_refresh", triggerSource: "schedule" },
  },
  {
    stage: "prepare",
    jobName: JOB_NAMES.AUTONOMOUS_OPS_BACKBONE,
    jobId: "autonomous-ops-prepare-v1-2h",
    everyMs: 2 * HOUR_MS,
    payload: { phase: "prepare", triggerSource: "schedule" },
  },
  {
    stage: "publish",
    jobName: JOB_NAMES.AUTONOMOUS_OPS_BACKBONE,
    jobId: "autonomous-ops-publish-v1-30m",
    everyMs: 30 * 60 * 1000,
    payload: { phase: "publish", triggerSource: "schedule" },
  },
 ] as const;

export const AUTONOMOUS_OPS_SCHEDULES = BASE_AUTONOMOUS_OPS_SCHEDULES.filter((schedule) =>
  schedule.stage === "publish" ? SCHEDULED_AUTONOMOUS_PUBLISH_ENABLED : true
);

function isDesiredEntry(entry: RepeatableEntry, schedule: (typeof AUTONOMOUS_OPS_SCHEDULES)[number]) {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId) ||
      Boolean(entry.key))
  );
}

function isDesiredScheduler(entry: SchedulerEntry, schedule: (typeof AUTONOMOUS_OPS_SCHEDULES)[number]) {
  return (
    entry.name === schedule.jobName &&
    Number(entry.every ?? 0) === schedule.everyMs &&
    (String(entry.id ?? "") === schedule.jobId ||
      String(entry.key ?? "").includes(schedule.jobId) ||
      Boolean(entry.key))
  );
}

export async function ensureAutonomousOpsSchedules() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  let createdCount = 0;
  let removedCount = 0;

  const allAutonomousEntries = repeatables.filter(
    (entry) => entry.name === JOB_NAMES.AUTONOMOUS_OPS_BACKBONE && String(entry.key ?? "").includes("autonomous-ops-")
  );

  if (!SCHEDULED_AUTONOMOUS_PUBLISH_ENABLED) {
    for (const entry of allAutonomousEntries) {
      if (String(entry.key ?? "").includes("autonomous-ops-publish-") && String(entry.key ?? "").trim()) {
        await jobsQueue.removeRepeatableByKey(String(entry.key));
        removedCount += 1;
      }
    }
  }

  for (const schedule of AUTONOMOUS_OPS_SCHEDULES) {
    const existing = repeatables.filter(
      (entry) => entry.name === schedule.jobName && String(entry.key ?? "").includes("autonomous-ops-")
    );
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
        attempts: 1,
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
    scheduledAutonomousPublishEnabled: SCHEDULED_AUTONOMOUS_PUBLISH_ENABLED,
    schedules: await getAutonomousOpsScheduleSnapshot(),
  };
}

export async function getAutonomousOpsScheduleSnapshot() {
  const [repeatables, schedulers] = await Promise.all([
    jobsQueue.getRepeatableJobs(0, 1000) as Promise<RepeatableEntry[]>,
    jobsQueue.getJobSchedulers(0, 1000) as Promise<SchedulerEntry[]>,
  ]);
  return AUTONOMOUS_OPS_SCHEDULES.map((schedule) => {
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
