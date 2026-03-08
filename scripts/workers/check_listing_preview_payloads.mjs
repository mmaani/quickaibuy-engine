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
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.title,
      l.price,
      l.quantity,
      l.status,
      l.payload,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.marketplace_listing_id
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 10
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
