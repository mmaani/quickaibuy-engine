import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";
import { JOB_NAMES } from "../src/lib/jobNames";

async function main() {
  const queue = new Queue("jobs", { connection: bullConnection });

  const job = await queue.add(
    JOB_NAMES.SUPPLIER_DISCOVER,
    { limitPerKeyword: 20 },
    {
      jobId: "supplier-discover-latest",
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      }
    }
  );

  console.log("Enqueued supplier discover job:", job.id, job.name);
  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
