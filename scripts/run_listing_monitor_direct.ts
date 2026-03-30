import dotenv from "dotenv";
import { assertNonCanonicalScriptAccess } from "./lib/nonCanonicalSurfaceGuard";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  await assertNonCanonicalScriptAccess({
    scriptName: "run_listing_monitor_direct.ts",
    blockedAction: "run_listing_monitor_direct",
    canonicalAction: "pnpm runtime:diag and /admin/control visibility",
    mutatesState: false,
  });

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const staleRows = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_started_ts,
      publish_attempt_count,
      last_publish_error,
      updated_at
    FROM listings
    WHERE status = 'PUBLISH_IN_PROGRESS'
      AND publish_started_ts < NOW() - INTERVAL '30 minutes'
    ORDER BY publish_started_ts ASC
  `);

  const counts = await client.query(`
    SELECT
      status,
      COUNT(*)::int AS count
    FROM listings
    WHERE marketplace_key = 'ebay'
    GROUP BY status
    ORDER BY status
  `);

  const failedRows = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_attempt_count,
      last_publish_error,
      publish_finished_ts,
      updated_at
    FROM listings
    WHERE status = 'PUBLISH_FAILED'
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  const activeRows = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      published_external_id,
      listing_date,
      publish_finished_ts,
      updated_at
    FROM listings
    WHERE status = 'ACTIVE'
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  console.log("listing lifecycle counts:");
  console.table(counts.rows);

  console.log("stale PUBLISH_IN_PROGRESS rows:");
  console.table(staleRows.rows);
  console.log(`stale in-progress count (30m): ${staleRows.rows.length}`);

  console.log("recent PUBLISH_FAILED rows:");
  console.table(failedRows.rows);

  console.log("recent ACTIVE rows:");
  console.table(activeRows.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
