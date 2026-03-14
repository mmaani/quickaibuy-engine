import "dotenv/config";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";
import { withPgClient } from "../lib/pgRetry.mjs";

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function main() {
  const maxMarketplaceSnapshotAgeHours = getPriceGuardThresholds().maxMarketplaceSnapshotAgeHours;

  console.log("THREAD: Marketplace Price Scanner");
  console.log("TASK: verify stale profitable_candidates reconciliation");
  console.log(`CONFIG: staleThreshold=${maxMarketplaceSnapshotAgeHours}h`);

  const result = await withPgClient(async (client: PgClient) => {
    const staleCounts = await client.query(
      `
        SELECT
          COUNT(*)::int AS stale_candidates_remaining,
          COUNT(*) FILTER (WHERE COALESCE(pc.listing_eligible, FALSE) = TRUE)::int AS listing_eligible_stale_candidates
        FROM profitable_candidates pc
        INNER JOIN marketplace_prices mp
          ON mp.id = pc.market_price_snapshot_id
        WHERE mp.snapshot_ts < NOW() - ($1::int * INTERVAL '1 hour')
      `,
      [maxMarketplaceSnapshotAgeHours]
    );

    const decisionSummary = await client.query(`
      SELECT
        COUNT(*)::int AS total_candidates,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'PENDING')::int AS pending_count,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'APPROVED')::int AS approved_count,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'MANUAL_REVIEW')::int AS manual_review_count,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'REJECTED')::int AS rejected_count
      FROM profitable_candidates
    `);

    return {
      stale: staleCounts.rows?.[0] ?? {},
      decisions: decisionSummary.rows?.[0] ?? {},
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
