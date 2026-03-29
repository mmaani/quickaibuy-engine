import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { automateShippingIntelligence } from "@/lib/pricing/shippingAutomation";
import { refreshMatchedSupplierRows } from "@/lib/products/refreshMatchedSupplierRows";
import {
  buildOperationalSummary,
  getRuntimeDiagnostics,
  runAutonomousOperations,
} from "@/lib/autonomousOps/backbone";

loadRuntimeEnv();

type RecentSupplierProduct = {
  productRawId: string;
  supplierKey: string;
  supplierProductId: string;
};

async function getRecentPreferredSupplierProducts(input: {
  startedAtIso: string;
  suppliers: string[];
  limit: number;
}): Promise<RecentSupplierProduct[]> {
  const suppliers = input.suppliers.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!suppliers.length) return [];
  const supplierSqlList = sql.join(suppliers.map((supplier) => sql`${supplier}`), sql`, `);

  const result = await db.execute<RecentSupplierProduct>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        pr.id::text AS "productRawId",
        lower(pr.supplier_key) AS "supplierKey",
        pr.supplier_product_id AS "supplierProductId",
        pr.snapshot_ts
      FROM products_raw pr
      WHERE pr.snapshot_ts >= ${input.startedAtIso}::timestamp
        AND lower(pr.supplier_key) IN (${supplierSqlList})
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT
      lp."productRawId",
      lp."supplierKey",
      lp."supplierProductId"
    FROM latest_products lp
    ORDER BY
      CASE
        WHEN lp."supplierKey" = 'cjdropshipping' THEN 0
        WHEN lp."supplierKey" = 'temu' THEN 1
        WHEN lp."supplierKey" = 'alibaba' THEN 2
        ELSE 3
      END,
      lp.snapshot_ts DESC NULLS LAST
    LIMIT ${Math.max(1, Math.min(input.limit, 400))}
  `);

  return result.rows ?? [];
}

async function getNewActivePublishes(startedAtIso: string) {
  const result = await db.execute<{
    listingId: string;
    candidateId: string | null;
    supplierKey: string | null;
    supplierProductId: string | null;
    publishedExternalId: string | null;
  }>(sql`
    SELECT
      l.id::text AS "listingId",
      l.candidate_id::text AS "candidateId",
      lower(pc.supplier_key) AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      l.published_external_id AS "publishedExternalId"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE lower(l.marketplace_key) = 'ebay'
      AND l.status = 'ACTIVE'
      AND l.updated_at >= ${startedAtIso}::timestamp
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST
  `);
  return result.rows ?? [];
}

async function main() {
  const startedAtIso = new Date().toISOString();
  const limitPerKeyword = Math.max(12, Math.min(Number(process.argv[2] ?? 18), 60));
  const rebuildLimit = Math.max(20, Math.min(Number(process.argv[3] ?? 120), 300));
  const preferredSuppliers = ["cjdropshipping", "temu", "alibaba"];

  const runtime = await getRuntimeDiagnostics();
  const before = await buildOperationalSummary(runtime);

  const discovery = await runSupplierDiscover(limitPerKeyword);
  const recentProducts = await getRecentPreferredSupplierProducts({
    startedAtIso,
    suppliers: preferredSuppliers,
    limit: rebuildLimit,
  });

  let marketplaceUpserts = 0;
  let marketplaceQueryErrors = 0;
  let matchedCount = 0;
  let profitUpdated = 0;

  for (const product of recentProducts) {
    const scan = await handleMarketplaceScanJob({
      limit: 25,
      productRawId: product.productRawId,
      platform: "ebay",
    });
    marketplaceUpserts += Number(scan.upserted ?? 0);
    marketplaceQueryErrors += Number(scan.queryErrors ?? 0);

    const match = await handleMatchProductsJob({
      limit: 25,
      productRawId: product.productRawId,
    });
    matchedCount += Number(match.active ?? 0) + Number(match.updated ?? 0) + Number(match.inserted ?? 0);

    const profit = await runProfitEngine({
      limit: 50,
      supplierKey: product.supplierKey,
      supplierProductId: product.supplierProductId,
      marketplaceKey: "ebay",
    });
    profitUpdated += Number(profit.insertedOrUpdated ?? 0);
  }

  const refreshBatches = [];
  for (const supplierKey of preferredSuppliers) {
    refreshBatches.push(
      await refreshMatchedSupplierRows({
        supplierKey,
        limit: Math.max(10, Math.floor(rebuildLimit / preferredSuppliers.length)),
        searchLimit: 80,
      })
    );
  }

  const shipping = await automateShippingIntelligence({
    limit: 200,
    actorId: "scripts/run_supplier_wave_regeneration.ts",
    actorType: "SYSTEM",
  });
  const diagnosticsRefresh = await runAutonomousOperations({
    phase: "diagnostics_refresh",
    actorId: "scripts/run_supplier_wave_regeneration.ts",
    actorType: "SYSTEM",
  });
  const prepare = await runAutonomousOperations({
    phase: "prepare",
    actorId: "scripts/run_supplier_wave_regeneration.ts",
    actorType: "SYSTEM",
  });
  const publish = await runAutonomousOperations({
    phase: "publish",
    actorId: "scripts/run_supplier_wave_regeneration.ts",
    actorType: "SYSTEM",
  });

  const after = await buildOperationalSummary(runtime);
  const newPublishes = await getNewActivePublishes(startedAtIso);

  console.log(
    JSON.stringify(
      {
        runtime,
        before,
        discovery,
        rebuild: {
          preferredSuppliers,
          recentProducts: recentProducts.length,
          marketplaceUpserts,
          marketplaceQueryErrors,
          matchedCount,
          profitUpdated,
          refreshBatches: refreshBatches.map((batch) => ({
            targets: batch.targets.length,
            refreshed: batch.outcomes.filter((item) => item.refresh.refreshed || item.refresh.refreshedSnapshotId).length,
            previewPrepared: batch.outcomes.reduce((sum, item) => sum + item.previewPreparedCandidateIds.length, 0),
          })),
        },
        shipping,
        diagnosticsRefresh,
        prepare,
        publish,
        after,
        newPublishes,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
