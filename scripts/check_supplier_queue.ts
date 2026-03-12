import "dotenv/config";
import { lookup } from "node:dns/promises";
import { Queue, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "../src/lib/jobs/jobNames";

type ConnectivityResult = {
  ok: boolean;
  reason?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutReason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutReason)), ms);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function classifyConnectivityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("eai_again") || lowered.includes("enotfound") || lowered.includes("dns")) {
    return "DNS lookup failure";
  }
  if (lowered.includes("econnrefused") || lowered.includes("etimedout") || lowered.includes("unreachable")) {
    return "Redis unreachable";
  }
  return message;
}

async function preflightQueueConnectivity(): Promise<ConnectivityResult> {
  const redisUrl = String(process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) {
    return {
      ok: false,
      reason: "REDIS_URL missing",
    };
  }

  let host = "";
  try {
    host = new URL(redisUrl).hostname;
  } catch {
    return {
      ok: false,
      reason: "REDIS_URL invalid",
    };
  }

  try {
    await withTimeout(lookup(host), 2000, "DNS lookup timeout");
  } catch (error) {
    return {
      ok: false,
      reason: classifyConnectivityError(error),
    };
  }

  const queue = new Queue(JOBS_QUEUE_NAME, {
    connection: {
      url: redisUrl,
      connectTimeout: 2500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    },
    prefix: BULL_PREFIX,
  });

  try {
    const client = await withTimeout(queue.client, 3000, "Redis connect timeout");
    await withTimeout(client.ping(), 2000, "Redis ping timeout");
    await queue.close();
    return { ok: true };
  } catch (error) {
    await queue.close().catch(() => {});
    return {
      ok: false,
      reason: classifyConnectivityError(error),
    };
  }
}

async function main() {
  const redisUrl = String(process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) {
    console.log("QUEUE_CONNECTIVITY = FAILED");
    console.log("reason = REDIS_URL missing");
    return;
  }

  const connection: ConnectionOptions = {
    url: redisUrl,
    connectTimeout: 2500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };

  const connectivity = await preflightQueueConnectivity();
  if (!connectivity.ok) {
    console.log("QUEUE_CONNECTIVITY = FAILED");
    console.log(`reason = ${connectivity.reason ?? "Redis unreachable"}`);
    return;
  }

  console.log("QUEUE_CONNECTIVITY = OK");
  const queue = new Queue(JOBS_QUEUE_NAME, { connection, prefix: BULL_PREFIX });

  const waiting = await queue.getWaiting();
  const active = await queue.getActive();
  const completed = await queue.getCompleted();
  const failed = await queue.getFailed();

  console.log("WAITING");
  console.dir(waiting.map((j) => ({ id: j.id, name: j.name, data: j.data })), { depth: null });

  console.log("ACTIVE");
  console.dir(active.map((j) => ({ id: j.id, name: j.name, data: j.data })), { depth: null });

  console.log("COMPLETED");
  console.dir(
    completed.slice(0, 10).map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      returnvalue: j.returnvalue,
    })),
    { depth: null }
  );

  console.log("FAILED");
  console.dir(
    failed.slice(0, 10).map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      stacktrace: j.stacktrace,
    })),
    { depth: null }
  );

  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
