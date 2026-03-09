import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = await client.query(`
    SELECT
      id,
      status,
      publish_marketplace,
      published_external_id,
      publish_attempt_count,
      last_publish_error,
      publish_started_ts,
      publish_finished_ts,
      listing_date,
      updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status IN ('PUBLISH_IN_PROGRESS', 'ACTIVE', 'PUBLISH_FAILED')
    ORDER BY updated_at DESC
    LIMIT 100
  `);

  console.table(rows.rows);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
