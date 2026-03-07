import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { Queue } from "bullmq";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";

async function main() {
  const queue = new Queue(JOBS_QUEUE_NAME, {
    connection: bullConnection,
    prefix: BULL_PREFIX,
  });

  const limit = Number(process.argv[2] || "100");
  const platformArg = String(process.argv[3] || "all").trim().toLowerCase();
  const productRawId = process.argv[4] ? String(process.argv[4]).trim() : undefined;

  const platform =
    platformArg === "amazon" || platformArg === "ebay" ? platformArg : "all";

  const jobId = productRawId
    ? `marketplace-scan-${platform}-${productRawId}`
    : `marketplace-scan-${platform}-${limit}`;

  const job = await queue.add(
    "SCAN_MARKETPLACE_PRICE",
    { limit, productRawId, platform },
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
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
        name: job.name,
        limit,
        platform,
        productRawId: productRawId ?? null,
      },
      null,
      2
    )
  );

  await queue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
