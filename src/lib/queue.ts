import { Queue } from "bullmq";
import { getBullConnection } from "./bullConnection";
import { assertSafeQueueNamespace, resolveBullPrefix } from "./queueNamespace";

export const ENGINE_QUEUE_NAME = process.env.ENGINE_QUEUE_NAME || "engine";

assertSafeQueueNamespace("engine-queue");
export const BULL_PREFIX = resolveBullPrefix();

export const engineQueue = new Queue(ENGINE_QUEUE_NAME, {
  connection: getBullConnection(),
  prefix: BULL_PREFIX,
});
