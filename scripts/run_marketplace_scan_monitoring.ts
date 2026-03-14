import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";

const STALE_HOURS = getPriceGuardThresholds().maxMarketplaceSnapshotAgeHours;
const HIGH_PRICE_THRESHOLD = Number(process.env.MARKETPLACE_HIGH_PRICE_THRESHOLD || "1000");
const REUSED_LISTING_ALERT_THRESHOLD = Number(
  process.env.MARKETPLACE_REUSED_LISTING_ALERT_THRESHOLD || "3"
);

async function main() {
  console.log("THREAD: Marketplace Price Scanner");
  console.log("MARKETPLACES ACTIVE: eBay");
  console.log(
    `CONFIG: staleThreshold=${STALE_HOURS}h (price guard aligned) highPriceThreshold=${HIGH_PRICE_THRESHOLD} reusedListingAlertThreshold=${REUSED_LISTING_ALERT_THRESHOLD}`
  );

  console.log("\n[0] V1 summary");
  const summary = await db.execute(sql`
    WITH latest_products AS (
      SELECT
        pr.id,
        ROW_NUMBER() OVER (
          PARTITION BY pr.supplier_key, pr.supplier_product_id
          ORDER BY pr.snapshot_ts DESC NULLS LAST, pr.id DESC
        ) AS rn
      FROM products_raw pr
    ),
    missing_latest AS (
      SELECT COUNT(*)::int AS missing_snapshots
      FROM latest_products lp
      LEFT JOIN LATERAL (
        SELECT mp.id
        FROM marketplace_prices mp
        WHERE mp.product_raw_id = lp.id
          AND LOWER(COALESCE(mp.marketplace_key, '')) = 'ebay'
        ORDER BY mp.snapshot_ts DESC, mp.id DESC
        LIMIT 1
      ) mp ON TRUE
      WHERE lp.rn = 1
        AND mp.id IS NULL
    ),
    duplicate_groups AS (
      SELECT COUNT(*)::int AS duplicate_key_groups
      FROM (
        SELECT 1
        FROM marketplace_prices
        WHERE LOWER(COALESCE(marketplace_key, '')) = 'ebay'
        GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
        HAVING COUNT(*) > 1
      ) dup
    ),
    reused_groups AS (
      SELECT COUNT(*)::int AS reused_listing_signals
      FROM (
        SELECT 1
        FROM marketplace_prices
        WHERE LOWER(COALESCE(marketplace_key, '')) = 'ebay'
        GROUP BY marketplace_key, marketplace_listing_id
        HAVING COUNT(DISTINCT product_raw_id) >= ${REUSED_LISTING_ALERT_THRESHOLD}
      ) reused
    )
    SELECT
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(mp.marketplace_key, '')) = 'ebay'
          AND mp.snapshot_ts >= NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS fresh_snapshots,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(mp.marketplace_key, '')) = 'ebay'
          AND mp.snapshot_ts < NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS stale_snapshots,
      MAX(mp.snapshot_ts) FILTER (
        WHERE LOWER(COALESCE(mp.marketplace_key, '')) = 'ebay'
      ) AS latest_snapshot_ts,
      (SELECT missing_snapshots FROM missing_latest) AS missing_snapshots,
      (SELECT duplicate_key_groups FROM duplicate_groups) AS duplicate_key_groups,
      (SELECT reused_listing_signals FROM reused_groups) AS reused_listing_signals
    FROM marketplace_prices mp
  `);
  console.log(summary.rows);

  console.log("\n[1] Total rows + rows by marketplace + latest snapshot");
  const totals = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (
        WHERE snapshot_ts >= NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS fresh_rows,
      COUNT(*) FILTER (
        WHERE snapshot_ts < NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS stale_rows
    FROM marketplace_prices
  `);
  console.log(totals.rows);

  const byMarketplace = await db.execute(sql`
    SELECT
      marketplace_key,
      COUNT(*)::int AS row_count,
      MAX(snapshot_ts) AS latest_snapshot_ts,
      COUNT(*) FILTER (
        WHERE snapshot_ts >= NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS fresh_rows,
      COUNT(*) FILTER (
        WHERE snapshot_ts < NOW() - (${STALE_HOURS} * INTERVAL '1 hour')
      )::int AS stale_rows,
      ROUND(AVG(final_match_score)::numeric, 4) AS avg_final_match_score
    FROM marketplace_prices
    GROUP BY marketplace_key
    ORDER BY row_count DESC, marketplace_key ASC
  `);
  console.log(byMarketplace.rows);

  console.log("\n[2] Missing-field and anomaly flags");
  const anomalyCounts = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE product_page_url IS NULL OR BTRIM(product_page_url) = '')::int AS missing_product_page_url,
      COUNT(*) FILTER (WHERE price IS NULL)::int AS missing_price,
      COUNT(*) FILTER (WHERE price = 0)::int AS zero_price,
      COUNT(*) FILTER (WHERE price > ${HIGH_PRICE_THRESHOLD})::int AS high_price,
      COUNT(*) FILTER (WHERE currency IS NULL OR BTRIM(currency) = '')::int AS missing_currency
    FROM marketplace_prices
  `);
  console.log(anomalyCounts.rows);

  console.log("\n[3] Duplicate logical keys (v1 identity check)");
  const duplicateKeys = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      COUNT(*)::int AS dup_count,
      MAX(snapshot_ts) AS latest_snapshot_ts
    FROM marketplace_prices
    GROUP BY marketplace_key, marketplace_listing_id, product_raw_id
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC, latest_snapshot_ts DESC
    LIMIT 50
  `);
  console.log(duplicateKeys.rows);

  console.log("\n[4] Reused listings across multiple supplier products");
  const reusedListings = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      COUNT(DISTINCT product_raw_id)::int AS distinct_products,
      MAX(snapshot_ts) AS latest_snapshot_ts,
      MAX(price) AS latest_max_price
    FROM marketplace_prices
    GROUP BY marketplace_key, marketplace_listing_id
    HAVING COUNT(DISTINCT product_raw_id) >= ${REUSED_LISTING_ALERT_THRESHOLD}
    ORDER BY distinct_products DESC, latest_snapshot_ts DESC
    LIMIT 50
  `);
  console.log(reusedListings.rows);

  console.log("\n[5] Recent price ranges and outlier candidates (last 24h)");
  const priceRange = await db.execute(sql`
    SELECT
      marketplace_key,
      MIN(price) AS min_price_24h,
      MAX(price) AS max_price_24h,
      ROUND(AVG(price)::numeric, 2) AS avg_price_24h,
      COUNT(*)::int AS rows_count_24h
    FROM marketplace_prices
    WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
      AND price IS NOT NULL
    GROUP BY marketplace_key
    ORDER BY marketplace_key ASC
  `);
  console.log(priceRange.rows);

  const outliers = await db.execute(sql`
    WITH recent AS (
      SELECT
        marketplace_key,
        marketplace_listing_id,
        product_raw_id,
        matched_title,
        price,
        currency,
        snapshot_ts,
        AVG(price) OVER (PARTITION BY marketplace_key) AS marketplace_avg_price
      FROM marketplace_prices
      WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
        AND price IS NOT NULL
    )
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      matched_title,
      price,
      marketplace_avg_price,
      ROUND((price / NULLIF(marketplace_avg_price, 0))::numeric, 2) AS avg_ratio,
      currency,
      snapshot_ts
    FROM recent
    WHERE marketplace_avg_price > 0
      AND (price >= marketplace_avg_price * 5 OR price <= marketplace_avg_price * 0.2)
    ORDER BY avg_ratio DESC NULLS LAST, snapshot_ts DESC
    LIMIT 30
  `);
  console.log(outliers.rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
