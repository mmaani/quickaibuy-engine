import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { resolvePricingDestinationForMarketplace } from "@/lib/pricing/destinationResolver";
import { getShippingConfig } from "@/lib/pricing/shippingConfig";
import { resolveShippingCost } from "@/lib/pricing/shippingCalculator";
import { calculateRealProfit } from "@/lib/profit/realProfitCalculator";
import { sql } from "drizzle-orm";

type ActiveListingCandidateRow = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  listingPrice: string;
  listingTitle: string | null;
  marketplaceKey: string;
  supplierKey: string;
  supplierProductId: string;
  supplierPriceMin: string | null;
  supplierShippingEstimates: unknown;
  previousEstimatedShipping: string | null;
  previousEstimatedCogs: string | null;
  previousRepriceEvalTs: Date | string | null;
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
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pr.price_min::text AS "supplierPriceMin",
      pr.shipping_estimates AS "supplierShippingEstimates",
      pc.estimated_shipping::text AS "previousEstimatedShipping",
      pc.estimated_cogs::text AS "previousEstimatedCogs",
      (l.response -> 'shippingRepricing' ->> 'lastEvaluatedTs')::timestamp AS "previousRepriceEvalTs"
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

    const previousEval = row.previousRepriceEvalTs ? new Date(row.previousRepriceEvalTs) : null;
    const now = new Date();
    const cooldownHours =
      previousEval && Number.isFinite(previousEval.getTime())
        ? (now.getTime() - previousEval.getTime()) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;
    const cooldownBlocked = cooldownHours < config.repriceCooldownHours;

    const action = materialShippingDrift && materialPriceDelta && !cooldownBlocked ? "QUEUE" : "NO_ACTION";
    if (action === "QUEUE") queued++;

    const responsePatch = {
      shippingRepricing: {
        lastEvaluatedTs: now.toISOString(),
        lastReason: shippingDeltaUsd >= 0 ? "SHIPPING_COST_INCREASE" : "SHIPPING_COST_DECREASE",
        shippingDeltaUsd,
        shippingDeltaPct,
        priceDeltaUsd,
        priceDeltaPct,
        materialShippingDrift,
        materialPriceDelta,
        cooldownBlocked,
        recommendedPriceUsd: targetPrice,
        action,
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
      eventType: action === "QUEUE" ? "LISTING_REPRICE_QUEUED" : "LISTING_REPRICE_SKIPPED_THRESHOLD",
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
      },
    });

    if (apply && action === "QUEUE") {
      await db.execute(sql`
        UPDATE listings
        SET
          price = ${String(targetPrice)},
          updated_at = now(),
          response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify({
            shippingRepricing: { lastAppliedTs: now.toISOString(), appliedPriceUsd: targetPrice },
          })}::jsonb
        WHERE id = ${row.listingId}
      `);
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
          reason: shippingDeltaUsd >= 0 ? "SHIPPING_COST_INCREASE" : "SHIPPING_COST_DECREASE",
        },
      });
    }
  }

  return { ok: true, checked, queued, applied, skipped, apply };
}
