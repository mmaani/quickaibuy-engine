import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = await client.query(`
    SELECT id, status, publish_marketplace, published_external_id, publish_attempt_count, updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'ACTIVE'
      AND published_external_id IS NULL
    ORDER BY updated_at DESC
    LIMIT 100
  `);

  console.table(rows.rows);
  console.log(`ACTIVE missing published_external_id: ${rows.rows.length}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
