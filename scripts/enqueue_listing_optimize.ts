import "dotenv/config";
import { Queue } from "bullmq";
import { bullConnection } from "../src/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "../src/lib/jobs/jobNames";

async function main() {
  const queue = new Queue(JOBS_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  });

  try {
    const limit = Number(process.argv[2] ?? 25);
    const triggerSource = String(process.argv[3] ?? "manual-verify").trim() || "manual-verify";
    const jobId = `listing-optimize-manual-${Date.now()}`;

    const job = await queue.add(
      JOB_NAMES.LISTING_OPTIMIZE,
      { limit, triggerSource },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          jobId: job.id,
          jobName: job.name,
          limit,
          triggerSource,
          queue: JOBS_QUEUE_NAME,
          prefix: BULL_PREFIX,
        },
        null,
        2
      )
    );
  } finally {
    await queue.close();
  }
}

main().catch((error) => {
  console.error("Failed to enqueue LISTING_OPTIMIZE");
  console.error(error);
  process.exit(1);
});
