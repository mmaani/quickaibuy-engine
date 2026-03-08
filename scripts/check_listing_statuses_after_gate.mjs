import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const statuses = await client.query(`
    SELECT status, COUNT(*)::int AS count
    FROM listings
    GROUP BY status
    ORDER BY status
  `);

  const previews = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      idempotency_key,
      created_at,
      updated_at
    FROM listings
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  console.log("\\nListing status counts:");
  console.table(statuses.rows);

  console.log("\\nLatest listings:");
  console.table(previews.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
