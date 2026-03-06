import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";

async function main() {
  const queue = new Queue("jobs", { connection: bullConnection });

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
