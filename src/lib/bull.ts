import { Queue, type ConnectionOptions, QueueEvents } from "bullmq";
import { JOBS, type JobName } from "@/src/lib/jobNames";
import { BULL_PREFIX, ENGINE_QUEUE_NAME } from "@/src/lib/queue";

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
  engine: new Queue(ENGINE_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
};

export const queueEvents = {
  engine: new QueueEvents(ENGINE_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  }),
};

export function jobNameFromUnknown(v: unknown): JobName {
  const s = String(v ?? "");
  const vals = Object.values(JOBS) as string[];
  if (!vals.includes(s)) throw new Error(`Invalid job name: ${s}`);
  return s as JobName;
}
