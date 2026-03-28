import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

async function run() {
  loadRuntimeEnv();
  assertMutationAllowed("mutate_listings_mark_stale_publish_failed.ts");

  const result = await db.execute(sql`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = 'stale publish worker timeout',
      updated_at = NOW()
    WHERE status = 'PUBLISH_IN_PROGRESS'
      AND publish_started_ts < NOW() - INTERVAL '30 minutes'
    RETURNING id
  `);

  console.log("stale rows fixed:", result.rows.length);
}

run()
  .then(() => process.exit())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
