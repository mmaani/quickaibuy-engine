import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { inferShippingFromEvidence } from "@/lib/pricing/shippingInference";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";

type OrphanRow = {
  listingId: string;
  status: string;
  candidateId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

type ShippingBlockedRow = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  listingBlockReason: string | null;
  decisionStatus: string;
  calcTs: string | null;
  shippingEstimates: unknown;
  rawPayload: unknown;
  snapshotTs: string | null;
  shippingQuoteDestination: string | null;
  shippingQuoteCost: string | null;
  shippingQuoteLastVerifiedAt: string | null;
  shippingQuoteSourceType: string | null;
};

function hasShippingEstimateSignal(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  return input.some((estimate) => {
    if (!estimate || typeof estimate !== "object") return false;
    const record = estimate as Record<string, unknown>;
    return (
      record.cost != null ||
      record.etaMinDays != null ||
      record.etaMaxDays != null ||
      record.ship_from_country != null ||
      record.ship_from_location != null ||
      record.label != null
    );
  });
}

function classifyShippingRootCause(row: ShippingBlockedRow): string {
  if (!row.snapshotTs) return "STALE_OR_MISSING_SUPPLIER_SNAPSHOT";
  if (!row.shippingEstimates && !row.rawPayload) return "STALE_OR_MISSING_SUPPLIER_SNAPSHOT";

  const inferred = inferShippingFromEvidence({
    supplierKey: row.supplierKey,
    destinationCountry: "US",
    shippingEstimates: row.shippingEstimates,
    rawPayload: row.rawPayload,
    defaultShippingUsd: null,
  });

  const hasEstimateSignal = hasShippingEstimateSignal(row.shippingEstimates);
  const hasQuote = row.shippingQuoteCost != null;
  const quoteStale =
    row.shippingQuoteLastVerifiedAt != null
      ? Date.now() - new Date(row.shippingQuoteLastVerifiedAt).getTime() > 72 * 60 * 60 * 1000
      : false;

  if (hasQuote && quoteStale) return "STALE_SHIPPING_QUOTE";
  if (hasQuote && row.shippingQuoteDestination && row.shippingQuoteDestination !== "US") {
    return "DESTINATION_RESOLUTION_GAP";
  }
  if (!hasQuote && inferred.shippingCostUsd != null) return "PARSING_OR_PERSIST_GAP";
  if (!hasQuote && hasEstimateSignal) return "UNSUPPORTED_OR_INCOMPLETE_SHIPPING_MODE";
  return "SUPPLIER_PAYLOAD_LACKS_SHIPPING";
}

async function findOrphanPublishPathRows() {
  const result = await db.execute<OrphanRow>(sql`
    SELECT
      l.id::text AS "listingId",
      l.status,
      l.candidate_id::text AS "candidateId",
      l.updated_at::text AS "updatedAt",
      l.created_at::text AS "createdAt"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE lower(l.marketplace_key) = 'ebay'
      AND l.status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
      AND pc.id IS NULL
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST
  `);
  return result.rows ?? [];
}

async function failCloseOrphanListings(rows: OrphanRow[], apply: boolean) {
  const transitions: Array<{ listingId: string; from: string; to: string; applied: boolean }> = [];
  for (const row of rows) {
    const targetStatus = "PUBLISH_FAILED";
    transitions.push({ listingId: row.listingId, from: row.status, to: targetStatus, applied: apply });
    if (!apply) continue;

    await db.execute(sql`
      UPDATE listings
      SET
        status = ${targetStatus},
        last_publish_error = 'Publish blocked: candidate missing (orphan listing); manual recovery required',
        response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
          recoveryState: "BLOCKED_ORPHANED_CANDIDATE",
          publishBlocked: true,
          requiresManualRecovery: true,
          blockedAt: new Date().toISOString(),
          note: "Listing had no profitable_candidates lineage at cleanup time; fail-closed out of publish path.",
        })}::jsonb,
        updated_at = NOW()
      WHERE id = ${row.listingId}::uuid
    `);

    await writeAuditLog({
      actorType: "ADMIN",
      actorId: "scripts/run_shipping_orphan_resolution.ts",
      entityType: "LISTING",
      entityId: row.listingId,
      eventType: "LISTING_FAIL_CLOSED_ORPHANED_CANDIDATE",
      details: {
        previousStatus: row.status,
        newStatus: targetStatus,
        reason: "candidate missing after refresh/recovery",
        failClosed: true,
      },
    });
  }
  return transitions;
}

async function findShippingBlockedCandidates() {
  const result = await db.execute<ShippingBlockedRow>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id,
        pr.shipping_estimates,
        pr.raw_payload,
        pr.snapshot_ts
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC
    ),
    quote_us AS (
      SELECT DISTINCT ON (lower(q.supplier_key), q.supplier_product_id)
        lower(q.supplier_key) AS supplier_key,
        q.supplier_product_id,
        upper(q.destination_country) AS destination_country,
        q.shipping_cost,
        q.last_verified_at,
        q.source_type
      FROM supplier_shipping_quotes q
      WHERE upper(q.destination_country) IN ('US', 'DEFAULT')
      ORDER BY lower(q.supplier_key), q.supplier_product_id,
        CASE WHEN upper(q.destination_country) = 'US' THEN 0 ELSE 1 END,
        q.last_verified_at DESC NULLS LAST
    )
    SELECT
      pc.id::text AS "candidateId",
      lower(pc.supplier_key) AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pc.listing_block_reason AS "listingBlockReason",
      pc.decision_status AS "decisionStatus",
      pc.calc_ts::text AS "calcTs",
      lp.shipping_estimates AS "shippingEstimates",
      lp.raw_payload AS "rawPayload",
      lp.snapshot_ts::text AS "snapshotTs",
      qu.destination_country::text AS "shippingQuoteDestination",
      qu.shipping_cost::text AS "shippingQuoteCost",
      qu.last_verified_at::text AS "shippingQuoteLastVerifiedAt",
      qu.source_type::text AS "shippingQuoteSourceType"
    FROM profitable_candidates pc
    LEFT JOIN latest_products lp
      ON lp.supplier_key = lower(pc.supplier_key)
     AND lp.supplier_product_id = pc.supplier_product_id
    LEFT JOIN quote_us qu
      ON qu.supplier_key = lower(pc.supplier_key)
     AND qu.supplier_product_id = pc.supplier_product_id
    WHERE lower(pc.marketplace_key) = 'ebay'
      AND pc.listing_block_reason = 'MISSING_SHIPPING_INTELLIGENCE'
    ORDER BY pc.calc_ts DESC NULLS LAST
  `);

  return result.rows ?? [];
}

async function upsertDeterministicShippingQuotes(rows: ShippingBlockedRow[], apply: boolean) {
  const updates: Array<{ candidateId: string; supplierKey: string; supplierProductId: string; applied: boolean }> = [];
  for (const row of rows) {
    const inferred = inferShippingFromEvidence({
      supplierKey: row.supplierKey,
      destinationCountry: "US",
      shippingEstimates: row.shippingEstimates,
      rawPayload: row.rawPayload,
      defaultShippingUsd: null,
    });

    if (inferred.shippingCostUsd == null || inferred.confidence == null || inferred.confidence < 0.6) {
      continue;
    }

    updates.push({
      candidateId: row.candidateId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      applied: apply,
    });

    if (!apply) continue;

    await db.execute(sql`
      INSERT INTO supplier_shipping_quotes (
        supplier_key,
        supplier_product_id,
        origin_country,
        destination_country,
        service_level,
        shipping_cost,
        estimated_min_days,
        estimated_max_days,
        currency,
        confidence,
        source_type,
        last_verified_at,
        updated_at
      ) VALUES (
        ${row.supplierKey},
        ${row.supplierProductId},
        ${inferred.originCountry},
        'US',
        'STANDARD',
        ${String(inferred.shippingCostUsd)},
        ${inferred.estimatedMinDays != null ? String(inferred.estimatedMinDays) : null},
        ${inferred.estimatedMaxDays != null ? String(inferred.estimatedMaxDays) : null},
        'USD',
        ${String(inferred.confidence)},
        ${inferred.sourceType ?? 'inferred_shipping_evidence'},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_key, supplier_product_id, destination_country, service_level)
      DO UPDATE SET
        origin_country = EXCLUDED.origin_country,
        shipping_cost = EXCLUDED.shipping_cost,
        estimated_min_days = EXCLUDED.estimated_min_days,
        estimated_max_days = EXCLUDED.estimated_max_days,
        currency = EXCLUDED.currency,
        confidence = EXCLUDED.confidence,
        source_type = EXCLUDED.source_type,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = NOW()
    `);
  }

  return updates;
}

function countBy<T>(rows: T[], fn: (row: T) => string) {
  const tally = new Map<string, number>();
  for (const row of rows) {
    const key = fn(row);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...tally.entries()].sort((a, b) => b[1] - a[1]));
}

async function main() {
  loadRuntimeEnv();

  const applyOrphanCleanup = process.argv.includes("--apply-orphan-cleanup");
  const applyShippingQuotes = process.argv.includes("--apply-shipping-quotes");
  const applyAnyMutation = applyOrphanCleanup || applyShippingQuotes;
  if (applyAnyMutation) {
    assertMutationAllowed("run_shipping_orphan_resolution.ts");
  }

  const orphanBefore = await findOrphanPublishPathRows();
  const orphanTransitions = await failCloseOrphanListings(orphanBefore, applyOrphanCleanup);
  const orphanAfter = applyOrphanCleanup ? await findOrphanPublishPathRows() : orphanBefore;

  const shippingBlocked = await findShippingBlockedCandidates();
  const shippingRootCauseRows = shippingBlocked.map((row) => ({
    ...row,
    rootCauseCategory: classifyShippingRootCause(row),
  }));
  const shippingUpdates = await upsertDeterministicShippingQuotes(shippingBlocked, applyShippingQuotes);

  console.log(
    JSON.stringify(
      {
        mode: {
          applyOrphanCleanup,
          applyShippingQuotes,
        },
        orphanReadyAnalysis: {
          orphanCountBefore: orphanBefore.length,
          orphanCountAfter: orphanAfter.length,
          transitions: orphanTransitions,
        },
        shippingRootCauseSummary: {
          totalBlockedByShipping: shippingBlocked.length,
          bySupplier: countBy(shippingBlocked, (row) => row.supplierKey || "unknown"),
          byRootCauseCategory: countBy(shippingRootCauseRows, (row) => row.rootCauseCategory),
        },
        shippingImprovementResult: {
          deterministicQuoteUpserts: shippingUpdates.length,
          updatedCandidateIds: shippingUpdates.slice(0, 200).map((row) => row.candidateId),
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("run_shipping_orphan_resolution failed", error);
  process.exit(1);
});
