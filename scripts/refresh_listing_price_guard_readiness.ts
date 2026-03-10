import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const listingId = String(process.argv[2] ?? "").trim();
  if (!listingId) {
    console.error("Usage: pnpm exec tsx scripts/refresh_listing_price_guard_readiness.ts <listing_id>");
    process.exit(1);
  }

  const { db } = await import("../src/lib/db");
  const { sql } = await import("drizzle-orm");
  const { handleMarketplaceScanJob } = await import("../src/lib/jobs/marketplaceScan");
  const { handleMatchProductsJob } = await import("../src/lib/jobs/matchProducts");
  const { runProfitEngine } = await import("../src/lib/profit/profitEngine");
  const { validateProfitSafety } = await import("../src/lib/profit/priceGuard");

  type Row = {
    listing_id: string;
    candidate_id: string;
    supplier_key: string;
    supplier_product_id: string;
    marketplace_key: string;
    marketplace_listing_id: string;
    product_raw_id: string | null;
  };

  const base = await db.execute<Row>(sql`
    SELECT
      l.id::text AS listing_id,
      l.candidate_id::text AS candidate_id,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.marketplace_key,
      pc.marketplace_listing_id,
      pc.supplier_snapshot_id::text AS product_raw_id
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${listingId}
    LIMIT 1
  `);

  if (base.rows.length === 0) {
    console.error("Listing not found.");
    process.exit(1);
  }

  const row = base.rows[0];

  console.log("target listing:");
  console.table([row]);

  if (!row.product_raw_id) {
    console.error("No supplier_snapshot_id / product_raw_id found for candidate.");
    process.exit(1);
  }

  console.log("\n1) marketplace scan refresh");
  const scanResult = await handleMarketplaceScanJob({
    limit: 25,
    productRawId: row.product_raw_id,
    platform: "ebay",
  });
  console.log(JSON.stringify(scanResult, null, 2));

  console.log("\n2) product match refresh");
  const matchResult = await handleMatchProductsJob({
    limit: 25,
    productRawId: row.product_raw_id,
  });
  console.log(JSON.stringify(matchResult, null, 2));

  console.log("\n3) profit engine refresh");
  const profitResult = await runProfitEngine({
    limit: 50,
    supplierKey: row.supplier_key,
  });
  console.log(JSON.stringify(profitResult, null, 2));

  console.log("\n4) price guard recheck");
  const safety = await validateProfitSafety({
    candidateId: row.candidate_id,
    listingId: row.listing_id,
    mode: "publish",
  });
  console.log(JSON.stringify(safety, null, 2));

  if (safety.allow) {
    console.log("\n5) restoring listing eligibility + resetting listing to PREVIEW");
    await db.execute(sql`
      UPDATE profitable_candidates
      SET
        listing_eligible = TRUE,
        listing_block_reason = NULL,
        listing_eligible_ts = NOW()
      WHERE id = ${row.candidate_id}
    `);

    await db.execute(sql`
      UPDATE listings
      SET
        status = 'PREVIEW',
        last_publish_error = NULL,
        publish_started_ts = NULL,
        publish_finished_ts = NULL,
        updated_at = NOW()
      WHERE id = ${row.listing_id}
    `);

    console.log("Eligibility restored and listing reset to PREVIEW.");
  } else {
    console.log("\nPrice guard still does not allow publish. No reset performed.");
  }

  const finalState = await db.execute(sql`
    SELECT
      l.id,
      l.candidate_id,
      l.status,
      l.last_publish_error,
      pc.listing_eligible,
      pc.listing_block_reason,
      pc.calc_ts
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${row.listing_id}
    LIMIT 1
  `);

  console.log("\nfinal state:");
  console.table(finalState.rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
