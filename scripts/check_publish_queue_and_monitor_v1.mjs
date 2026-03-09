import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const ready = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_marketplace,
      published_external_id,
      publish_attempt_count,
      last_publish_error
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE', 'PUBLISH_FAILED')
    ORDER BY updated_at DESC
  `);

  console.log("\nPublish/monitor rows:");
  console.table(ready.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
