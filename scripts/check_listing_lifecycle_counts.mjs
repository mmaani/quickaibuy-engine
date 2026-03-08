import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const counts = await client.query(`
    SELECT status, COUNT(*)::int AS count
    FROM listings
    GROUP BY status
    ORDER BY status
  `);

  const readyRows = await client.query(`
    SELECT
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.status,
      l.publish_marketplace,
      l.idempotency_key,
      pc.decision_status,
      pc.listing_eligible
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.status IN ('PREVIEW', 'READY_TO_PUBLISH', 'ACTIVE', 'PUBLISH_FAILED')
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 20
  `);

  console.log("\nListing lifecycle counts:");
  console.table(counts.rows);

  console.log("\nLifecycle rows:");
  console.table(readyRows.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
