import { Queue } from "bullmq";
import { getBullConnection } from "./bullConnection";

export const ENGINE_QUEUE_NAME = "engine";

export const engineQueue = new Queue(ENGINE_QUEUE_NAME, {
  connection: getBullConnection(),
});
