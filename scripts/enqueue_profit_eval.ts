import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";
import { JOB_NAMES, JOBS_QUEUE_NAME } from "../src/lib/jobNames";

async function run() {

  const q = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection });

  const job = await q.add(JOB_NAMES.EVAL_PROFIT, {});

  console.log("Queued EVAL_PROFIT job:", job.id);
}

run();
