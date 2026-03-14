import "dotenv/config";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";
import { withPgClient } from "../lib/pgRetry.mjs";

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type CountRow = {
  stale_candidates_remaining: number;
  listing_eligible_stale_candidates: number;
  approved_stale_candidates: number;
  manual_review_stale_candidates: number;
};

type UpdateRow = {
  id: string;
};

const STALE_REASON_PREFIX = "marketplace snapshot stale";

function staleReason(maxMarketplaceSnapshotAgeHours: number): string {
  return `${STALE_REASON_PREFIX} (> ${maxMarketplaceSnapshotAgeHours}h threshold)`;
}

async function columnExists(client: PgClient, column: string): Promise<boolean> {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profitable_candidates'
          AND column_name = $1
      ) AS exists
    `,
    [column]
  );
  return Boolean(result.rows?.[0]?.exists);
}

async function getStaleCounts(client: PgClient, maxMarketplaceSnapshotAgeHours: number): Promise<CountRow> {
  const result = await client.query(
    `
      SELECT
        COUNT(*)::int AS stale_candidates_remaining,
        COUNT(*) FILTER (WHERE COALESCE(pc.listing_eligible, FALSE) = TRUE)::int AS listing_eligible_stale_candidates,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(pc.decision_status, '')) = 'APPROVED')::int AS approved_stale_candidates,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(pc.decision_status, '')) = 'MANUAL_REVIEW')::int AS manual_review_stale_candidates
      FROM profitable_candidates pc
      INNER JOIN marketplace_prices mp
        ON mp.id = pc.market_price_snapshot_id
      WHERE mp.snapshot_ts < NOW() - ($1::int * INTERVAL '1 hour')
    `,
    [maxMarketplaceSnapshotAgeHours]
  );
  const row = result.rows?.[0] as Partial<CountRow> | undefined;
  return {
    stale_candidates_remaining: Number(row?.stale_candidates_remaining ?? 0),
    listing_eligible_stale_candidates: Number(row?.listing_eligible_stale_candidates ?? 0),
    approved_stale_candidates: Number(row?.approved_stale_candidates ?? 0),
    manual_review_stale_candidates: Number(row?.manual_review_stale_candidates ?? 0),
  };
}

async function getDecisionSummary(
  client: PgClient
) {
  const result = await client.query(`
    SELECT
      COUNT(*)::int AS total_candidates,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'PENDING')::int AS pending_count,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'MANUAL_REVIEW')::int AS manual_review_count,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(decision_status, '')) = 'REJECTED')::int AS rejected_count
    FROM profitable_candidates
  `);
  return result.rows?.[0] ?? {};
}

async function main() {
  const maxMarketplaceSnapshotAgeHours = getPriceGuardThresholds().maxMarketplaceSnapshotAgeHours;
  const reasonText = staleReason(maxMarketplaceSnapshotAgeHours);

  console.log("THREAD: Marketplace Price Scanner");
  console.log("TASK: reconcile stale profitable_candidates");
  console.log(`CONFIG: staleThreshold=${maxMarketplaceSnapshotAgeHours}h`);

  const result = await withPgClient(async (client: PgClient) => {
    const hasListingEligible = await columnExists(client, "listing_eligible");
    const hasListingEligibleTs = await columnExists(client, "listing_eligible_ts");
    const hasListingBlockReason = await columnExists(client, "listing_block_reason");
    const hasReason = await columnExists(client, "reason");

    const before = await getStaleCounts(client, maxMarketplaceSnapshotAgeHours);

    const setClauses = [`decision_status = 'MANUAL_REVIEW'`];
    const params: unknown[] = [maxMarketplaceSnapshotAgeHours];

    if (hasListingEligible) {
      setClauses.push(`listing_eligible = FALSE`);
    }
    if (hasListingEligibleTs) {
      setClauses.push(`listing_eligible_ts = NOW()`);
    }
    if (hasListingBlockReason) {
      params.push(reasonText);
      setClauses.push(`listing_block_reason = $${params.length}`);
    }
    if (hasReason) {
      params.push(reasonText);
      setClauses.push(
        `reason = CASE
          WHEN reason IS NULL OR BTRIM(reason) = '' THEN $${params.length}
          WHEN POSITION($${params.length} IN reason) > 0 THEN reason
          ELSE reason || ' | ' || $${params.length}
        END`
      );
    }

    const updateSql = `
      UPDATE profitable_candidates pc
      SET ${setClauses.join(", ")}
      FROM marketplace_prices mp
      WHERE mp.id = pc.market_price_snapshot_id
        AND mp.snapshot_ts < NOW() - ($1::int * INTERVAL '1 hour')
        AND (
          UPPER(COALESCE(pc.decision_status, '')) <> 'MANUAL_REVIEW'
          OR COALESCE(pc.listing_eligible, FALSE) = TRUE
          OR ${hasListingBlockReason ? "COALESCE(pc.listing_block_reason, '') <> $" + (hasReason ? params.length - 1 : params.length) : "FALSE"}
          OR ${hasReason ? "POSITION($" + params.length + " IN COALESCE(pc.reason, '')) = 0" : "FALSE"}
        )
      RETURNING pc.id
    `;

    const updated = await client.query(updateSql, params);
    const after = await getStaleCounts(client, maxMarketplaceSnapshotAgeHours);
    const summary = await getDecisionSummary(client);

    return {
      before,
      after,
      summary,
      updatedCount: updated.rows.length,
      updatedSample: (updated.rows as UpdateRow[]).slice(0, 20).map((row) => row.id),
    };
  });

  console.log("\n[before]");
  console.log(JSON.stringify(result.before, null, 2));
  console.log("\n[updated]");
  console.log(
    JSON.stringify(
      {
        updatedCount: result.updatedCount,
        updatedSample: result.updatedSample,
      },
      null,
      2
    )
  );
  console.log("\n[after]");
  console.log(JSON.stringify(result.after, null, 2));
  console.log("\n[decision_summary]");
  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
