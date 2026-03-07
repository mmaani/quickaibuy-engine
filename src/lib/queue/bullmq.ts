import { Queue, Worker, type Processor } from "bullmq";
import { BULL_PREFIX } from "@/src/lib/queue";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Missing REDIS_URL");

export const connection = { url: redisUrl };

export function getQueue(name: string) {
  return new Queue(name, { connection, prefix: BULL_PREFIX });
}

export function makeWorker(
  name: string,
  handler: Processor,
  concurrency = 5
) {
  return new Worker(name, handler, {
    connection,
    concurrency,
    prefix: BULL_PREFIX,
  });
}
