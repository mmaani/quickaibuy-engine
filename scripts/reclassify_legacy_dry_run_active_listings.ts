import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(`
    UPDATE listings
    SET
      status = 'PREVIEW',
      publish_marketplace = NULL,
      publish_started_ts = NULL,
      publish_finished_ts = NULL,
      published_external_id = NULL,
      last_publish_error = NULL,
      listing_date = NULL,
      updated_at = NOW()
    WHERE status = 'ACTIVE'
      AND published_external_id IS NULL
      AND (
        COALESCE((response->>'liveApiCalled')::boolean, false) = false
        OR COALESCE((response->>'preview')::boolean, false) = true
      )
    RETURNING
      id,
      candidate_id,
      marketplace_key,
      status,
      idempotency_key
  `);

  console.log("Reclassified legacy dry-run ACTIVE rows back to PREVIEW:");
  console.table(result.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
