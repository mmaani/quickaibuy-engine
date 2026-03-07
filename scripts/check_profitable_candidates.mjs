import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const res = await client.query(`
    SELECT
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      estimated_fees,
      estimated_shipping,
      estimated_cogs,
      estimated_profit,
      margin_pct,
      roi_pct,
      risk_flags,
      decision_status,
      reason,
      calc_ts
    FROM profitable_candidates
    ORDER BY calc_ts DESC
    LIMIT 20
  `);

  console.table(res.rows);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
