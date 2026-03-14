import dotenv from "dotenv";
import { withPgClient } from "../lib/pgRetry.mjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const rows = await withPgClient(async (client) => {
    const result = await client.query(`
      SELECT
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        decision_status,
        estimated_profit,
        margin_pct,
        roi_pct,
        calc_ts
      FROM profitable_candidates
      ORDER BY calc_ts DESC
    `);
    return result.rows;
  });

  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.decision_status === "PENDING").length,
    approved: rows.filter((r) => r.decision_status === "APPROVED").length,
    rejected: rows.filter((r) => r.decision_status === "REJECTED").length,
  };

  console.log(JSON.stringify({ summary, rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
