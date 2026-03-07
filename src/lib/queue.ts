import { Queue } from "bullmq";
import { getBullConnection } from "./bullConnection";

export const ENGINE_QUEUE_NAME = process.env.ENGINE_QUEUE_NAME || "engine";
export const BULL_PREFIX = process.env.BULL_PREFIX || "qaib";

export const engineQueue = new Queue(ENGINE_QUEUE_NAME, {
  connection: getBullConnection(),
  prefix: BULL_PREFIX,
});
