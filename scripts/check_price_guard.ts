import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { validateProfitSafety } from "../src/lib/profit/priceGuard";

async function main() {
  const limit = Number(process.argv[2] ?? 20);

  const candidates = await db.execute<{
    id: string;
    supplier_key: string;
    supplier_product_id: string;
    marketplace_key: string;
    marketplace_listing_id: string;
    decision_status: string;
    listing_eligible: boolean;
    calc_ts: Date | string;
  }>(sql`
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      decision_status,
      listing_eligible,
      calc_ts
    FROM profitable_candidates
    ORDER BY calc_ts DESC
    LIMIT ${limit}
  `);

  const output: Array<Record<string, unknown>> = [];

  for (const row of candidates.rows ?? []) {
    const result = await validateProfitSafety({
      candidateId: row.id,
      mode: "publish",
    });

    output.push({
      candidate_id: row.id,
      supplier_key: row.supplier_key,
      supplier_product_id: row.supplier_product_id,
      marketplace_key: row.marketplace_key,
      marketplace_listing_id: row.marketplace_listing_id,
      current_decision_status: row.decision_status,
      current_listing_eligible: row.listing_eligible,
      guard_decision: result.decision,
      allow: result.allow,
      reasons: result.reasons.join("|"),
      stale_market_snapshot: result.reasons.includes("STALE_MARKETPLACE_SNAPSHOT"),
      reason_details: JSON.stringify(result.reasonDetails),
      profit: result.metrics.profit,
      margin_pct: result.metrics.margin_pct,
      roi_pct: result.metrics.roi_pct,
      supplier_price: result.metrics.supplier_price,
      marketplace_price: result.metrics.marketplace_price,
      shipping_cost: result.metrics.shipping_cost,
      supplier_drift_pct: result.metrics.supplier_price_drift_pct,
      supplier_age_h: result.metrics.supplier_snapshot_age_hours,
      market_age_h: result.metrics.marketplace_snapshot_age_hours,
      cost_components: JSON.stringify(result.metrics.cost_components),
      drift_hook: JSON.stringify(result.metrics.drift_hook),
      market_snapshot_age_limit_h: result.thresholds.maxMarketplaceSnapshotAgeHours,
    });
  }

  console.table(output);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
