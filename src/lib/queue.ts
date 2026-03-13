import { Queue } from "bullmq";
import { getBullConnection } from "./bullConnection";
import { assertSafeQueueNamespace, resolveBullPrefix } from "./queueNamespace";

/**
 * Legacy queue consumed by engine.worker.
 * Operational APIs should use JOBS_QUEUE_NAME consumed by jobs.worker.
 */
export const LEGACY_ENGINE_QUEUE_NAME = process.env.ENGINE_QUEUE_NAME || "engine";
export const ENGINE_QUEUE_NAME = LEGACY_ENGINE_QUEUE_NAME;

assertSafeQueueNamespace("engine-queue");
export const BULL_PREFIX = resolveBullPrefix();

export const engineQueue = new Queue(LEGACY_ENGINE_QUEUE_NAME, {
  connection: getBullConnection(),
  prefix: BULL_PREFIX,
});
