import { db } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { extractAvailabilityFromRawPayload, normalizeAvailabilitySignal } from "@/lib/products/supplierAvailability";
import { sql } from "drizzle-orm";
import { calculateRealProfit } from "./realProfitCalculator";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ProfitRow = {
  matchId: string;
  supplierKey: string | null;
  supplierProductId: string | null;
  marketplaceKey: string | null;
  marketplaceListingId: string | null;
  matchType: string | null;
  confidence: string | null;
  supplierSnapshotId: string | null;
  marketPriceSnapshotId: string | null;
  supplierPriceMin: string | null;
  supplierSnapshotTs: Date | string | null;
  supplierAvailabilityStatus: string | null;
  supplierRawPayload: unknown;
  marketPrice: string | null;
  shippingPrice: string | null;
};

type ExistingCandidateState = {
  decisionStatus: string | null;
  listingEligible: boolean | null;
  listingBlockReason: string | null;
  expectedSupplierPrice: string | null;
};

// Supplier drift threshold for post-approval protection.
const SUPPLIER_DRIFT_MANUAL_REVIEW_PCT = 15;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function computePctChange(expected: number | null, latest: number | null): number | null {
  if (expected == null || latest == null || expected <= 0) return null;
  return round2(((latest - expected) / expected) * 100);
}

function computeAgeHours(now: Date, snapshotTs: Date | null): number | null {
  if (!snapshotTs) return null;
  return round2((now.getTime() - snapshotTs.getTime()) / (1000 * 60 * 60));
}

export async function runProfitEngine(input?: {
  limit?: number;
  supplierKey?: string;
}) {
  const limit = Number(input?.limit ?? 50);
  const minRoiPct = Number(process.env.MIN_ROI_PCT || "15");
  const minMatchConfidence = Number(process.env.PROFIT_MIN_MATCH_CONFIDENCE || "0.50");

  const supplierKeyFilter =
    input?.supplierKey && String(input.supplierKey).trim()
      ? String(input.supplierKey).trim().toLowerCase()
      : null;

  const rowsResult = await db.execute<ProfitRow>(sql`
    WITH ranked_matches AS (
      SELECT
        m.id AS match_id,
        m.supplier_key,
        m.supplier_product_id,
        CASE
          WHEN LOWER(m.marketplace_key) LIKE 'amazon%' THEN 'amazon'
          WHEN LOWER(m.marketplace_key) LIKE 'ebay%' THEN 'ebay'
          ELSE LOWER(m.marketplace_key)
        END AS marketplace_key_norm,
        m.marketplace_listing_id,
        m.match_type,
        m.confidence,
        m.last_seen_ts,
        ROW_NUMBER() OVER (
          PARTITION BY
            m.supplier_key,
            m.supplier_product_id,
            CASE
              WHEN LOWER(m.marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(m.marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(m.marketplace_key)
            END
          ORDER BY
            CAST(m.confidence AS numeric) DESC,
            m.last_seen_ts DESC,
            m.id DESC
        ) AS rn
      FROM matches m
      WHERE
        m.status = 'ACTIVE'
        AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        ${supplierKeyFilter ? sql`AND LOWER(m.supplier_key) = ${supplierKeyFilter}` : sql``}
    ),
    latest_products AS (
      SELECT
        pr.id,
        pr.supplier_key,
        pr.supplier_product_id,
        pr.price_min,
        pr.snapshot_ts,
        pr.availability_status,
        pr.raw_payload,
        ROW_NUMBER() OVER (
          PARTITION BY pr.supplier_key, pr.supplier_product_id
          ORDER BY pr.id DESC
        ) AS rn
      FROM products_raw pr
      ${supplierKeyFilter ? sql`WHERE LOWER(pr.supplier_key) = ${supplierKeyFilter}` : sql``}
    ),
    latest_marketplace_prices AS (
      SELECT
        mp.id,
        mp.product_raw_id,
        CASE
          WHEN LOWER(mp.marketplace_key) LIKE 'amazon%' THEN 'amazon'
          WHEN LOWER(mp.marketplace_key) LIKE 'ebay%' THEN 'ebay'
          ELSE LOWER(mp.marketplace_key)
        END AS marketplace_key_norm,
        mp.marketplace_listing_id,
        mp.price,
        mp.shipping_price,
        mp.snapshot_ts,
        ROW_NUMBER() OVER (
          PARTITION BY
            mp.product_raw_id,
            CASE
              WHEN LOWER(mp.marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(mp.marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(mp.marketplace_key)
            END,
            mp.marketplace_listing_id
          ORDER BY mp.snapshot_ts DESC, mp.id DESC
        ) AS rn
      FROM marketplace_prices mp
      ${supplierKeyFilter ? sql`WHERE LOWER(mp.supplier_key) = ${supplierKeyFilter}` : sql``}
    )
    SELECT
      rm.match_id AS "matchId",
      rm.supplier_key AS "supplierKey",
      rm.supplier_product_id AS "supplierProductId",
      rm.marketplace_key_norm AS "marketplaceKey",
      rm.marketplace_listing_id AS "marketplaceListingId",
      rm.match_type AS "matchType",
      rm.confidence AS "confidence",
      lp.id AS "supplierSnapshotId",
      lmp.id AS "marketPriceSnapshotId",
      lp.price_min AS "supplierPriceMin",
      lp.snapshot_ts AS "supplierSnapshotTs",
      lp.availability_status AS "supplierAvailabilityStatus",
      lp.raw_payload AS "supplierRawPayload",
      lmp.price AS "marketPrice",
      lmp.shipping_price AS "shippingPrice"
    FROM ranked_matches rm
    INNER JOIN latest_products lp
      ON lp.supplier_key = rm.supplier_key
      AND lp.supplier_product_id = rm.supplier_product_id
      AND lp.rn = 1
    INNER JOIN latest_marketplace_prices lmp
      ON lmp.product_raw_id = lp.id
      AND lmp.marketplace_key_norm = rm.marketplace_key_norm
      AND lmp.marketplace_listing_id = rm.marketplace_listing_id
      AND lmp.rn = 1
    WHERE rm.rn = 1
    ORDER BY CAST(rm.confidence AS numeric) DESC, rm.last_seen_ts DESC
    LIMIT ${limit}
  `);

  const rows = rowsResult.rows ?? [];

  let insertedOrUpdated = 0;
  let skipped = 0;

  const acceptedRows: ProfitRow[] = [];

  for (const row of rows) {
    const matchConfidence = toNum(row.confidence) ?? 0;
    if (matchConfidence < minMatchConfidence) {
      skipped++;
      continue;
    }

    const supplierCost = toNum(row.supplierPriceMin);
    const marketPrice = toNum(row.marketPrice);
    const shipping = toNum(row.shippingPrice) ?? 0;

    if (supplierCost == null || marketPrice == null) {
      skipped++;
      continue;
    }

    const economics = calculateRealProfit({
      marketplaceKey: row.marketplaceKey,
      supplierPriceUsd: supplierCost,
      marketplacePriceUsd: marketPrice,
      shippingPriceUsd: shipping,
    });

    const roiPct = economics.roiPct;

    if (roiPct < minRoiPct) {
      skipped++;
      continue;
    }

    acceptedRows.push(row);
  }

  let staleDeleted = 0;

  if (acceptedRows.length > 0) {
    const acceptedPairs = acceptedRows.map((row) => sql`
      (
        ${String(row.supplierKey || "").toLowerCase()},
        ${row.supplierProductId},
        ${normalizeMarketplaceKey(row.marketplaceKey)},
        ${row.marketplaceListingId}
      )
    `);

    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE
        ${supplierKeyFilter ? sql`LOWER(pc.supplier_key) = ${supplierKeyFilter} AND` : sql``}
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE
        ${supplierKeyFilter ? sql`LOWER(pc.supplier_key) = ${supplierKeyFilter} AND` : sql``}
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);
  } else if (supplierKeyFilter) {
    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE LOWER(pc.supplier_key) = ${supplierKeyFilter}
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE LOWER(pc.supplier_key) = ${supplierKeyFilter}
    `);
  }

  for (const row of acceptedRows) {
    const now = new Date();
    const normalizedSupplierKey = String(row.supplierKey || "").toLowerCase();
    const supplierProductId = row.supplierProductId;
    const marketplaceKey = normalizeMarketplaceKey(row.marketplaceKey);
    const marketplaceListingId = row.marketplaceListingId;

    const matchConfidence = toNum(row.confidence) ?? 0;
    const supplierCost = toNum(row.supplierPriceMin) ?? 0;
    const marketPrice = toNum(row.marketPrice) ?? 0;
    const shipping = toNum(row.shippingPrice) ?? 0;
    const supplierSnapshotAgeHours = computeAgeHours(now, toDate(row.supplierSnapshotTs));
    const availability = extractAvailabilityFromRawPayload({
      availabilityStatus: row.supplierAvailabilityStatus,
      rawPayload: row.supplierRawPayload,
    });
    const availabilitySignal = normalizeAvailabilitySignal(availability.signal);

    const existingResult = await db.execute<ExistingCandidateState>(sql`
      SELECT
        pc.decision_status AS "decisionStatus",
        pc.listing_eligible AS "listingEligible",
        pc.listing_block_reason AS "listingBlockReason",
        ps.price_min::text AS "expectedSupplierPrice"
      FROM profitable_candidates pc
      LEFT JOIN products_raw ps
        ON ps.id = pc.supplier_snapshot_id
      WHERE pc.supplier_key = ${normalizedSupplierKey}
        AND pc.supplier_product_id = ${supplierProductId}
        AND pc.marketplace_key = ${marketplaceKey}
        AND pc.marketplace_listing_id = ${marketplaceListingId}
      LIMIT 1
    `);
    const existing = existingResult.rows?.[0];
    const expectedSupplierPrice = toNum(existing?.expectedSupplierPrice);
    const supplierPriceDriftPct = computePctChange(expectedSupplierPrice, supplierCost);
    const supplierDriftExceeded =
      supplierPriceDriftPct != null && Math.abs(supplierPriceDriftPct) > SUPPLIER_DRIFT_MANUAL_REVIEW_PCT;
    const availabilityUnsafe = availabilitySignal === "OUT_OF_STOCK";
    const availabilityManualReview =
      availabilitySignal === "UNKNOWN" || availabilitySignal === "LOW_STOCK";

    const decisionStatus = supplierDriftExceeded || availabilityUnsafe || availabilityManualReview
      ? "MANUAL_REVIEW"
      : (existing?.decisionStatus ?? "PENDING");
    const listingEligible =
      supplierDriftExceeded || availabilityUnsafe || availabilityManualReview
        ? false
        : Boolean(existing?.listingEligible ?? false);
    const listingBlockReason = supplierDriftExceeded
      ? `supplier drift ${supplierPriceDriftPct}% exceeds ${SUPPLIER_DRIFT_MANUAL_REVIEW_PCT}% tolerance`
      : availabilityUnsafe
        ? "supplier availability indicates out of stock"
        : availabilityManualReview
          ? `supplier availability requires manual review (${availabilitySignal})`
      : (existing?.listingBlockReason ?? null);
    const riskFlagsSql = supplierDriftExceeded
      ? sql`ARRAY['SUPPLIER_PRICE_DRIFT_EXCEEDS_15_PCT']::text[]`
      : availabilityUnsafe
        ? sql`ARRAY['SUPPLIER_OUT_OF_STOCK']::text[]`
        : availabilityManualReview
          ? sql`ARRAY['SUPPLIER_AVAILABILITY_UNKNOWN']::text[]`
      : sql`ARRAY[]::text[]`;

    const economics = calculateRealProfit({
      marketplaceKey,
      supplierPriceUsd: supplierCost,
      marketplacePriceUsd: marketPrice,
      shippingPriceUsd: shipping,
    });

    const estimatedFees = economics.estimatedFeesUsd;
    const estimatedShipping = economics.estimatedShippingUsd;
    const estimatedCogs = economics.estimatedCogsUsd;
    const estimatedProfit = economics.estimatedProfitUsd;
    const marginPct = economics.marginPct;
    const roiPct = economics.roiPct;

    const estimatedFeesJson = {
      feePct: economics.assumptions.ebayFeeRatePct,
      feeUsd: estimatedFees,
      otherCostUsd: economics.assumptions.fixedCostUsd,
      payoutReservePct: economics.assumptions.payoutReservePct,
      paymentReservePct: economics.assumptions.paymentReservePct,
      fxReservePct: economics.assumptions.fxReservePct,
      shippingVariancePct: economics.assumptions.shippingVariancePct,
      costBreakdown: economics.costs,
      matchConfidence,
      matchType: row.matchType,
      selectionMode: "latest_best_active_match_per_supplier_product",
      matchId: row.matchId,
      country: economics.assumptions.country,
      economicsModel: "jordan_ebay_deterministic_v1",
    };

    const reason = supplierDriftExceeded
      ? `supplier drift ${supplierPriceDriftPct}% > ${SUPPLIER_DRIFT_MANUAL_REVIEW_PCT}% | supplier_snapshot_age_hours ${supplierSnapshotAgeHours ?? "n/a"}`
      : `roi ${roiPct}% >= minimum ${minRoiPct}% | match ${matchConfidence} | supplier_price_drift_pct ${supplierPriceDriftPct ?? "n/a"} | supplier_snapshot_age_hours ${supplierSnapshotAgeHours ?? "n/a"} | availability_signal ${availabilitySignal} | availability_confidence ${availability.confidence ?? "n/a"}`;

    await db.execute(sql`
      INSERT INTO profitable_candidates (
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        calc_ts,
        supplier_snapshot_id,
        market_price_snapshot_id,
        estimated_fees,
        estimated_shipping,
        estimated_cogs,
        estimated_profit,
        margin_pct,
        roi_pct,
        risk_flags,
        decision_status,
        reason,
        listing_eligible,
        listing_block_reason
      ) VALUES (
        ${normalizedSupplierKey},
        ${supplierProductId},
        ${marketplaceKey},
        ${marketplaceListingId},
        NOW(),
        ${row.supplierSnapshotId},
        ${row.marketPriceSnapshotId},
        ${JSON.stringify(estimatedFeesJson)}::jsonb,
        ${String(estimatedShipping)},
        ${String(estimatedCogs)},
        ${String(estimatedProfit)},
        ${String(marginPct)},
        ${String(roiPct)},
        ${riskFlagsSql},
        ${decisionStatus},
        ${reason},
        ${listingEligible},
        ${listingBlockReason}
      )
      ON CONFLICT (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id)
      DO UPDATE SET
        calc_ts = NOW(),
        supplier_snapshot_id = EXCLUDED.supplier_snapshot_id,
        market_price_snapshot_id = EXCLUDED.market_price_snapshot_id,
        estimated_fees = EXCLUDED.estimated_fees,
        estimated_shipping = EXCLUDED.estimated_shipping,
        estimated_cogs = EXCLUDED.estimated_cogs,
        estimated_profit = EXCLUDED.estimated_profit,
        margin_pct = EXCLUDED.margin_pct,
        roi_pct = EXCLUDED.roi_pct,
        risk_flags = EXCLUDED.risk_flags,
        decision_status = EXCLUDED.decision_status,
        reason = EXCLUDED.reason,
        listing_eligible = EXCLUDED.listing_eligible,
        listing_block_reason = EXCLUDED.listing_block_reason
    `);

    insertedOrUpdated++;
  }

  return {
    ok: true,
    scanned: rows.length,
    insertedOrUpdated,
    skipped,
    staleDeleted,
    minRoiPct,
    minMatchConfidence,
  };
}
