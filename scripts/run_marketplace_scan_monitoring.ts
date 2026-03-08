import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  console.log("\n[1] Recent marketplace rows by platform");
  const recentByPlatform = await db.execute(sql`
    SELECT
      marketplace_key,
      COUNT(*) AS row_count,
      MAX(snapshot_ts) AS latest_snapshot_ts
    FROM marketplace_prices
    GROUP BY marketplace_key
    ORDER BY latest_snapshot_ts DESC
  `);
  console.log(recentByPlatform.rows);

  console.log("\n[2] Average scores by platform");
  const avgScores = await db.execute(sql`
    SELECT
      marketplace_key,
      ROUND(AVG(final_match_score)::numeric, 4) AS avg_final_match_score,
      ROUND(AVG(title_similarity_score)::numeric, 4) AS avg_title_similarity_score,
      ROUND(AVG(keyword_score)::numeric, 4) AS avg_keyword_score
    FROM marketplace_prices
    GROUP BY marketplace_key
    ORDER BY avg_final_match_score DESC
  `);
  console.log(avgScores.rows);

  console.log("\n[3] Listing reuse across different supplier products");
  const reusedListings = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      COUNT(DISTINCT product_raw_id) AS distinct_products,
      MAX(snapshot_ts) AS latest_snapshot_ts
    FROM marketplace_prices
    GROUP BY marketplace_key, marketplace_listing_id
    HAVING COUNT(DISTINCT product_raw_id) > 1
    ORDER BY distinct_products DESC, latest_snapshot_ts DESC
    LIMIT 20
  `);
  console.log(reusedListings.rows);

  console.log("\n[4] Highest scoring recent rows");
  const topScores = await db.execute(sql`
    SELECT
      marketplace_key,
      marketplace_listing_id,
      product_raw_id,
      matched_title,
      price,
      final_match_score,
      snapshot_ts
    FROM marketplace_prices
    ORDER BY final_match_score DESC NULLS LAST, snapshot_ts DESC
    LIMIT 20
  `);
  console.log(topScores.rows);

  console.log("\n[5] Recent activity by hour");
  const hourly = await db.execute(sql`
    SELECT
      DATE_TRUNC('hour', snapshot_ts) AS hour_bucket,
      COUNT(*) AS rows_count
    FROM marketplace_prices
    WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
    GROUP BY hour_bucket
    ORDER BY hour_bucket DESC
  `);
  console.log(hourly.rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
