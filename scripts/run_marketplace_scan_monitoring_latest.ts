import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  console.log("\n[1] Latest row per unique marketplace/product key");
  const latestRows = await db.execute(sql`
    WITH ranked AS (
      SELECT
        marketplace_key,
        marketplace_listing_id,
        product_raw_id,
        matched_title,
        price,
        final_match_score,
        snapshot_ts,
        ROW_NUMBER() OVER (
          PARTITION BY marketplace_key, marketplace_listing_id, product_raw_id
          ORDER BY snapshot_ts DESC
        ) AS rn
      FROM marketplace_prices
    )
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      matched_title,
      price,
      final_match_score,
      snapshot_ts
    FROM ranked
    WHERE rn = 1
    ORDER BY final_match_score DESC NULLS LAST, snapshot_ts DESC
    LIMIT 30
  `);
  console.log(latestRows.rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
