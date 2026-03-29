import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inferShippingFromEvidence } from "@/lib/pricing/shippingInference";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { refreshSingleSupplierProduct } from "@/lib/products/refreshSingleSupplierProduct";
import { compareSupplierIntelligence, computeSupplierIntelligenceSignal } from "@/lib/suppliers/intelligence";
import { getSupplierRefreshSuccessRateMap } from "@/lib/suppliers/telemetry";

type ActorType = "ADMIN" | "SYSTEM" | "WORKER";

export type ShippingBlockedCandidateRow = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  listingBlockReason: string | null;
  decisionStatus: string;
  calcTs: string | null;
  shippingEstimates: unknown;
  rawPayload: unknown;
  snapshotTs: string | null;
  marketplaceKey: string;
  marketplaceListingId: string;
  shippingQuoteDestination: string | null;
  shippingQuoteCost: string | null;
  shippingQuoteLastVerifiedAt: string | null;
  shippingQuoteSourceType: string | null;
};

type AlternateSupplierRecoveryTarget = {
  supplierKey: string;
  supplierProductId: string;
  shippingEstimates: unknown;
  rawPayload: unknown;
};

export type ShippingGapClassification =
  | "STALE_OR_MISSING_SUPPLIER_SNAPSHOT"
  | "STALE_SHIPPING_QUOTE"
  | "DESTINATION_RESOLUTION_GAP"
  | "PARSING_OR_PERSIST_GAP"
  | "UNSUPPORTED_OR_INCOMPLETE_SHIPPING_MODE"
  | "SUPPLIER_PAYLOAD_LACKS_SHIPPING";

export type ShippingAutomationResult = {
  ok: boolean;
  scanned: number;
  persistedQuotes: number;
  recomputedCandidates: number;
  stillBlocked: number;
  exactRefreshAttempts: number;
  exactRefreshRecovered: number;
  alternateSupplierAttempts: number;
  alternateSupplierRecovered: number;
  bySupplier: Array<{
    supplierKey: string;
    blocked: number;
    persistedQuotes: number;
  }>;
  gapBreakdown: Array<{
    rootCause: ShippingGapClassification;
    count: number;
  }>;
  persisted: Array<{
    candidateId: string;
    supplierKey: string;
    supplierProductId: string;
    shippingCostUsd: number;
    confidence: number;
    sourceType: string | null;
  }>;
};

function normalizeActorType(value?: string): ActorType {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

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

export function classifyShippingGap(row: ShippingBlockedCandidateRow): ShippingGapClassification {
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

export async function findShippingBlockedCandidates(limit = 100): Promise<ShippingBlockedCandidateRow[]> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const result = await db.execute<ShippingBlockedCandidateRow>(sql`
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
      lower(pc.marketplace_key) AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
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
      AND (
        pc.listing_block_reason = 'MISSING_SHIPPING_INTELLIGENCE'
        OR pc.listing_block_reason LIKE 'shipping intelligence unresolved:%'
      )
    ORDER BY pc.calc_ts DESC NULLS LAST
    LIMIT ${safeLimit}
  `);

  return result.rows ?? [];
}

async function getLatestShippingEvidence(input: {
  supplierKey: string;
  supplierProductId: string;
}): Promise<{ shippingEstimates: unknown; rawPayload: unknown; snapshotTs: string | null }> {
  const result = await db.execute<{
    shippingEstimates: unknown;
    rawPayload: unknown;
    snapshotTs: string | null;
  }>(sql`
    SELECT
      pr.shipping_estimates AS "shippingEstimates",
      pr.raw_payload AS "rawPayload",
      pr.snapshot_ts::text AS "snapshotTs"
    FROM products_raw pr
    WHERE lower(pr.supplier_key) = ${String(input.supplierKey).trim().toLowerCase()}
      AND pr.supplier_product_id = ${String(input.supplierProductId).trim()}
    ORDER BY pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    LIMIT 1
  `);
  return result.rows?.[0] ?? { shippingEstimates: null, rawPayload: null, snapshotTs: null };
}

async function getAlternateSupplierTargets(
  row: ShippingBlockedCandidateRow,
  refreshSuccessRates: Map<string, number>
): Promise<AlternateSupplierRecoveryTarget[]> {
  const result = await db.execute<AlternateSupplierRecoveryTarget>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id AS supplier_product_id,
        pr.shipping_estimates AS shipping_estimates,
        pr.raw_payload AS raw_payload,
        pr.snapshot_ts
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT DISTINCT
      lower(m.supplier_key) AS "supplierKey",
      m.supplier_product_id AS "supplierProductId",
      lp.shipping_estimates AS "shippingEstimates",
      lp.raw_payload AS "rawPayload"
    FROM matches m
    LEFT JOIN latest_products lp
      ON lp.supplier_key = lower(m.supplier_key)
     AND lp.supplier_product_id = m.supplier_product_id
    WHERE lower(m.marketplace_key) = lower(${row.marketplaceKey})
      AND m.marketplace_listing_id = ${row.marketplaceListingId}
      AND upper(coalesce(m.status, '')) = 'ACTIVE'
      AND lower(m.supplier_key) <> ${row.supplierKey}
      AND m.supplier_product_id <> ${row.supplierProductId}
  `);

  return (result.rows ?? []).sort((left, right) =>
    compareSupplierIntelligence(
      computeSupplierIntelligenceSignal({
        supplierKey: left.supplierKey,
        shippingEstimates: left.shippingEstimates,
        rawPayload: left.rawPayload,
        refreshSuccessRate: refreshSuccessRates.get(left.supplierKey) ?? null,
      }),
      computeSupplierIntelligenceSignal({
        supplierKey: right.supplierKey,
        shippingEstimates: right.shippingEstimates,
        rawPayload: right.rawPayload,
        refreshSuccessRate: refreshSuccessRates.get(right.supplierKey) ?? null,
      })
    )
  );
}

async function isCandidateStillShippingBlocked(candidateId: string): Promise<boolean> {
  const result = await db.execute<{ blocked: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.id = ${candidateId}
        AND (
          pc.listing_block_reason = 'MISSING_SHIPPING_INTELLIGENCE'
          OR pc.listing_block_reason LIKE 'shipping intelligence unresolved:%'
        )
    ) AS blocked
  `);
  return Boolean(result.rows?.[0]?.blocked);
}

export async function automateShippingIntelligence(input?: {
  limit?: number;
  actorId?: string;
  actorType?: ActorType;
}): Promise<ShippingAutomationResult> {
  const actorId = input?.actorId ?? "automateShippingIntelligence";
  const actorType = normalizeActorType(input?.actorType);
  const rows = await findShippingBlockedCandidates(input?.limit ?? 100);
  const refreshSuccessRates = await getSupplierRefreshSuccessRateMap();
  const gapCounts = new Map<ShippingGapClassification, number>();
  const supplierStats = new Map<string, { blocked: number; persistedQuotes: number }>();
  const persisted: ShippingAutomationResult["persisted"] = [];
  let recomputedCandidates = 0;
  let exactRefreshAttempts = 0;
  let exactRefreshRecovered = 0;
  let alternateSupplierAttempts = 0;
  let alternateSupplierRecovered = 0;

  for (const row of rows) {
    const rootCause = classifyShippingGap(row);
    gapCounts.set(rootCause, (gapCounts.get(rootCause) ?? 0) + 1);
    const supplierStat = supplierStats.get(row.supplierKey) ?? { blocked: 0, persistedQuotes: 0 };
    supplierStat.blocked += 1;
    supplierStats.set(row.supplierKey, supplierStat);

    let shippingEstimates = row.shippingEstimates;
    let rawPayload = row.rawPayload;
    let inferred = inferShippingFromEvidence({
      supplierKey: row.supplierKey,
      destinationCountry: "US",
      shippingEstimates,
      rawPayload,
      defaultShippingUsd: null,
    });

    if (
      rootCause === "STALE_OR_MISSING_SUPPLIER_SNAPSHOT" ||
      rootCause === "SUPPLIER_PAYLOAD_LACKS_SHIPPING" ||
      rootCause === "PARSING_OR_PERSIST_GAP"
    ) {
      exactRefreshAttempts += 1;
      const refresh = await refreshSingleSupplierProduct({
        supplierKey: row.supplierKey,
        supplierProductId: row.supplierProductId,
        requireExactMatch: true,
        updateExisting: true,
        searchLimit: 60,
      });

      if (refresh.refreshedSnapshotId || refresh.refreshed) {
        const latest = await getLatestShippingEvidence({
          supplierKey: row.supplierKey,
          supplierProductId: row.supplierProductId,
        });
        shippingEstimates = latest.shippingEstimates;
        rawPayload = latest.rawPayload;
        inferred = inferShippingFromEvidence({
          supplierKey: row.supplierKey,
          destinationCountry: "US",
          shippingEstimates,
          rawPayload,
          defaultShippingUsd: null,
        });
      }
    }

    if (inferred.shippingCostUsd == null || inferred.confidence == null || inferred.confidence < 0.6) {
      const canTryAlternateSupplier = row.decisionStatus !== "APPROVED";
      if (canTryAlternateSupplier) {
        const alternates = await getAlternateSupplierTargets(row, refreshSuccessRates);
        for (const alternate of alternates.slice(0, 2)) {
          alternateSupplierAttempts += 1;
          await refreshSingleSupplierProduct({
            supplierKey: alternate.supplierKey,
            supplierProductId: alternate.supplierProductId,
            requireExactMatch: true,
            updateExisting: true,
            searchLimit: 60,
          });
          await runProfitEngine({
            limit: 25,
            marketplaceKey: row.marketplaceKey,
            marketplaceListingId: row.marketplaceListingId,
            supplierKey: alternate.supplierKey,
            supplierProductId: alternate.supplierProductId,
          });
        }

        if (!(await isCandidateStillShippingBlocked(row.candidateId))) {
          alternateSupplierRecovered += 1;
        }
      }
      continue;
    }

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
        ${inferred.sourceType ?? "inferred_shipping_evidence"},
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

    await runProfitEngine({
      limit: 25,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
    });
    recomputedCandidates += 1;
    supplierStat.persistedQuotes += 1;

    persisted.push({
      candidateId: row.candidateId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      shippingCostUsd: inferred.shippingCostUsd,
      confidence: inferred.confidence,
      sourceType: inferred.sourceType ?? null,
    });

    await writeAuditLog({
      actorType,
      actorId,
      entityType: "SUPPLIER_PRODUCT",
      entityId: `${row.supplierKey}:${row.supplierProductId}`,
      eventType: "SHIPPING_INTELLIGENCE_PERSISTED",
      details: {
        candidateId: row.candidateId,
        supplierKey: row.supplierKey,
        supplierProductId: row.supplierProductId,
        shippingCostUsd: inferred.shippingCostUsd,
        confidence: inferred.confidence,
        sourceType: inferred.sourceType ?? null,
        rootCause,
      },
    });

    if (!(await isCandidateStillShippingBlocked(row.candidateId))) {
      exactRefreshRecovered += 1;
    }
  }

  const stillBlockedRows = await findShippingBlockedCandidates(input?.limit ?? 100);

  return {
    ok: true,
    scanned: rows.length,
    persistedQuotes: persisted.length,
    recomputedCandidates,
    stillBlocked: stillBlockedRows.length,
    exactRefreshAttempts,
    exactRefreshRecovered,
    alternateSupplierAttempts,
    alternateSupplierRecovered,
    bySupplier: Array.from(supplierStats.entries()).map(([supplierKey, stats]) => ({
      supplierKey,
      blocked: stats.blocked,
      persistedQuotes: stats.persistedQuotes,
    })),
    gapBreakdown: Array.from(gapCounts.entries()).map(([rootCause, count]) => ({ rootCause, count })),
    persisted,
  };
}
