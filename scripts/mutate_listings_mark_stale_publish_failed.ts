import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

function assertPreflight() {
  if (String(process.env.ALLOW_MUTATION_SCRIPTS ?? "false").toLowerCase() !== "true") {
    throw new Error(
      "Blocked: set ALLOW_MUTATION_SCRIPTS=true to run mutate_listings_mark_stale_publish_failed.ts"
    );
  }

  const env = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development").toLowerCase();
  const isProd = env === "production" || env === "prod";
  if (isProd && String(process.env.ALLOW_PROD_MUTATIONS ?? "false").toLowerCase() !== "true") {
    throw new Error(
      "Blocked in production: set ALLOW_PROD_MUTATIONS=true to acknowledge production mutation risk"
    );
  }
}

async function run() {
  assertPreflight();

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
