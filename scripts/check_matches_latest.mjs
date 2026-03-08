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
    WITH ranked AS (
      SELECT
        id,
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        match_type,
        confidence,
        status,
        evidence,
        first_seen_ts,
        last_seen_ts,
        ROW_NUMBER() OVER (
          PARTITION BY supplier_key, supplier_product_id, marketplace_key
          ORDER BY confidence DESC, last_seen_ts DESC
        ) AS rn
      FROM matches
      WHERE status = 'ACTIVE'
    )
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      match_type,
      confidence,
      status,
      evidence,
      first_seen_ts,
      last_seen_ts
    FROM ranked
    WHERE rn = 1
    ORDER BY confidence DESC, last_seen_ts DESC
    LIMIT 50
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});