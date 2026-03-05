import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

export const connection = new IORedis(redisUrl, {
  // BullMQ/ioredis recommended defaults vary; keep it minimal first.
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const engineQueue = new Queue("engine", { connection });
