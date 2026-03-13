import { Queue, type ConnectionOptions, QueueEvents } from "bullmq";
import { JOBS, type JobName, JOBS_QUEUE_NAME, BULL_PREFIX } from "@/src/lib/jobNames";
import { LEGACY_ENGINE_QUEUE_NAME } from "@/src/lib/queue";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error(
    "Missing REDIS_URL. Set it in .env.local (for local dev) or your runtime environment."
  );
}

export const bullConnection: ConnectionOptions = {
  url: redisUrl,
};

export const queues = {
  jobs: new Queue(JOBS_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
  legacyEngine: new Queue(LEGACY_ENGINE_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
};

export const jobsQueue = queues.jobs;

/**
 * @deprecated Use jobsQueue for operational APIs; kept for legacy engine-worker isolation.
 */
export const engineQueue = queues.legacyEngine;

export const queueEvents = {
  jobs: new QueueEvents(JOBS_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
  legacyEngine: new QueueEvents(LEGACY_ENGINE_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
};

export function jobNameFromUnknown(v: unknown): JobName {
  const s = String(v ?? "");
  const vals = Object.values(JOBS) as string[];
  if (!vals.includes(s)) {
    throw new Error(`Invalid job name: ${s}`);
  }
  return s as JobName;
}
