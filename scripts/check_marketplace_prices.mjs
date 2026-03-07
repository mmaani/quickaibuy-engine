import "dotenv/config";
import pg from "pg";

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
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      supplier_key,
      supplier_product_id,
      matched_title,
      price,
      shipping_price,
      currency,
      seller_name,
      availability_status,
      final_match_score,
      snapshot_ts
    FROM marketplace_prices
    ORDER BY snapshot_ts DESC
    LIMIT 20
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
