import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";
import { JOB_NAMES, JOBS_QUEUE_NAME } from "../src/lib/jobs/jobNames";

async function run() {
  const q = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection });

  try {
    const limit = Number(process.argv[2] ?? 500);
    const job = await q.add(JOB_NAMES.EVAL_PROFIT, { limit });
    console.log("Queued EVAL_PROFIT job:", job.id, "limit:", limit);
  } finally {
    await q.close();
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("Failed to enqueue EVAL_PROFIT job");
  console.error(err);
  process.exit(1);
});
