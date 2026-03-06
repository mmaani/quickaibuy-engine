import { Queue, type ConnectionOptions, QueueEvents } from "bullmq";
import { JOBS, type JobName } from "@/src/lib/jobNames";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

export const bullConnection: ConnectionOptions = {
  url: redisUrl,
};

export const queues = {
  engine: new Queue("engine", { connection: bullConnection }),
};

export const queueEvents = {
  engine: new QueueEvents("engine", { connection: bullConnection }),
};

export function jobNameFromUnknown(v: unknown): JobName {
  const s = String(v ?? "");
  const vals = Object.values(JOBS) as string[];
  if (!vals.includes(s)) throw new Error(`Invalid job name: ${s}`);
  return s as JobName;
}
