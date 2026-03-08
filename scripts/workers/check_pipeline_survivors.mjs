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

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
