import { db } from "@/lib/db";
import { getProductsRawLatestOrderBySql, getProductsRawTimestampExprSql } from "@/lib/db/productsRaw";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { extractAvailabilityFromRawPayload, normalizeAvailabilitySignal } from "@/lib/products/supplierAvailability";
import {
  classifySupplierEvidence,
  formatSupplierEvidenceBlockReason,
} from "@/lib/products/supplierEvidenceClassification";
import {
  evaluateProductPipelinePolicy,
  PRODUCT_PIPELINE_MARGIN_MIN,
  PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
  PRODUCT_PIPELINE_ROI_MIN,
  normalizeSupplierQuality,
} from "@/lib/products/pipelinePolicy";
import { sql } from "drizzle-orm";
import { calculateRealProfit } from "./realProfitCalculator";
import { getPriceGuardThresholds } from "./priceGuardConfig";

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
  supplierTitle: string | null;
  supplierImages: unknown;
  supplierShippingEstimates: unknown;
  supplierSnapshotTs: Date | string | null;
  supplierAvailabilityStatus: string | null;
  supplierRawPayload: unknown;
  marketPrice: string | null;
  shippingPrice: string | null;
  marketplaceTitle: string | null;
  marketSnapshotTs: Date | string | null;
};

type ExistingCandidateState = {
  decisionStatus: string | null;
  listingEligible: boolean | null;
  listingBlockReason: string | null;
  expectedSupplierPrice: string | null;
};

type CandidateOption = {
  row: ProfitRow;
  normalizedSupplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  matchConfidence: number;
  supplierCost: number;
  marketPrice: number;
  shipping: number;
  supplierSnapshotAgeHours: number | null;
  marketplaceSnapshotAgeHours: number | null;
  availabilitySignal: string;
  availabilityConfidence: number | null;
  sourceQuality: "HIGH" | "MEDIUM" | "LOW" | "STUB" | null;
  sourceQualityRank: number;
  pipeline: ReturnType<typeof evaluateProductPipelinePolicy>;
  estimatedFees: Record<string, unknown>;
  estimatedShipping: number;
  estimatedCogs: number;
  estimatedProfit: number;
  marginPct: number;
  roiPct: number;
  staleMarketplaceSnapshot: boolean;
  supplierDriftExceeded: boolean;
  availabilityUnsafe: boolean;
  availabilityManualReview: boolean;
  marginOrRoiFailed: boolean;
  automationSafe: boolean;
  decisionStatus: string;
  listingEligible: boolean;
  listingBlockReason: string | null;
  riskFlags: string[];
  reason: string;
};

// Supplier drift threshold for post-approval protection.
const SUPPLIER_DRIFT_MANUAL_REVIEW_PCT = 15;
const PIPELINE_HARD_BLOCK_FLAGS = new Set(["HARD_EXCLUDE", "BRAND_RISK", "HIGH_RISK_ELECTRONICS"]);

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

function compareNullableNumbersDesc(a: number | null, b: number | null): number {
  const left = a ?? Number.NEGATIVE_INFINITY;
  const right = b ?? Number.NEGATIVE_INFINITY;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function compareNullableNumbersAsc(a: number | null, b: number | null): number {
  const left = a ?? Number.POSITIVE_INFINITY;
  const right = b ?? Number.POSITIVE_INFINITY;
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function buildSelectionGroupKey(option: CandidateOption): string {
  return `${option.marketplaceKey}:${option.marketplaceListingId}`;
}

function sourceQualityRank(value: "HIGH" | "MEDIUM" | "LOW" | "STUB" | null): number {
  if (value === "HIGH") return 3;
  if (value === "MEDIUM") return 2;
  if (value === "LOW") return 1;
  if (value === "STUB") return 0;
  return -1;
}

function describeCandidateOption(option: CandidateOption): string {
  return [
    `source ${option.normalizedSupplierKey}`,
    option.listingEligible ? "listing-ready" : option.decisionStatus.toLowerCase(),
    `profit ${round2(option.estimatedProfit)}`,
    `roi ${round2(option.roiPct)}%`,
    `margin ${round2(option.marginPct)}%`,
    `quality ${option.sourceQuality ?? "unknown"}`,
    `availability ${option.availabilitySignal}`,
    `pipeline ${option.pipeline.score}`,
    `match ${round2(option.matchConfidence)}`,
    `supplier_age ${option.supplierSnapshotAgeHours ?? "n/a"}h`,
  ].join(" | ");
}

function chooseBestSupplierOption(options: CandidateOption[]): CandidateOption {
  const sorted = [...options].sort((left, right) => {
    const orderedComparisons = [
      Number(left.listingEligible) - Number(right.listingEligible),
      Number(left.decisionStatus === "APPROVED") - Number(right.decisionStatus === "APPROVED"),
      Number(!left.staleMarketplaceSnapshot) - Number(!right.staleMarketplaceSnapshot),
      Number(!left.availabilityManualReview && !left.availabilityUnsafe) -
        Number(!right.availabilityManualReview && !right.availabilityUnsafe),
      compareNullableNumbersDesc(left.availabilityConfidence, right.availabilityConfidence),
      compareNullableNumbersDesc(left.estimatedProfit, right.estimatedProfit),
      compareNullableNumbersDesc(left.roiPct, right.roiPct),
      compareNullableNumbersDesc(left.marginPct, right.marginPct),
      left.sourceQualityRank - right.sourceQualityRank,
      compareNullableNumbersDesc(left.pipeline.score, right.pipeline.score),
      compareNullableNumbersDesc(left.matchConfidence, right.matchConfidence),
      compareNullableNumbersAsc(left.supplierSnapshotAgeHours, right.supplierSnapshotAgeHours),
      compareNullableNumbersAsc(left.marketplaceSnapshotAgeHours, right.marketplaceSnapshotAgeHours),
      compareNullableNumbersAsc(left.supplierCost, right.supplierCost),
    ];

    for (const comparison of orderedComparisons) {
      if (comparison !== 0) return comparison > 0 ? -1 : 1;
    }

    return left.normalizedSupplierKey.localeCompare(right.normalizedSupplierKey);
  });

  return sorted[0];
}

export async function runProfitEngine(input?: {
  limit?: number;
  supplierKey?: string;
  supplierProductId?: string;
  marketplaceKey?: string;
  marketplaceListingId?: string;
}) {
  const limit = Number(input?.limit ?? 50);
  const minRoiPct = Math.max(
    Number(process.env.MIN_ROI_PCT || String(PRODUCT_PIPELINE_ROI_MIN)),
    PRODUCT_PIPELINE_ROI_MIN
  );
  const minMarginPct = Math.max(
    Number(process.env.PROFIT_MIN_MARGIN_PCT || String(PRODUCT_PIPELINE_MARGIN_MIN)),
    PRODUCT_PIPELINE_MARGIN_MIN
  );
  const minMatchConfidence = Math.max(
    Number(process.env.PROFIT_MIN_MATCH_CONFIDENCE || String(PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN)),
    PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN
  );
  const maxMarketplaceSnapshotAgeHours = getPriceGuardThresholds().maxMarketplaceSnapshotAgeHours;

  const supplierKeyFilter =
    input?.supplierKey && String(input.supplierKey).trim()
      ? String(input.supplierKey).trim().toLowerCase()
      : null;
  const supplierProductIdFilter =
    input?.supplierProductId && String(input.supplierProductId).trim()
      ? String(input.supplierProductId).trim()
      : null;
  const marketplaceKeyFilter =
    input?.marketplaceKey && String(input.marketplaceKey).trim()
      ? normalizeMarketplaceKey(input.marketplaceKey)
      : null;
  const marketplaceListingIdFilter =
    input?.marketplaceListingId && String(input.marketplaceListingId).trim()
      ? String(input.marketplaceListingId).trim()
      : null;
  const productsRawOrderBySql = await getProductsRawLatestOrderBySql("pr");
  const productsRawSnapshotTsSql = await getProductsRawTimestampExprSql("pr");

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
        ${supplierProductIdFilter ? sql`AND m.supplier_product_id = ${supplierProductIdFilter}` : sql``}
        ${marketplaceKeyFilter
          ? sql`AND CASE
              WHEN LOWER(m.marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(m.marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(m.marketplace_key)
            END = ${marketplaceKeyFilter}`
          : sql``}
        ${marketplaceListingIdFilter ? sql`AND m.marketplace_listing_id = ${marketplaceListingIdFilter}` : sql``}
    ),
    latest_products AS (
      SELECT
        pr.id,
        pr.supplier_key,
        pr.supplier_product_id,
        pr.title,
        pr.images,
        pr.shipping_estimates,
        pr.price_min,
        ${productsRawSnapshotTsSql} AS snapshot_ts,
        pr.availability_status,
        pr.raw_payload,
        ROW_NUMBER() OVER (
          PARTITION BY pr.supplier_key, pr.supplier_product_id
          ORDER BY ${productsRawOrderBySql}
        ) AS rn
      FROM products_raw pr
      WHERE 1 = 1
      ${supplierKeyFilter ? sql`AND LOWER(pr.supplier_key) = ${supplierKeyFilter}` : sql``}
      ${supplierProductIdFilter ? sql`AND pr.supplier_product_id = ${supplierProductIdFilter}` : sql``}
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
        mp.matched_title,
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
      WHERE 1 = 1
      ${supplierKeyFilter ? sql`AND LOWER(mp.supplier_key) = ${supplierKeyFilter}` : sql``}
      ${supplierProductIdFilter ? sql`AND mp.supplier_product_id = ${supplierProductIdFilter}` : sql``}
      ${marketplaceKeyFilter
        ? sql`AND CASE
            WHEN LOWER(mp.marketplace_key) LIKE 'amazon%' THEN 'amazon'
            WHEN LOWER(mp.marketplace_key) LIKE 'ebay%' THEN 'ebay'
            ELSE LOWER(mp.marketplace_key)
          END = ${marketplaceKeyFilter}`
        : sql``}
      ${marketplaceListingIdFilter ? sql`AND mp.marketplace_listing_id = ${marketplaceListingIdFilter}` : sql``}
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
      lp.title AS "supplierTitle",
      lp.images AS "supplierImages",
      lp.shipping_estimates AS "supplierShippingEstimates",
      lp.snapshot_ts AS "supplierSnapshotTs",
      lp.availability_status AS "supplierAvailabilityStatus",
      lp.raw_payload AS "supplierRawPayload",
      lmp.price AS "marketPrice",
      lmp.shipping_price AS "shippingPrice",
      lmp.matched_title AS "marketplaceTitle",
      lmp.snapshot_ts AS "marketSnapshotTs"
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
    ORDER BY
      (
        select min(pc.calc_ts)
        from profitable_candidates pc
        where pc.supplier_key = lower(rm.supplier_key)
          and pc.supplier_product_id = rm.supplier_product_id
          and pc.marketplace_key = rm.marketplace_key_norm
          and pc.marketplace_listing_id = rm.marketplace_listing_id
      ) ASC NULLS FIRST,
      lmp.snapshot_ts ASC NULLS FIRST,
      lp.snapshot_ts ASC NULLS FIRST,
      rm.last_seen_ts ASC NULLS FIRST,
      CAST(rm.confidence AS numeric) DESC
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
    const marginPct = economics.marginPct;

    if (roiPct < minRoiPct || marginPct < minMarginPct) {
      skipped++;
      continue;
    }

    acceptedRows.push(row);
  }

  const candidateOptions: CandidateOption[] = [];

  for (const row of acceptedRows) {
    const now = new Date();
    const normalizedSupplierKey = String(row.supplierKey || "").toLowerCase();
    const supplierProductId = String(row.supplierProductId ?? "").trim();
    const marketplaceKey = normalizeMarketplaceKey(row.marketplaceKey);
    const marketplaceListingId = String(row.marketplaceListingId ?? "").trim();

    const matchConfidence = toNum(row.confidence) ?? 0;
    const supplierCost = toNum(row.supplierPriceMin) ?? 0;
    const marketPrice = toNum(row.marketPrice) ?? 0;
    const shipping = toNum(row.shippingPrice) ?? 0;
    const supplierSnapshotAgeHours = computeAgeHours(now, toDate(row.supplierSnapshotTs));
    const marketplaceSnapshotAgeHours = computeAgeHours(now, toDate(row.marketSnapshotTs));
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
    const staleMarketplaceSnapshot =
      marketplaceSnapshotAgeHours != null &&
      marketplaceSnapshotAgeHours > maxMarketplaceSnapshotAgeHours;
    const supplierImages = Array.isArray(row.supplierImages)
      ? row.supplierImages.filter((value): value is string => typeof value === "string")
      : [];
    const supplierRawPayload =
      row.supplierRawPayload &&
      typeof row.supplierRawPayload === "object" &&
      !Array.isArray(row.supplierRawPayload)
        ? (row.supplierRawPayload as Record<string, unknown>)
        : null;

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
    const telemetrySignals =
      supplierRawPayload && Array.isArray(supplierRawPayload.telemetrySignals)
        ? (supplierRawPayload.telemetrySignals as string[])
        : [];
    const pipeline = evaluateProductPipelinePolicy({
      title: row.supplierTitle,
      marketplaceTitle: row.marketplaceTitle,
      supplierTitle: row.supplierTitle,
      imageUrl: supplierImages[0] ?? null,
      additionalImageCount: Math.max(0, supplierImages.length - 1),
      mediaQualityScore:
        supplierRawPayload && typeof supplierRawPayload.mediaQualityScore === "number"
          ? supplierRawPayload.mediaQualityScore
          : null,
      supplierQuality:
        supplierRawPayload
          ? normalizeSupplierQuality(String(supplierRawPayload.snapshotQuality ?? ""))
          : null,
      telemetrySignals,
      availabilitySignal,
      availabilityConfidence: availability.confidence ?? null,
      shippingEstimates: row.supplierShippingEstimates,
      shippingConfidence:
        supplierRawPayload && typeof supplierRawPayload.shippingConfidence === "number"
          ? supplierRawPayload.shippingConfidence
          : null,
      actionableSnapshot:
        supplierRawPayload && typeof supplierRawPayload.actionableSnapshot === "boolean"
          ? supplierRawPayload.actionableSnapshot
          : null,
      supplierRowDecision:
        supplierRawPayload &&
        (supplierRawPayload.supplierRowDecision === "ACTIONABLE" ||
          supplierRawPayload.supplierRowDecision === "MANUAL_REVIEW" ||
          supplierRawPayload.supplierRowDecision === "BLOCKED")
          ? supplierRawPayload.supplierRowDecision
          : null,
      supplierPrice: supplierCost,
      marketplacePrice: marketPrice,
      matchConfidence,
      marginPct,
      roiPct,
    });
    const rawSupplierQuality =
      supplierRawPayload
        ? normalizeSupplierQuality(String(supplierRawPayload.snapshotQuality ?? ""))
        : null;
    const supplierEvidence = classifySupplierEvidence({
      availabilitySignal,
      availabilityConfidence: availability.confidence ?? null,
      shippingEstimates: row.supplierShippingEstimates,
      shippingConfidence:
        supplierRawPayload && typeof supplierRawPayload.shippingConfidence === "number"
          ? supplierRawPayload.shippingConfidence
          : null,
      mediaQualityScore:
        supplierRawPayload && typeof supplierRawPayload.mediaQualityScore === "number"
          ? supplierRawPayload.mediaQualityScore
          : null,
      imageCount: supplierImages.length,
      sourceQuality: rawSupplierQuality,
      rawPayload: supplierRawPayload,
      telemetrySignals,
    });
    const supplierEvidenceCodes = supplierEvidence.codes;
    const marginOrRoiFailed = marginPct < minMarginPct || roiPct < minRoiPct;
    const pipelineHardBlocked = pipeline.flags.some((flag) => PIPELINE_HARD_BLOCK_FLAGS.has(flag));
    const automationSafe =
      !staleMarketplaceSnapshot &&
      !supplierDriftExceeded &&
      !supplierEvidence.manualReview &&
      !marginOrRoiFailed &&
      !pipelineHardBlocked;
    const decisionStatus =
      staleMarketplaceSnapshot || supplierDriftExceeded || supplierEvidence.manualReview
        ? "MANUAL_REVIEW"
        : marginOrRoiFailed || pipelineHardBlocked
          ? "MANUAL_REVIEW"
          : automationSafe
            ? "APPROVED"
            : (existing?.decisionStatus ?? "PENDING");
    const listingEligible = automationSafe;
    const listingBlockReason = staleMarketplaceSnapshot
      ? `marketplace snapshot age ${marketplaceSnapshotAgeHours}h exceeds ${maxMarketplaceSnapshotAgeHours}h`
      : supplierDriftExceeded
      ? `supplier drift ${supplierPriceDriftPct}% exceeds ${SUPPLIER_DRIFT_MANUAL_REVIEW_PCT}% tolerance`
      : supplierEvidence.manualReview && supplierEvidenceCodes.length
        ? formatSupplierEvidenceBlockReason(supplierEvidenceCodes)
          : marginOrRoiFailed
            ? `profit guard requires margin >= ${minMarginPct}% and roi >= ${minRoiPct}%`
            : pipelineHardBlocked
              ? `pipeline policy requires manual review: ${pipeline.penalties.join(", ")}`
              : null;
    const riskFlags =
      staleMarketplaceSnapshot
        ? ["STALE_MARKETPLACE_SNAPSHOT"]
        : supplierDriftExceeded
          ? ["SUPPLIER_PRICE_DRIFT_EXCEEDS_15_PCT"]
          : supplierEvidenceCodes.length
            ? Array.from(new Set([...supplierEvidenceCodes, ...pipeline.flags]))
            : marginOrRoiFailed
                ? ["PROFIT_THRESHOLD_NOT_MET"]
                : pipeline.flags;
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
      breakEvenPriceUsd: economics.breakEvenPriceUsd,
      pipelinePolicy: pipeline,
    };

    const reason = staleMarketplaceSnapshot
      ? `marketplace_snapshot_age_hours ${marketplaceSnapshotAgeHours ?? "n/a"} > ${maxMarketplaceSnapshotAgeHours} | roi ${roiPct}% >= minimum ${minRoiPct}% | match ${matchConfidence}`
      : supplierDriftExceeded
      ? `supplier drift ${supplierPriceDriftPct}% > ${SUPPLIER_DRIFT_MANUAL_REVIEW_PCT}% | supplier_snapshot_age_hours ${supplierSnapshotAgeHours ?? "n/a"}`
      : supplierEvidence.manualReview && supplierEvidenceCodes.length
        ? `supplier evidence review required | codes ${supplierEvidenceCodes.join(", ")} | availability_signal ${availabilitySignal} | availability_confidence ${availability.confidence ?? "n/a"}`
      : marginOrRoiFailed
        ? `margin ${marginPct}% / roi ${roiPct}% below required margin ${minMarginPct}% roi ${minRoiPct}%`
        : pipelineHardBlocked
          ? `pipeline manual review | score ${pipeline.score} | penalties ${pipeline.penalties.join(", ") || "none"}`
          : supplierEvidenceCodes.length
            ? `automated with supplier evidence warnings | codes ${supplierEvidenceCodes.join(", ")} | availability_signal ${availabilitySignal} | availability_confidence ${availability.confidence ?? "n/a"}`
          : `roi ${roiPct}% >= minimum ${minRoiPct}% | match ${matchConfidence} | pipeline_score ${pipeline.score} | supplier_price_drift_pct ${supplierPriceDriftPct ?? "n/a"} | supplier_snapshot_age_hours ${supplierSnapshotAgeHours ?? "n/a"} | marketplace_snapshot_age_hours ${marketplaceSnapshotAgeHours ?? "n/a"} | availability_signal ${availabilitySignal} | availability_confidence ${availability.confidence ?? "n/a"}`;

    candidateOptions.push({
      row,
      normalizedSupplierKey,
      supplierProductId,
      marketplaceKey,
      marketplaceListingId,
      matchConfidence,
      supplierCost,
      marketPrice,
      shipping,
      supplierSnapshotAgeHours,
      marketplaceSnapshotAgeHours,
      availabilitySignal,
      availabilityConfidence: availability.confidence ?? null,
      sourceQuality: rawSupplierQuality,
      sourceQualityRank: sourceQualityRank(rawSupplierQuality),
      pipeline,
      estimatedFees: estimatedFeesJson,
      estimatedShipping,
      estimatedCogs,
      estimatedProfit,
      marginPct,
      roiPct,
      staleMarketplaceSnapshot,
      supplierDriftExceeded,
      availabilityUnsafe: supplierEvidenceCodes.includes("SUPPLIER_OUT_OF_STOCK"),
      availabilityManualReview: supplierEvidence.manualReview,
      marginOrRoiFailed,
      automationSafe,
      decisionStatus,
      listingEligible,
      listingBlockReason,
      riskFlags,
      reason,
    });
  }

  const winningOptions = Array.from(
    candidateOptions.reduce((map, option) => {
      const key = buildSelectionGroupKey(option);
      const current = map.get(key);
      if (!current) {
        map.set(key, option);
        return map;
      }
      map.set(key, chooseBestSupplierOption([current, option]));
      return map;
    }, new Map<string, CandidateOption>())
  ).map(([, option]) => option);

  let staleDeleted = 0;
  const exactScopedRun = Boolean(
    supplierProductIdFilter || marketplaceKeyFilter || marketplaceListingIdFilter
  );

  const candidateScopeSql = sql`
    1 = 1
    ${supplierKeyFilter ? sql`AND LOWER(pc.supplier_key) = ${supplierKeyFilter}` : sql``}
    ${supplierProductIdFilter ? sql`AND pc.supplier_product_id = ${supplierProductIdFilter}` : sql``}
    ${marketplaceKeyFilter ? sql`AND pc.marketplace_key = ${marketplaceKeyFilter}` : sql``}
    ${marketplaceListingIdFilter ? sql`AND pc.marketplace_listing_id = ${marketplaceListingIdFilter}` : sql``}
  `;

  if (winningOptions.length > 0) {
    const acceptedPairs = winningOptions.map((option) => sql`
      (
        ${option.normalizedSupplierKey},
        ${option.supplierProductId},
        ${option.marketplaceKey},
        ${option.marketplaceListingId}
      )
    `);

    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE
        ${candidateScopeSql}
        AND
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE
        ${candidateScopeSql}
        AND
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);
  } else if (supplierKeyFilter && !exactScopedRun) {
    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE ${candidateScopeSql}
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE ${candidateScopeSql}
    `);
  }

  for (const option of winningOptions) {
    const peerOptions = candidateOptions.filter(
      (candidate) => buildSelectionGroupKey(candidate) === buildSelectionGroupKey(option)
    );
    const selectionSummary = describeCandidateOption(option);
    const alternativeSourceCount = Math.max(0, peerOptions.length - 1);
    const estimatedFeesJson = {
      ...option.estimatedFees,
      selectionMode: "best_supplier_option_per_marketplace_listing_v1",
      selectedSupplierOption: {
        supplierKey: option.normalizedSupplierKey,
        supplierProductId: option.supplierProductId,
        listingEligible: option.listingEligible,
        decisionStatus: option.decisionStatus,
        selectionGroupKey: buildSelectionGroupKey(option),
        selectionSummary,
        alternativeSourceCount,
        consideredSources: peerOptions
          .map((candidate) => candidate.normalizedSupplierKey)
          .sort((left, right) => left.localeCompare(right)),
      },
    };

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
        ${option.normalizedSupplierKey},
        ${option.supplierProductId},
        ${option.marketplaceKey},
        ${option.marketplaceListingId},
        NOW(),
        ${option.row.supplierSnapshotId},
        ${option.row.marketPriceSnapshotId},
        ${JSON.stringify(estimatedFeesJson)}::jsonb,
        ${String(option.estimatedShipping)},
        ${String(option.estimatedCogs)},
        ${String(option.estimatedProfit)},
        ${String(option.marginPct)},
        ${String(option.roiPct)},
        ${option.riskFlags.length
          ? sql`ARRAY[${sql.join(option.riskFlags.map((flag) => sql`${flag}`), sql`, `)}]::text[]`
          : sql`ARRAY[]::text[]`},
        ${option.decisionStatus},
        ${option.reason},
        ${option.listingEligible},
        ${option.listingBlockReason}
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
    minMarginPct,
    minMatchConfidence,
  };
}
