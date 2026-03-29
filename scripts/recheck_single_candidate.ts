import { loadRuntimeEnv } from "@/lib/runtimeEnv";

loadRuntimeEnv();

async function main() {
  const candidateId = String(process.argv[2] ?? "").trim();
  const listingIdArg = String(process.argv[3] ?? "").trim();

  if (!candidateId) {
    console.error("Usage: pnpm exec tsx scripts/recheck_single_candidate.ts <candidate_id> [listing_id]");
    process.exit(1);
  }

  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { handleMarketplaceScanJob } = await import("@/lib/jobs/marketplaceScan");
  const { handleMatchProductsJob } = await import("@/lib/jobs/matchProducts");
  const { runProfitEngine } = await import("@/lib/profit/profitEngine");
  const { validateProfitSafety } = await import("@/lib/profit/priceGuard");

  type CandidateRow = {
    candidateId: string;
    listingId: string | null;
    supplierKey: string;
    supplierProductId: string;
    marketplaceKey: string;
    marketplaceListingId: string;
    latestSupplierSnapshotId: string | null;
  };

  const candidate = await db.execute<CandidateRow>(sql`
    SELECT
      pc.id::text AS "candidateId",
      COALESCE(${listingIdArg || null}::text, l.id::text) AS "listingId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pc.marketplace_key AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      (
        SELECT pr.id::text
        FROM products_raw pr
        WHERE LOWER(pr.supplier_key) = LOWER(pc.supplier_key)
          AND pr.supplier_product_id = pc.supplier_product_id
        ORDER BY pr.snapshot_ts DESC, pr.id DESC
        LIMIT 1
      ) AS "latestSupplierSnapshotId"
    FROM profitable_candidates pc
    LEFT JOIN listings l
      ON l.candidate_id = pc.id
      AND l.marketplace_key = pc.marketplace_key
    WHERE pc.id = ${candidateId}
    LIMIT 1
  `);

  const row = candidate.rows[0];
  if (!row) {
    console.error("Candidate not found.");
    process.exit(1);
  }

  if (!row.latestSupplierSnapshotId) {
    console.error("No supplier snapshot found for candidate.");
    process.exit(1);
  }

  console.log("target:");
  console.table([row]);

  console.log("\n1) marketplace scan refresh");
  const marketplaceScan = await handleMarketplaceScanJob({
    limit: 25,
    productRawId: row.latestSupplierSnapshotId,
    platform: row.marketplaceKey === "amazon" ? "amazon" : "ebay",
  });
  console.log(JSON.stringify(marketplaceScan, null, 2));

  console.log("\n2) match refresh");
  const matchResult = await handleMatchProductsJob({
    limit: 25,
    productRawId: row.latestSupplierSnapshotId,
  });
  console.log(JSON.stringify(matchResult, null, 2));

  console.log("\n3) targeted profit reevaluation");
  const profitResult = await runProfitEngine({
    limit: 25,
    supplierKey: row.supplierKey,
    supplierProductId: row.supplierProductId,
    marketplaceKey: row.marketplaceKey,
    marketplaceListingId: row.marketplaceListingId,
  });
  console.log(JSON.stringify(profitResult, null, 2));

  console.log("\n4) candidate state");
  const state = await db.execute(sql`
    SELECT
      id::text AS candidate_id,
      decision_status,
      listing_eligible,
      listing_block_reason,
      supplier_snapshot_id::text AS supplier_snapshot_id,
      calc_ts
    FROM profitable_candidates
    WHERE id = ${candidateId}
    LIMIT 1
  `);
  console.table(state.rows);

  if (row.listingId) {
    console.log("\n5) guarded validation");
    const safety = await validateProfitSafety({
      candidateId: row.candidateId,
      listingId: row.listingId,
      mode: "publish",
    });
    console.log(JSON.stringify(safety, null, 2));
  } else {
    console.log("\n5) guarded validation skipped (no listing found)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
