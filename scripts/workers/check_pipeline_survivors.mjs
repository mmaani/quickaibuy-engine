import dotenv from "dotenv";
import { withPgClient } from "../lib/pgRetry.mjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const rows = await withPgClient(async (client) => {
    const result = await client.query(`
      SELECT
        pc.supplier_key,
        pc.supplier_product_id,
        pc.marketplace_key,
        pc.marketplace_listing_id,
        pc.estimated_profit,
        pc.margin_pct,
        pc.roi_pct,
        pc.decision_status,
        pc.reason,
        m.match_type,
        m.confidence,
        m.evidence,
        mp.matched_title,
        mp.price,
        mp.product_page_url,
        mp.snapshot_ts
      FROM profitable_candidates pc
      LEFT JOIN matches m
        ON m.supplier_key = pc.supplier_key
        AND m.supplier_product_id = pc.supplier_product_id
        AND m.marketplace_key = pc.marketplace_key
        AND m.marketplace_listing_id = pc.marketplace_listing_id
      LEFT JOIN marketplace_prices mp
        ON mp.id = pc.market_price_snapshot_id
      ORDER BY pc.calc_ts DESC
    `);
    return result.rows;
  });

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
