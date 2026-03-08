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
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      estimated_profit,
      margin_pct,
      roi_pct,
      decision_status,
      calc_ts
    FROM profitable_candidates
    WHERE decision_status = 'APPROVED'
    ORDER BY calc_ts DESC
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
