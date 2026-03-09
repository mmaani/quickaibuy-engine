import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  console.log("\n[1] Checking duplicates before cleanup...");
  const before = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      COUNT(*) AS dup_count,
      MAX(snapshot_ts) AS newest_snapshot_ts
    FROM marketplace_prices
    GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC, newest_snapshot_ts DESC
  `);
  console.log(before.rows);

  console.log("\n[2] Removing duplicates, keeping newest valid row first...");
  const deleted = await db.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY marketplace_key, marketplace_listing_id, product_raw_id
          ORDER BY
            CASE
              WHEN price IS NOT NULL
                AND price > 0
                AND currency IS NOT NULL
                AND BTRIM(currency) <> ''
                AND product_page_url IS NOT NULL
                AND BTRIM(product_page_url) <> ''
              THEN 1
              ELSE 0
            END DESC,
            snapshot_ts DESC,
            id DESC
        ) AS rn
      FROM marketplace_prices
    )
    DELETE FROM marketplace_prices
    WHERE id IN (
      SELECT id
      FROM ranked
      WHERE rn > 1
    )
    RETURNING id
  `);
  console.log(`Deleted rows: ${deleted.rows.length}`);

  console.log("\n[3] Checking duplicates after cleanup...");
  const after = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      COUNT(*) AS dup_count,
      MAX(snapshot_ts) AS newest_snapshot_ts
    FROM marketplace_prices
    GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC, newest_snapshot_ts DESC
  `);
  console.log(after.rows);

  console.log("\n[4] Creating unique index...");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS marketplace_prices_unique_listing_per_product
    ON marketplace_prices (marketplace_key, marketplace_listing_id, product_raw_id)
  `);
  console.log("Unique index ensured.");

  console.log("\n[5] Verifying unique index exists...");
  const indexes = await db.execute(sql`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'marketplace_prices'
      AND indexname = 'marketplace_prices_unique_listing_per_product'
  `);
  console.log(indexes.rows);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nMaintenance failed:");
  console.error(err);
  process.exit(1);
});
