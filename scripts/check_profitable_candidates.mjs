import dotenv from "dotenv";
import { withPgClient } from "./lib/pgRetry.mjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const rows = await withPgClient(async (client) => {
    const result = await client.query(`
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
      FROM profitable_candidates
      ORDER BY calc_ts DESC
      LIMIT 20
    `);
    return result.rows;
  });

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
