import { Queue, Worker, type Processor } from "bullmq";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

export const connection = { url: redisUrl };

export function getQueue(name: string) {
  return new Queue(name, { connection });
}

export function makeWorker(
  name: string,
  handler: Processor,
  concurrency = 5
) {
  return new Worker(name, handler, { connection, concurrency });
}
