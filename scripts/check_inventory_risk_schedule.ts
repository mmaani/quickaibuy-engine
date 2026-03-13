import "dotenv/config";
import { Queue, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, JOBS_QUEUE_NAME, JOB_NAMES } from "../src/lib/jobs/jobNames";
import { bullConnection } from "../src/lib/bull";

async function main() {
  const queue = new Queue(JOBS_QUEUE_NAME, {
    connection: bullConnection as ConnectionOptions,
    prefix: BULL_PREFIX,
  });

  const repeatables = await queue.getRepeatableJobs(0, 200);
  const inventoryRepeatables = repeatables.filter((job) => job.name === JOB_NAMES.INVENTORY_RISK_SCAN);
  const waiting = await queue.getWaiting(0, 50);
  const active = await queue.getActive(0, 50);

  console.log("INVENTORY_RISK_REPEATABLES");
  console.dir(
    inventoryRepeatables.map((job) => ({
      key: job.key,
      id: job.id,
      every: job.every,
      pattern: job.pattern ?? null,
      next: job.next ?? null,
    })),
    { depth: null }
  );

  console.log("INVENTORY_RISK_WAITING");
  console.dir(
    waiting
      .filter((job) => job.name === JOB_NAMES.INVENTORY_RISK_SCAN)
      .map((job) => ({ id: job.id, name: job.name, data: job.data })),
    { depth: null }
  );

  console.log("INVENTORY_RISK_ACTIVE");
  console.dir(
    active
      .filter((job) => job.name === JOB_NAMES.INVENTORY_RISK_SCAN)
      .map((job) => ({ id: job.id, name: job.name, data: job.data })),
    { depth: null }
  );

  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
