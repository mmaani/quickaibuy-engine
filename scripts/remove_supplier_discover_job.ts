import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";

async function main() {
  const queue = new Queue("jobs", { connection: bullConnection });

  const job = await queue.getJob("supplier-discover-latest");

  if (!job) {
    console.log("No job found with id supplier-discover-latest");
    await queue.close();
    return;
  }

  console.log("Found job:", {
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
  });

  await job.remove();
  console.log("Removed job supplier-discover-latest");

  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
