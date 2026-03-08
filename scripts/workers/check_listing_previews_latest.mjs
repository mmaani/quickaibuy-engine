import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const { rows } = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      external_listing_id,
      title,
      price,
      quantity,
      status,
      idempotency_key,
      created_at,
      updated_at
    FROM listings
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 20
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
