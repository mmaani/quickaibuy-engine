import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { reevaluateActiveListingSuppliers } from "@/lib/profit/activeSupplierReevaluation";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { resolvePricingDestinationForMarketplace } from "@/lib/pricing/destinationResolver";
import { getShippingConfig } from "@/lib/pricing/shippingConfig";
import { resolveShippingCost } from "@/lib/pricing/shippingCalculator";
import { calculateRealProfit } from "@/lib/profit/realProfitCalculator";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

type ActiveListingCandidateRow = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  listingPrice: string;
  listingTitle: string | null;
  marketplaceKey: string;
  marketplaceListingId: string;
  supplierKey: string;
  supplierProductId: string;
  supplierPriceMin: string | null;
  supplierShippingEstimates: unknown;
  previousEstimatedShipping: string | null;
  previousEstimatedCogs: string | null;
  previousRepriceEvalTs: Date | string | null;
  previousFingerprint: string | null;
  previousAppliedFingerprint: string | null;
};

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctDelta(base: number, target: number): number {
  if (base <= 0) return 0;
  return round2(((target - base) / base) * 100);
}

function buildCostStateFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function runShippingRepricingMonitor(input?: { limit?: number; apply?: boolean; actorId?: string }) {
  const limit = Math.max(1, Number(input?.limit ?? 50));
  const apply = Boolean(input?.apply);
  const actorId = input?.actorId ?? "shipping.repricer";
  const config = getShippingConfig();

  const rowsResult = await db.execute<ActiveListingCandidateRow>(sql`
    SELECT
      l.id::text AS "listingId",
      l.candidate_id::text AS "candidateId",
      l.status AS "listingStatus",
      l.price::text AS "listingPrice",
      l.title AS "listingTitle",
      pc.marketplace_key AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pr.price_min::text AS "supplierPriceMin",
      pr.shipping_estimates AS "supplierShippingEstimates",
      pc.estimated_shipping::text AS "previousEstimatedShipping",
      pc.estimated_cogs::text AS "previousEstimatedCogs",
      (l.response -> 'shippingRepricing' ->> 'lastEvaluatedTs')::timestamp AS "previousRepriceEvalTs",
      l.response -> 'shippingRepricing' ->> 'lastFingerprint' AS "previousFingerprint",
      l.response -> 'shippingRepricing' ->> 'lastAppliedFingerprint' AS "previousAppliedFingerprint"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    INNER JOIN products_raw pr
      ON pr.id = pc.supplier_snapshot_id
    WHERE upper(coalesce(l.status, '')) = 'ACTIVE'
      AND lower(coalesce(pc.marketplace_key, '')) = 'ebay'
    ORDER BY l.updated_at ASC NULLS FIRST
    LIMIT ${limit}
  `);

  const rows = rowsResult.rows ?? [];

  let checked = 0;
  let queued = 0;
  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    checked++;
    if (row.listingStatus !== "ACTIVE") {
      skipped++;
      continue;
    }

    const listingPrice = toNum(row.listingPrice);
    const supplierPrice = toNum(row.supplierPriceMin);
    const previousShipping = toNum(row.previousEstimatedShipping);
    if (listingPrice == null || supplierPrice == null) {
      skipped++;
      continue;
    }

    const destinationCountry = resolvePricingDestinationForMarketplace(row.marketplaceKey);
    const shipping = await resolveShippingCost({
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      destinationCountry,
      shippingEstimates: row.supplierShippingEstimates,
    });

    if (shipping.errorReason) {
      skipped++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: row.listingId,
        eventType: "LISTING_REPRICE_SKIPPED_SHIPPING_UNSAFE",
        details: {
          reason: shipping.errorReason,
          shippingResolutionMode: shipping.resolutionMode,
          destinationCountry,
        },
      });
      continue;
    }

    const totalShipping = round2(shipping.shippingCostUsd + shipping.shippingReserveUsd);
    const previousShippingValue = previousShipping ?? 0;
    const shippingDeltaUsd = round2(totalShipping - previousShippingValue);
    const shippingDeltaPct = pctDelta(previousShippingValue || 1, totalShipping);
    const materialShippingDrift =
      Math.abs(shippingDeltaUsd) >= config.shippingCostDriftThresholdUsd ||
      Math.abs(shippingDeltaPct) >= config.shippingCostDriftThresholdPct;

    const economics = calculateRealProfit({
      marketplaceKey: row.marketplaceKey,
      marketplacePriceUsd: listingPrice,
      supplierPriceUsd: supplierPrice,
      shippingPriceUsd: totalShipping,
    });

    const targetPrice = round2(
      listingPrice + Math.max(0, -economics.estimatedProfitUsd) + Math.max(config.repriceMinDeltaUsd, 0)
    );
    const priceDeltaUsd = round2(targetPrice - listingPrice);
    const priceDeltaPct = pctDelta(listingPrice, targetPrice);
    const materialPriceDelta =
      Math.abs(priceDeltaUsd) >= config.repriceMinDeltaUsd || Math.abs(priceDeltaPct) >= config.repriceMinDeltaPct;

    const supplierReevaluation = await reevaluateActiveListingSuppliers({
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      currentSupplierKey: row.supplierKey,
      currentSupplierProductId: row.supplierProductId,
    });

    const previousEval = row.previousRepriceEvalTs ? new Date(row.previousRepriceEvalTs) : null;
    const now = new Date();
    const cooldownHours =
      previousEval && Number.isFinite(previousEval.getTime())
        ? (now.getTime() - previousEval.getTime()) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;
    const cooldownBlocked = cooldownHours < config.repriceCooldownHours;

    const dailyAppliedResult = await db.execute<{ appliedCount: number }>(sql`
      SELECT COUNT(*)::int AS "appliedCount"
      FROM audit_log
      WHERE entity_type = 'LISTING'
        AND entity_id = ${row.listingId}
        AND event_type = 'LISTING_REPRICE_APPLIED'
        AND event_ts >= date_trunc('day', now() at time zone 'UTC')
    `);
    const dailyAppliedCount = Number(dailyAppliedResult.rows?.[0]?.appliedCount ?? 0);
    const dailyCapBlocked = dailyAppliedCount >= config.maxRepricesPerListingPerDay;

    const costStateFingerprint = buildCostStateFingerprint({
      listingId: row.listingId,
      candidateId: row.candidateId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      destinationCountry,
      supplierPrice,
      shippingCostUsd: shipping.shippingCostUsd,
      shippingReserveUsd: shipping.shippingReserveUsd,
      totalShipping,
      shippingResolutionMode: shipping.resolutionMode,
      shippingQuoteAgeHours: shipping.quoteAgeHours,
      recommendedPriceUsd: targetPrice,
      reevaluationStatus: supplierReevaluation.status,
      currentLandedCostUsd: supplierReevaluation.currentOption?.landedSupplierCostUsd ?? null,
      bestSupplierKey: supplierReevaluation.bestOption?.supplierKey ?? null,
      bestSupplierProductId: supplierReevaluation.bestOption?.supplierProductId ?? null,
      bestLandedCostUsd: supplierReevaluation.bestOption?.landedSupplierCostUsd ?? null,
    });
    const identicalState =
      costStateFingerprint === (row.previousFingerprint ?? "") ||
      costStateFingerprint === (row.previousAppliedFingerprint ?? "");

    const currentSupplierEligible =
      supplierReevaluation.currentOption?.listingEligible === true &&
      supplierReevaluation.currentOption?.decisionStatus === "APPROVED";
    const alternateSupplierBetter = supplierReevaluation.status === "ALTERNATE_SUPPLIER_BETTER";
    const currentSupplierNonViable =
      supplierReevaluation.status === "CURRENT_SUPPLIER_NON_VIABLE" ||
      supplierReevaluation.status === "NO_VIABLE_SUPPLIER" ||
      supplierReevaluation.status === "CURRENT_SUPPLIER_NOT_FOUND";
    const priceGuard = await validateProfitSafety({
      candidateId: row.candidateId,
      listingId: row.listingId,
      mode: "publish",
    });
    const guardrailBlocked = !priceGuard.allow;

    let action = "NO_ACTION";
    let lastReason =
      shippingDeltaUsd >= 0 ? "SHIPPING_COST_INCREASE" : "SHIPPING_COST_DECREASE";

    if (alternateSupplierBetter) {
      action = "MANUAL_REVIEW";
      lastReason = "SUPPLIER_SWITCH_LANDED_COST_OPTIMIZATION";
    } else if (currentSupplierNonViable) {
      action = "MANUAL_REVIEW";
      lastReason = "CURRENT_SUPPLIER_NON_VIABLE";
    } else if (identicalState) {
      lastReason = "REPRICE_IDENTICAL_COST_STATE";
    } else if (dailyCapBlocked) {
      lastReason = "REPRICE_MAX_DAILY_CAP_REACHED";
    } else if (guardrailBlocked || !currentSupplierEligible) {
      lastReason = "REPRICE_GUARDRAIL_RECHECK_FAILED";
    } else if (materialShippingDrift && materialPriceDelta && !cooldownBlocked) {
      action = "QUEUE";
    }
    if (action === "QUEUE") queued++;

    const responsePatch = {
      shippingRepricing: {
        lastEvaluatedTs: now.toISOString(),
        lastReason,
        shippingDeltaUsd,
        shippingDeltaPct,
        priceDeltaUsd,
        priceDeltaPct,
        materialShippingDrift,
        materialPriceDelta,
        cooldownBlocked,
        dailyCapBlocked,
        dailyAppliedCount,
        currentSupplierEligible,
        guardrailBlocked,
        lastFingerprint: costStateFingerprint,
        recommendedPriceUsd: targetPrice,
        action,
      },
      supplierReevaluation: {
        evaluatedAt: supplierReevaluation.evaluatedAt,
        status: supplierReevaluation.status,
        destinationCountry: supplierReevaluation.destinationCountry,
        alternativesCount: supplierReevaluation.alternativesCount,
        currentSupplierKey: supplierReevaluation.currentSupplierKey,
        currentSupplierProductId: supplierReevaluation.currentSupplierProductId,
        currentLandedCostUsd: supplierReevaluation.currentOption?.landedSupplierCostUsd ?? null,
        currentShippingCostUsd: supplierReevaluation.currentOption?.totalShippingUsd ?? null,
        bestSupplierKey: supplierReevaluation.bestOption?.supplierKey ?? null,
        bestSupplierProductId: supplierReevaluation.bestOption?.supplierProductId ?? null,
        bestLandedCostUsd: supplierReevaluation.bestOption?.landedSupplierCostUsd ?? null,
        bestShippingCostUsd: supplierReevaluation.bestOption?.totalShippingUsd ?? null,
      },
    };

    await db.execute(sql`
      UPDATE listings
      SET
        response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify(responsePatch)}::jsonb,
        updated_at = now()
      WHERE id = ${row.listingId}
    `);

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "LISTING",
      entityId: row.listingId,
      eventType:
        action === "QUEUE"
          ? "LISTING_REPRICE_QUEUED"
          : action === "MANUAL_REVIEW"
            ? "LISTING_REPRICE_SKIPPED_SUPPLIER_REEVALUATION"
            : "LISTING_REPRICE_SKIPPED_THRESHOLD",
      details: {
        listingId: row.listingId,
        candidateId: row.candidateId,
        oldPriceUsd: listingPrice,
        newRecommendedPriceUsd: targetPrice,
        oldShippingUsd: previousShippingValue,
        newShippingUsd: totalShipping,
        shippingDeltaUsd,
        shippingDeltaPct,
        priceDeltaUsd,
        priceDeltaPct,
        cooldownBlocked,
        dailyCapBlocked,
        dailyAppliedCount,
        identicalState,
        fingerprint: costStateFingerprint,
        supplierReevaluation,
        priceGuardDecision: priceGuard.decision,
        priceGuardReasons: priceGuard.reasons,
        currentSupplierEligible,
        guardrailBlocked,
      },
    });

    if (apply && action === "QUEUE") {
      if (row.listingStatus !== "ACTIVE") {
        skipped++;
        continue;
      }
      const applyResult = await db.execute<{ listingId: string }>(sql`
        UPDATE listings
        SET
          price = ${String(targetPrice)},
          updated_at = now(),
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            shippingRepricing: {
              ...responsePatch.shippingRepricing,
              lastAppliedTs: now.toISOString(),
              appliedPriceUsd: targetPrice,
              lastAppliedFingerprint: costStateFingerprint,
            },
            supplierReevaluation: responsePatch.supplierReevaluation,
          })}::jsonb
        WHERE id = ${row.listingId}
          AND upper(coalesce(status, '')) = 'ACTIVE'
        RETURNING id::text AS "listingId"
      `);
      if ((applyResult.rows?.length ?? 0) === 0) {
        skipped++;
        continue;
      }
      applied++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: row.listingId,
        eventType: "LISTING_REPRICE_APPLIED",
        details: {
          oldPriceUsd: listingPrice,
          newPriceUsd: targetPrice,
          reason: lastReason,
          fingerprint: costStateFingerprint,
        },
      });
    }
  }

  return { ok: true, checked, queued, applied, skipped, apply };
}
