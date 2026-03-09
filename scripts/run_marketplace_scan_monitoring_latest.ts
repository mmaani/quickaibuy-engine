import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  console.log("[latest-snapshot-check] marketplace_prices latest rows per v1 key");

  const latestRows = await db.execute(sql`
    WITH ranked AS (
      SELECT
        marketplace_key,
        marketplace_listing_id,
        product_raw_id,
        matched_title,
        price,
        currency,
        final_match_score,
        snapshot_ts,
        ROW_NUMBER() OVER (
          PARTITION BY marketplace_key, marketplace_listing_id, product_raw_id
          ORDER BY snapshot_ts DESC, id DESC
        ) AS rn
      FROM marketplace_prices
    )
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      matched_title,
      price,
      currency,
      final_match_score,
      snapshot_ts
    FROM ranked
    WHERE rn = 1
    ORDER BY snapshot_ts DESC
    LIMIT 30
  `);
  console.log(latestRows.rows);

  const duplicateKeys = await db.execute(sql`
    SELECT COUNT(*)::int AS duplicate_key_groups
    FROM (
      SELECT 1
      FROM marketplace_prices
      GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
      HAVING COUNT(*) > 1
    ) d
  `);
  console.log("[latest-snapshot-check] duplicate key groups", duplicateKeys.rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
