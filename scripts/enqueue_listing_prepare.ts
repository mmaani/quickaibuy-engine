import dotenv from "dotenv";
import { assertNonCanonicalScriptAccess } from "./lib/nonCanonicalSurfaceGuard";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  await assertNonCanonicalScriptAccess({
    scriptName: "enqueue_listing_prepare.ts",
    blockedAction: "enqueue_listing_prepare",
    canonicalAction: "typed control-plane enqueue wrappers only",
    mutatesState: true,
  });

  const { Queue } = await import("bullmq");
  const { bullConnection } = await import("../src/lib/bull");
  const { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } = await import("../src/lib/jobNames");

  const limit = Number(process.argv[2] || "20");
  const marketplace = (process.argv[3] || "ebay") as "ebay" | "amazon";
  const forceRefresh = String(process.argv[4] || "").toLowerCase() === "true";

  const queue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });

  const job = await queue.add(
    JOB_NAMES.LISTING_PREPARE,
    { limit, marketplace, forceRefresh },
    {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId: job.id,
        name: JOB_NAMES.LISTING_PREPARE,
        limit,
        marketplace,
        forceRefresh,
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
