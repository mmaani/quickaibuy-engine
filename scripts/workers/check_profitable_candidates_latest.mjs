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
        estimated_profit,
        margin_pct,
        roi_pct,
        decision_status,
        reason,
        calc_ts,
        ROW_NUMBER() OVER (
          PARTITION BY supplier_key, supplier_product_id, marketplace_key
          ORDER BY calc_ts DESC, id DESC
        ) AS rn
      FROM profitable_candidates
    )
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      estimated_profit,
      margin_pct,
      roi_pct,
      decision_status,
      reason,
      calc_ts
    FROM ranked
    WHERE rn = 1
    ORDER BY calc_ts DESC
    LIMIT 50
  `);

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
