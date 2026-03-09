import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = await client.query(`
    SELECT id, candidate_id, marketplace_key, status, publish_attempt_count, updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'READY_TO_PUBLISH'
    ORDER BY updated_at DESC
    LIMIT 50
  `);

  console.table(rows.rows);
  console.log(`READY_TO_PUBLISH count: ${rows.rows.length}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
