import { db } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { resolvePricingDestinationForMarketplace } from "@/lib/pricing/destinationResolver";
import { resolveShippingCost } from "@/lib/pricing/shippingCalculator";
import {
  classifySupplierEvidence,
} from "@/lib/products/supplierEvidenceClassification";
import {
  extractAvailabilityFromRawPayload,
  normalizeAvailabilitySignal,
} from "@/lib/products/supplierAvailability";
import {
  evaluateProductPipelinePolicy,
  PRODUCT_PIPELINE_MARGIN_MIN,
  PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
  PRODUCT_PIPELINE_ROI_MIN,
  getMatchRoutingStatus,
  normalizeSupplierQuality,
} from "@/lib/products/pipelinePolicy";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";
import { calculateRealProfit } from "@/lib/profit/realProfitCalculator";
import { computeSupplierIntelligenceSignal, compareSupplierIntelligence } from "@/lib/suppliers/intelligence";
import { getSupplierRefreshTelemetryMap } from "@/lib/suppliers/telemetry";
import { sql } from "drizzle-orm";

type SupplierOptionRow = {
  supplierKey: string | null;
  supplierProductId: string | null;
  marketplaceKey: string | null;
  marketplaceListingId: string | null;
  matchType: string | null;
  confidence: string | null;
  supplierPriceMin: string | null;
  supplierTitle: string | null;
  supplierImages: unknown;
  supplierShippingEstimates: unknown;
  supplierSnapshotTs: Date | string | null;
  supplierAvailabilityStatus: string | null;
  supplierRawPayload: unknown;
  marketPrice: string | null;
  marketplaceTitle: string | null;
  marketSnapshotTs: Date | string | null;
};

export type ActiveSupplierOption = {
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  destinationCountry: string;
  supplierCost: number;
  shippingCostUsd: number;
  shippingReserveUsd: number;
  totalShippingUsd: number;
  landedSupplierCostUsd: number;
  estimatedProfitUsd: number;
  marginPct: number;
  roiPct: number;
  decisionStatus: string;
  listingEligible: boolean;
  shippingResolutionMode: string;
  shippingQuoteAgeHours: number | null;
  shippingOriginCountry: string | null;
  shippingErrorReason: string | null;
  shippingConfidence: number | null;
  supplierReliabilityScore: number;
  originAvailabilityRate: number;
  shippingTransparencyRate: number;
  hasUsWarehouse: boolean;
  availabilitySignal: string;
  availabilityConfidence: number | null;
  supplierSnapshotAgeHours: number | null;
  marketplaceSnapshotAgeHours: number | null;
  reason: string;
};

export type ActiveSupplierReevaluationStatus =
  | "CURRENT_SUPPLIER_REMAINS_BEST"
  | "ALTERNATE_SUPPLIER_BETTER"
  | "CURRENT_SUPPLIER_NON_VIABLE"
  | "NO_VIABLE_SUPPLIER"
  | "CURRENT_SUPPLIER_NOT_FOUND";

export type ActiveSupplierReevaluation = {
  status: ActiveSupplierReevaluationStatus;
  destinationCountry: string;
  currentSupplierKey: string;
  currentSupplierProductId: string;
  evaluatedAt: string;
  alternativesCount: number;
  currentOption: ActiveSupplierOption | null;
  bestOption: ActiveSupplierOption | null;
  viableOptions: ActiveSupplierOption[];
  allOptions: ActiveSupplierOption[];
};

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

function chooseBestOption(options: ActiveSupplierOption[]): ActiveSupplierOption | null {
  if (!options.length) return null;
  return [...options].sort((left, right) => {
    const intelligenceOrder = compareSupplierIntelligence(
      {
        supplierKey: left.supplierKey,
        basePriority: 0,
        destinationCountry: left.destinationCountry,
        originAvailabilityRate: left.originAvailabilityRate,
        shippingTransparencyRate: left.shippingTransparencyRate,
        stockReliabilityRate:
          left.availabilitySignal === "IN_STOCK" ? 1 : left.availabilitySignal === "LOW_STOCK" ? 0.2 : 0,
        stockEvidenceStrength: 0,
        shippingEvidenceStrength: 0,
        apiStabilityScore: 0,
        refreshSuccessRate: null,
        historicalSuccessRate: null,
        rateLimitPressure: 0,
        usMarketPriority: left.hasUsWarehouse ? 1 : left.originAvailabilityRate,
        hasStrongOriginEvidence: left.originAvailabilityRate >= 0.75,
        hasUsWarehouse: left.hasUsWarehouse,
        lowStockOrWorse: left.availabilitySignal !== "IN_STOCK",
        hardBlock: Boolean(left.shippingErrorReason) || left.availabilitySignal !== "IN_STOCK",
        reliabilityScore: left.supplierReliabilityScore,
        shouldDeprioritize: false,
      },
      {
        supplierKey: right.supplierKey,
        basePriority: 0,
        destinationCountry: right.destinationCountry,
        originAvailabilityRate: right.originAvailabilityRate,
        shippingTransparencyRate: right.shippingTransparencyRate,
        stockReliabilityRate:
          right.availabilitySignal === "IN_STOCK" ? 1 : right.availabilitySignal === "LOW_STOCK" ? 0.2 : 0,
        stockEvidenceStrength: 0,
        shippingEvidenceStrength: 0,
        apiStabilityScore: 0,
        refreshSuccessRate: null,
        historicalSuccessRate: null,
        rateLimitPressure: 0,
        usMarketPriority: right.hasUsWarehouse ? 1 : right.originAvailabilityRate,
        hasStrongOriginEvidence: right.originAvailabilityRate >= 0.75,
        hasUsWarehouse: right.hasUsWarehouse,
        lowStockOrWorse: right.availabilitySignal !== "IN_STOCK",
        hardBlock: Boolean(right.shippingErrorReason) || right.availabilitySignal !== "IN_STOCK",
        reliabilityScore: right.supplierReliabilityScore,
        shouldDeprioritize: false,
      }
    );
    if (intelligenceOrder !== 0) return intelligenceOrder;
    const comparisons = [
      Number(left.listingEligible) - Number(right.listingEligible),
      Number(left.decisionStatus === "APPROVED") - Number(right.decisionStatus === "APPROVED"),
      Number(!left.shippingErrorReason) - Number(!right.shippingErrorReason),
      compareNullableNumbersDesc(left.estimatedProfitUsd, right.estimatedProfitUsd),
      compareNullableNumbersDesc(left.roiPct, right.roiPct),
      compareNullableNumbersDesc(left.marginPct, right.marginPct),
      compareNullableNumbersAsc(left.totalShippingUsd, right.totalShippingUsd),
      compareNullableNumbersAsc(left.landedSupplierCostUsd, right.landedSupplierCostUsd),
      compareNullableNumbersAsc(left.supplierSnapshotAgeHours, right.supplierSnapshotAgeHours),
      compareNullableNumbersAsc(left.marketplaceSnapshotAgeHours, right.marketplaceSnapshotAgeHours),
    ];

    for (const comparison of comparisons) {
      if (comparison !== 0) return comparison > 0 ? -1 : 1;
    }

    return left.supplierKey.localeCompare(right.supplierKey);
  })[0];
}

export async function reevaluateActiveListingSuppliers(input: {
  marketplaceKey: string;
  marketplaceListingId: string;
  currentSupplierKey: string;
  currentSupplierProductId: string;
}): Promise<ActiveSupplierReevaluation> {
  const marketplaceKey = normalizeMarketplaceKey(input.marketplaceKey);
  const marketplaceListingId = String(input.marketplaceListingId ?? "").trim();
  const currentSupplierKey = String(input.currentSupplierKey ?? "").trim().toLowerCase();
  const currentSupplierProductId = String(input.currentSupplierProductId ?? "").trim();
  const destinationCountry = resolvePricingDestinationForMarketplace(marketplaceKey);
  const maxMarketplaceSnapshotAgeHours = getPriceGuardThresholds().maxMarketplaceSnapshotAgeHours;
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

  const rowsResult = await db.execute<SupplierOptionRow>(sql`
    WITH ranked_matches AS (
      SELECT
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
          PARTITION BY m.supplier_key, m.supplier_product_id
          ORDER BY CAST(m.confidence AS numeric) DESC, m.last_seen_ts DESC, m.id DESC
        ) AS rn
      FROM matches m
      WHERE m.status = 'ACTIVE'
        AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        AND CASE
              WHEN LOWER(m.marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(m.marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(m.marketplace_key)
            END = ${marketplaceKey}
        AND m.marketplace_listing_id = ${marketplaceListingId}
    ),
    latest_products AS (
      SELECT
        pr.supplier_key,
        pr.supplier_product_id,
        pr.title,
        pr.images,
        pr.shipping_estimates,
        pr.price_min,
        pr.snapshot_ts,
        pr.availability_status,
        pr.raw_payload,
        ROW_NUMBER() OVER (
          PARTITION BY pr.supplier_key, pr.supplier_product_id
          ORDER BY pr.snapshot_ts DESC, pr.id DESC
        ) AS rn
      FROM products_raw pr
    ),
    latest_marketplace_price AS (
      SELECT
        mp.price,
        mp.matched_title,
        mp.snapshot_ts,
        ROW_NUMBER() OVER (
          PARTITION BY mp.marketplace_listing_id
          ORDER BY mp.snapshot_ts DESC, mp.id DESC
        ) AS rn
      FROM marketplace_prices mp
      WHERE CASE
              WHEN LOWER(mp.marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(mp.marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(mp.marketplace_key)
            END = ${marketplaceKey}
        AND mp.marketplace_listing_id = ${marketplaceListingId}
    )
    SELECT
      rm.supplier_key AS "supplierKey",
      rm.supplier_product_id AS "supplierProductId",
      rm.marketplace_key_norm AS "marketplaceKey",
      rm.marketplace_listing_id AS "marketplaceListingId",
      rm.match_type AS "matchType",
      rm.confidence AS "confidence",
      lp.price_min AS "supplierPriceMin",
      lp.title AS "supplierTitle",
      lp.images AS "supplierImages",
      lp.shipping_estimates AS "supplierShippingEstimates",
      lp.snapshot_ts AS "supplierSnapshotTs",
      lp.availability_status AS "supplierAvailabilityStatus",
      lp.raw_payload AS "supplierRawPayload",
      lmp.price AS "marketPrice",
      lmp.matched_title AS "marketplaceTitle",
      lmp.snapshot_ts AS "marketSnapshotTs"
    FROM ranked_matches rm
    INNER JOIN latest_products lp
      ON lp.supplier_key = rm.supplier_key
      AND lp.supplier_product_id = rm.supplier_product_id
      AND lp.rn = 1
    INNER JOIN latest_marketplace_price lmp
      ON lmp.rn = 1
    WHERE rm.rn = 1
  `);
  const refreshTelemetry = await getSupplierRefreshTelemetryMap();

  const now = new Date();
  const allOptions: ActiveSupplierOption[] = [];

  for (const row of rowsResult.rows ?? []) {
    const supplierKey = String(row.supplierKey ?? "").trim().toLowerCase();
    const supplierProductId = String(row.supplierProductId ?? "").trim();
    const supplierCost = toNum(row.supplierPriceMin);
    const marketPrice = toNum(row.marketPrice);
    const matchConfidence = toNum(row.confidence) ?? 0;
    if (
      !supplierKey ||
      !supplierProductId ||
      supplierCost == null ||
      marketPrice == null ||
      matchConfidence < minMatchConfidence
    ) {
      continue;
    }

    const shippingResolution = await resolveShippingCost({
      supplierKey,
      supplierProductId,
      destinationCountry,
      shippingEstimates: row.supplierShippingEstimates,
      rawPayload: row.supplierRawPayload,
    });
    const totalShippingUsd = round2(
      shippingResolution.shippingCostUsd + shippingResolution.shippingReserveUsd
    );
    const landedSupplierCostUsd = round2(supplierCost + totalShippingUsd);
    const supplierSnapshotAgeHours = computeAgeHours(now, toDate(row.supplierSnapshotTs));
    const marketplaceSnapshotAgeHours = computeAgeHours(now, toDate(row.marketSnapshotTs));
    const staleMarketplaceSnapshot =
      marketplaceSnapshotAgeHours != null &&
      marketplaceSnapshotAgeHours > maxMarketplaceSnapshotAgeHours;
    const availability = extractAvailabilityFromRawPayload({
      availabilityStatus: row.supplierAvailabilityStatus,
      rawPayload: row.supplierRawPayload,
    });
    const availabilitySignal = normalizeAvailabilitySignal(availability.signal);
    const supplierImages = Array.isArray(row.supplierImages)
      ? row.supplierImages.filter((value): value is string => typeof value === "string")
      : [];
    const supplierRawPayload =
      row.supplierRawPayload &&
      typeof row.supplierRawPayload === "object" &&
      !Array.isArray(row.supplierRawPayload)
        ? (row.supplierRawPayload as Record<string, unknown>)
        : null;
    const telemetrySignals =
      supplierRawPayload && Array.isArray(supplierRawPayload.telemetrySignals)
        ? (supplierRawPayload.telemetrySignals as string[])
        : [];
    const rawSupplierQuality =
      supplierRawPayload
        ? normalizeSupplierQuality(String(supplierRawPayload.snapshotQuality ?? ""))
        : null;
    const telemetry = refreshTelemetry.get(supplierKey);

    const economics = calculateRealProfit({
      marketplaceKey,
      supplierPriceUsd: supplierCost,
      marketplacePriceUsd: marketPrice,
      shippingPriceUsd: totalShippingUsd,
    });
    const marginPct = economics.marginPct;
    const roiPct = economics.roiPct;
    const estimatedProfitUsd = economics.estimatedProfitUsd;

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
      supplierQuality: rawSupplierQuality,
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
    const supplierIntelligence = computeSupplierIntelligenceSignal({
      supplierKey,
      destinationCountry,
      availabilitySignal,
      availabilityConfidence: availability.confidence ?? null,
      shippingEstimates: row.supplierShippingEstimates,
      rawPayload: supplierRawPayload,
      shippingConfidence:
        supplierRawPayload && typeof supplierRawPayload.shippingConfidence === "number"
          ? supplierRawPayload.shippingConfidence
          : null,
      snapshotQuality: rawSupplierQuality,
      refreshSuccessRate: telemetry?.refreshSuccessRate ?? null,
      historicalSuccessRate:
        telemetry?.attempts != null && telemetry.attempts > 0 ? telemetry.exactMatches / telemetry.attempts : null,
      rateLimitEvents: telemetry?.rateLimitEvents ?? null,
      refreshAttempts: telemetry?.attempts ?? null,
    });
    const matchRoutingStatus = getMatchRoutingStatus(matchConfidence);
    const shippingUnsafe = Boolean(shippingResolution.errorReason);
    const marginOrRoiFailed = marginPct < minMarginPct || roiPct < minRoiPct;
    const pipelineHardBlocked = pipeline.flags.some(
      (flag) => flag === "HARD_EXCLUDE" || flag === "BRAND_RISK" || flag === "HIGH_RISK_ELECTRONICS"
    );
    const automationSafe =
      matchRoutingStatus === "ACTIVE" &&
      !staleMarketplaceSnapshot &&
      !supplierEvidence.manualReview &&
      !shippingUnsafe &&
      !marginOrRoiFailed &&
      !pipelineHardBlocked;
    const decisionStatus =
      matchRoutingStatus === "REJECTED"
        ? "REJECTED"
        : matchRoutingStatus === "MANUAL_REVIEW" ||
            staleMarketplaceSnapshot ||
            supplierEvidence.manualReview ||
            shippingUnsafe ||
            marginOrRoiFailed ||
            pipelineHardBlocked
          ? "MANUAL_REVIEW"
          : automationSafe
            ? "APPROVED"
            : "PENDING";

    allOptions.push({
      supplierKey,
      supplierProductId,
      marketplaceKey,
      marketplaceListingId,
      destinationCountry,
      supplierCost,
      shippingCostUsd: shippingResolution.shippingCostUsd,
      shippingReserveUsd: shippingResolution.shippingReserveUsd,
      totalShippingUsd,
      landedSupplierCostUsd,
      estimatedProfitUsd,
      marginPct,
      roiPct,
      decisionStatus,
      listingEligible: automationSafe,
      shippingResolutionMode: shippingResolution.resolutionMode,
      shippingQuoteAgeHours: shippingResolution.quoteAgeHours,
      shippingOriginCountry: shippingResolution.resolvedOriginCountry,
      shippingErrorReason: shippingResolution.errorReason,
      shippingConfidence: shippingResolution.sourceConfidence,
      supplierReliabilityScore: supplierIntelligence.reliabilityScore,
      originAvailabilityRate: supplierIntelligence.originAvailabilityRate,
      shippingTransparencyRate: supplierIntelligence.shippingTransparencyRate,
      hasUsWarehouse: supplierIntelligence.hasUsWarehouse,
      availabilitySignal,
      availabilityConfidence: availability.confidence ?? null,
      supplierSnapshotAgeHours,
      marketplaceSnapshotAgeHours,
      reason: shippingResolution.errorReason
        ? `shipping intelligence unresolved: ${shippingResolution.errorReason}`
        : automationSafe
          ? "viable supplier"
          : "supplier requires manual review",
    });
  }

  const viableOptions = allOptions.filter(
    (option) => option.listingEligible && option.decisionStatus === "APPROVED"
  );
  const bestOption = chooseBestOption(viableOptions);
  const currentOption =
    allOptions.find(
      (option) =>
        option.supplierKey === currentSupplierKey &&
        option.supplierProductId === currentSupplierProductId
    ) ?? null;

  let status: ActiveSupplierReevaluationStatus = "CURRENT_SUPPLIER_NOT_FOUND";
  if (!currentOption) {
    status = bestOption ? "ALTERNATE_SUPPLIER_BETTER" : "CURRENT_SUPPLIER_NOT_FOUND";
  } else if (!currentOption.listingEligible || currentOption.decisionStatus !== "APPROVED") {
    status = bestOption ? "CURRENT_SUPPLIER_NON_VIABLE" : "NO_VIABLE_SUPPLIER";
  } else if (!bestOption) {
    status = "NO_VIABLE_SUPPLIER";
  } else if (
    bestOption.supplierKey === currentOption.supplierKey &&
    bestOption.supplierProductId === currentOption.supplierProductId
  ) {
    status = "CURRENT_SUPPLIER_REMAINS_BEST";
  } else {
    status = "ALTERNATE_SUPPLIER_BETTER";
  }

  return {
    status,
    destinationCountry,
    currentSupplierKey,
    currentSupplierProductId,
    evaluatedAt: now.toISOString(),
    alternativesCount: Math.max(0, allOptions.length - 1),
    currentOption,
    bestOption,
    viableOptions,
    allOptions: allOptions.sort((left, right) => {
      const best = chooseBestOption([left, right]);
      if (!best) return 0;
      if (best.supplierKey === left.supplierKey && best.supplierProductId === left.supplierProductId) return -1;
      if (best.supplierKey === right.supplierKey && best.supplierProductId === right.supplierProductId) return 1;
      return 0;
    }),
  };
}
