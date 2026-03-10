import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";

const { Client } = pg;

async function main() {
  const mode = String(process.argv[2] || "report").trim().toLowerCase();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const staleQuery = `
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_marketplace,
      publish_started_ts,
      publish_finished_ts,
      publish_attempt_count,
      last_publish_error,
      updated_at
    FROM listings
    WHERE status = 'PUBLISH_IN_PROGRESS'
      AND updated_at < NOW() - INTERVAL '30 minutes'
    ORDER BY updated_at ASC
  `;

  const stale = await client.query(staleQuery);

  console.log("\nStale PUBLISH_IN_PROGRESS rows:");
  console.table(stale.rows);

  if (mode !== "fix") {
    console.log("\nMode = report only. Pass 'fix' to reset stale rows.");
    await client.end();
    return;
  }

  const fixed = await client.query(`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      publish_finished_ts = NOW(),
      last_publish_error = COALESCE(last_publish_error, 'stale PUBLISH_IN_PROGRESS row reset by cleanup script'),
      updated_at = NOW()
    WHERE status = 'PUBLISH_IN_PROGRESS'
      AND updated_at < NOW() - INTERVAL '30 minutes'
    RETURNING
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_attempt_count,
      last_publish_error,
      updated_at
  `);

  console.log("\nReset rows:");
  console.table(fixed.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
