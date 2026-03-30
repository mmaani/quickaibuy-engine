import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import {
  computeSupplierSelectionScore,
} from "@/lib/listings/supplierSelection";
import { computeSupplierIntelligenceSignal, shouldRejectSupplierEarly } from "@/lib/suppliers/intelligence";

loadRuntimeEnv();

type Row = {
  candidateId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  supplierKey: string;
  supplierProductId: string;
  supplierPrice: string | number | null;
  estimatedProfit: string | number | null;
  marginPct: string | number | null;
  decisionStatus: string | null;
  listingEligible: boolean | null;
  listingBlockReason: string | null;
  shippingEstimates: unknown;
  supplierRawPayload: unknown;
};

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oldSelectionScore(row: Row): number {
  const payload = objectOrNull(row.supplierRawPayload);
  const supplierPrice = Math.max(0, toNum(row.supplierPrice) ?? 0);
  const marginPct = toNum(row.marginPct) ?? 0;
  const mediaQuality = toNum(payload?.mediaQualityScore) ?? 0.5;
  const availabilityConfidence = toNum(payload?.availabilityConfidence) ?? 0.5;
  const shippingMin =
    toNum(payload?.deliveryEstimateMinDays) ??
    toNum(payload?.delivery_estimate_min_days) ??
    21;
  const shippingMax =
    toNum(payload?.deliveryEstimateMaxDays) ??
    toNum(payload?.delivery_estimate_max_days) ??
    shippingMin;
  const shippingDays = Math.max(shippingMin, shippingMax);
  const shippingPenalty = Math.min(0.25, shippingDays / 100);
  const priceComponent = supplierPrice > 0 ? Math.min(0.25, 1 / Math.max(1, supplierPrice / 10)) : 0;
  const marginComponent = Math.max(0, Math.min(0.25, marginPct / 200));
  const mediaComponent = Math.max(0, Math.min(0.25, mediaQuality * 0.25));
  const stockReliabilityComponent = Math.max(0, Math.min(0.25, availabilityConfidence * 0.25));
  const intelligence = computeSupplierIntelligenceSignal({
    supplierKey: row.supplierKey,
    availabilitySignal: payload?.availabilitySignal ?? payload?.availability_status,
    availabilityConfidence,
    shippingEstimates: row.shippingEstimates ?? payload?.shippingEstimates ?? payload?.shipping_estimates,
    rawPayload: payload,
    shippingConfidence: payload?.shippingConfidence ?? payload?.shipping_confidence,
    snapshotQuality: payload?.snapshotQuality ?? payload?.snapshot_quality,
  });
  const supplierIntelligenceComponent = intelligence.reliabilityScore * 0.3;
  const aliExpressPenalty = intelligence.shouldDeprioritize ? 0.18 : 0;

  return Number(
    (
      priceComponent +
      marginComponent +
      mediaComponent +
      stockReliabilityComponent +
      supplierIntelligenceComponent -
      shippingPenalty -
      aliExpressPenalty
    ).toFixed(6)
  );
}

function classifyWinner(row: Row) {
  const payload = objectOrNull(row.supplierRawPayload);
  const gate = shouldRejectSupplierEarly({
    supplierKey: row.supplierKey,
    destinationCountry: "US",
    availabilitySignal: payload?.availabilitySignal ?? payload?.availability_status,
    availabilityConfidence: payload?.availabilityConfidence ?? payload?.availability_confidence,
    shippingEstimates: row.shippingEstimates ?? payload?.shippingEstimates ?? payload?.shipping_estimates,
    rawPayload: payload,
    shippingConfidence: payload?.shippingConfidence ?? payload?.shipping_confidence,
    snapshotQuality: payload?.snapshotQuality ?? payload?.snapshot_quality,
  });
  return {
    supplierKey: row.supplierKey,
    candidateId: row.candidateId,
    listingEligible: Boolean(row.listingEligible),
    decisionStatus: row.decisionStatus ?? null,
    listingBlockReason: row.listingBlockReason ?? null,
    rejectedEarly: gate.reject,
    rejectReason: gate.reason,
    reliabilityScore: gate.signal.reliabilityScore,
    hasStrongOriginEvidence: gate.signal.hasStrongOriginEvidence,
    hasUsWarehouse: gate.signal.hasUsWarehouse,
    lowStockOrWorse: gate.signal.lowStockOrWorse,
  };
}

async function main() {
  const candidateResult = await db.execute<Row>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id,
        pr.price_min,
        pr.shipping_estimates,
        pr.raw_payload
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT
      pc.id::text AS "candidateId",
      lower(pc.marketplace_key) AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      lower(pc.supplier_key) AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      lp.price_min AS "supplierPrice",
      pc.estimated_profit AS "estimatedProfit",
      pc.margin_pct AS "marginPct",
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible",
      pc.listing_block_reason AS "listingBlockReason",
      lp.shipping_estimates AS "shippingEstimates",
      lp.raw_payload AS "supplierRawPayload"
    FROM profitable_candidates pc
    JOIN latest_products lp
      ON lp.supplier_key = lower(pc.supplier_key)
     AND lp.supplier_product_id = pc.supplier_product_id
    WHERE lower(pc.marketplace_key) = 'ebay'
  `);
  const matchResult = await db.execute<Row>(sql`
    WITH ranked_matches AS (
      SELECT
        lower(m.supplier_key) AS supplier_key,
        m.supplier_product_id,
        lower(m.marketplace_key) AS marketplace_key,
        m.marketplace_listing_id,
        row_number() OVER (
          PARTITION BY lower(m.supplier_key), m.supplier_product_id, lower(m.marketplace_key), m.marketplace_listing_id
          ORDER BY cast(m.confidence AS numeric) DESC, m.last_seen_ts DESC, m.id DESC
        ) AS rn
      FROM matches m
      WHERE upper(coalesce(m.status, '')) = 'ACTIVE'
        AND lower(m.marketplace_key) = 'ebay'
    ),
    latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id,
        pr.price_min,
        pr.shipping_estimates,
        pr.raw_payload
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT
      concat(rm.marketplace_listing_id, ':', rm.supplier_key, ':', rm.supplier_product_id)::text AS "candidateId",
      rm.marketplace_key AS "marketplaceKey",
      rm.marketplace_listing_id AS "marketplaceListingId",
      rm.supplier_key AS "supplierKey",
      rm.supplier_product_id AS "supplierProductId",
      lp.price_min AS "supplierPrice",
      null::numeric AS "estimatedProfit",
      null::numeric AS "marginPct",
      null::text AS "decisionStatus",
      null::boolean AS "listingEligible",
      null::text AS "listingBlockReason",
      lp.shipping_estimates AS "shippingEstimates",
      lp.raw_payload AS "supplierRawPayload"
    FROM ranked_matches rm
    JOIN latest_products lp
      ON lp.supplier_key = rm.supplier_key
     AND lp.supplier_product_id = rm.supplier_product_id
    WHERE rm.rn = 1
  `);

  const summarizeComparison = (rows: Row[]) => {
    const poolBySupplier = new Map<string, { total: number; earlyRejected: number; strong: number }>();
    for (const row of rows) {
      const classified = classifyWinner(row);
      const current = poolBySupplier.get(classified.supplierKey) ?? { total: 0, earlyRejected: 0, strong: 0 };
      current.total += 1;
      if (classified.rejectedEarly) current.earlyRejected += 1;
      else current.strong += 1;
      poolBySupplier.set(classified.supplierKey, current);
    }

    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.marketplaceListingId) ?? [];
      bucket.push(row);
      grouped.set(row.marketplaceListingId, bucket);
    }

    const oldWinners: Row[] = [];
    const newWinners: Row[] = [];
    for (const bucket of grouped.values()) {
      const oldWinner = [...bucket].sort((a, b) => {
        const score = oldSelectionScore(b) - oldSelectionScore(a);
        if (score !== 0) return score;
        return String(a.candidateId).localeCompare(String(b.candidateId));
      })[0];
      const newWinner = [...bucket].sort((a, b) => {
        const score = computeSupplierSelectionScore(b) - computeSupplierSelectionScore(a);
        if (score !== 0) return score;
        return String(a.candidateId).localeCompare(String(b.candidateId));
      })[0];
      if (oldWinner) oldWinners.push(oldWinner);
      if (newWinner) newWinners.push(newWinner);
    }

    const summarize = (winnerRows: Row[]) => {
      const winners = winnerRows.map(classifyWinner);
      const supplierMix = new Map<string, number>();
      for (const row of winners) {
        supplierMix.set(row.supplierKey, (supplierMix.get(row.supplierKey) ?? 0) + 1);
      }
      return {
        total: winners.length,
        viableCandidates: winners.filter((row) => !row.rejectedEarly && row.listingEligible).length,
        blockedCandidates: winners.filter((row) => row.rejectedEarly || !row.listingEligible).length,
        unresolvedOriginBlocked: winners.filter((row) => row.rejectReason === "us_origin_unresolved").length,
        lowStockBlocked: winners.filter((row) => row.lowStockOrWorse).length,
        strongSupplierShare:
          winners.length > 0 ? winners.filter((row) => !row.rejectedEarly).length / winners.length : 0,
        supplierMix: Array.from(supplierMix.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([supplierKey, count]) => ({ supplierKey, count })),
      };
    };

    const oldSummary = summarize(oldWinners);
    const newSummary = summarize(newWinners);
    const shiftedAwayFromWeak = newWinners
      .map((row, index) => ({
        marketplaceListingId: row.marketplaceListingId,
        fromSupplier: oldWinners[index]?.supplierKey,
        toSupplier: row.supplierKey,
      }))
      .filter((row) => row.fromSupplier && row.fromSupplier !== row.toSupplier);

    return {
      poolQuality: Array.from(poolBySupplier.entries())
        .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
        .map(([supplierKey, counts]) => ({
          supplierKey,
          totalOptions: counts.total,
          earlyRejected: counts.earlyRejected,
          strongOptions: counts.strong,
        })),
      oldSelection: oldSummary,
      newSelection: newSummary,
      blockedCandidateReduction: oldSummary.blockedCandidates - newSummary.blockedCandidates,
      viableCandidateIncrease: newSummary.viableCandidates - oldSummary.viableCandidates,
      shiftedAwayFromWeakSuppliers: shiftedAwayFromWeak.slice(0, 25),
    };
  };

  const candidateComparison = summarizeComparison(candidateResult.rows ?? []);
  const matchOptionComparison = summarizeComparison(matchResult.rows ?? []);

  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        comparison: {
          profitableCandidates: candidateComparison,
          matchedSupplierOptions: matchOptionComparison,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("validate_us_supplier_priority failed", error);
  process.exit(1);
});
