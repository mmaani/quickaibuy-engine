import test from "node:test";
import assert from "node:assert/strict";

import { chooseBestSupplierOption, type CandidateSelectionFields } from "@/lib/profit/supplierPriority";

type TestOption = CandidateSelectionFields & {
  row: Record<string, unknown>;
  marketplaceKey: string;
  marketplaceListingId: string;
  marketPrice: number;
  shippingResolutionMode: string;
  shippingQuoteAgeHours: number | null;
  shippingConfidence: number | null;
  shippingOriginSource: string;
  shippingOriginUnresolvedReason: string | null;
  logisticsOriginHint: string | null;
  shippingSourceType: string | null;
  shippingMethod: string | null;
  shippingValidity: string;
  shippingErrorReason: string | null;
  deliveryEstimateMinDays: number | null;
  shippingDriftDetected: boolean;
  sourceQuality: string | null;
  estimatedFees: Record<string, unknown>;
  estimatedShipping: number;
  estimatedCogs: number;
  economicsHardPass: boolean;
  economicsBlockReason: string | null;
  economicsVerifiedAt: string;
  supplierDriftExceeded: boolean;
  marginOrRoiFailed: boolean;
  automationSafe: boolean;
  listingBlockReason: string | null;
  riskFlags: string[];
  reason: string;
  marketDepth: Record<string, unknown>;
  aiValidation: unknown;
  pipeline: CandidateSelectionFields["pipeline"] & {
    flags: string[];
    matchPreferred: boolean;
    matchExceptionEligible: boolean;
    qualityAccepted: boolean;
    marginAccepted: boolean;
    roiAccepted: boolean;
    hardExcluded: boolean;
    recommended: boolean;
    listingEligible: boolean;
    requiresManualReview: boolean;
  };
  reliabilityAdjustedProfit: CandidateSelectionFields["reliabilityAdjustedProfit"] & {
    penaltyUsd: number;
    reliabilityScore: number;
  };
};

function buildOption(overrides: Partial<TestOption>): TestOption {
  return {
    row: {
      matchId: "m1",
      supplierKey: "cjdropshipping",
      supplierProductId: "supplier-1",
      marketplaceKey: "ebay",
      marketplaceListingId: "listing-1",
      matchType: "exact",
      confidence: "0.9",
      supplierSnapshotId: "ss-1",
      marketPriceSnapshotId: "ms-1",
      supplierPriceMin: "10",
      supplierTitle: "Supplier title",
      supplierImages: [],
      supplierShippingEstimates: [],
      supplierSnapshotTs: new Date().toISOString(),
      supplierAvailabilityStatus: "IN_STOCK",
      supplierRawPayload: {},
      marketPrice: "40",
      shippingPrice: "0",
      marketplaceTitle: "Listing title",
      marketSnapshotTs: new Date().toISOString(),
      marketPriceSeries: [],
    },
    normalizedSupplierKey: "cjdropshipping",
    supplierProductId: "supplier-1",
    marketplaceKey: "ebay",
    marketplaceListingId: "listing-1",
    matchConfidence: 0.92,
    supplierCost: 10,
    marketPrice: 40,
    shipping: 4,
    shippingReserve: 1,
    destinationCountry: "US",
    shippingResolutionMode: "DIRECT",
    shippingQuoteAgeHours: 1,
    shippingConfidence: 0.92,
    shippingOriginCountry: "US",
    shippingOriginSource: "explicit",
    shippingOriginValidity: "EXPLICIT",
    shippingOriginConfidence: 0.95,
    shippingOriginUnresolvedReason: null,
    supplierWarehouseCountry: "US",
    logisticsOriginHint: null,
    shippingSourceType: "product_detail",
    shippingMethod: "Standard",
    shippingTransparencyState: "PRESENT",
    shippingValidity: "PASS",
    shippingErrorReason: null,
    deliveryEstimateMinDays: 5,
    deliveryEstimateMaxDays: 8,
    landedSupplierCost: 15,
    shippingDriftDetected: false,
    supplierSnapshotAgeHours: 2,
    marketplaceSnapshotAgeHours: 2,
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.93,
    sourceQuality: "HIGH",
    sourceQualityRank: 3,
    pipeline: {
      score: 0.9,
      flags: [],
      matchPreferred: true,
      matchExceptionEligible: true,
      qualityAccepted: true,
      marginAccepted: true,
      roiAccepted: true,
      hardExcluded: false,
      recommended: true,
      listingEligible: true,
      requiresManualReview: false,
    },
    estimatedFees: {},
    estimatedShipping: 4,
    estimatedCogs: 10,
    estimatedProfit: 18,
    marginPct: 45,
    roiPct: 80,
    economicsHardPass: true,
    economicsBlockReason: null,
    economicsVerifiedAt: new Date().toISOString(),
    staleMarketplaceSnapshot: false,
    shippingUnsafe: false,
    supplierDriftExceeded: false,
    availabilityUnsafe: false,
    availabilityManualReview: false,
    stockClass: "SAFE",
    lowStockControlledRiskEligible: false,
    marginOrRoiFailed: false,
    automationSafe: true,
    decisionStatus: "APPROVED",
    listingEligible: true,
    listingBlockReason: null,
    riskFlags: [],
    reason: "test",
    marketDepth: {
      opportunityType: "BALANCED",
      medianPriceUsd: 40,
      lowPriceUsd: 38,
      highPriceUsd: 42,
      outlierHighPriceUsd: null,
      outlierLowPriceUsd: null,
      spreadUsd: 4,
      noiseRatio: 0.05,
      sampleSize: 5,
    },
    reliabilityAdjustedProfit: {
      adjustedProfitUsd: 16,
      penaltyUsd: 2,
      reliabilityScore: 0.9,
    },
    supplierReliabilityScore: 0.9,
    aiValidation: null,
    ...overrides,
  };
}

test("US-origin wins when economics are otherwise competitive", () => {
  const us = buildOption({});
  const china = buildOption({
    normalizedSupplierKey: "alibaba",
    supplierProductId: "supplier-2",
    shippingOriginCountry: "CN",
    shippingOriginValidity: "EXPLICIT",
    shippingOriginConfidence: 0.96,
    supplierWarehouseCountry: "CN",
    deliveryEstimateMinDays: 6,
    deliveryEstimateMaxDays: 8,
    landedSupplierCost: 14.5,
    estimatedProfit: 18.8,
    reliabilityAdjustedProfit: {
      adjustedProfitUsd: 16.8,
      penaltyUsd: 2,
      reliabilityScore: 0.88,
    },
    supplierReliabilityScore: 0.88,
  });

  assert.equal(chooseBestSupplierOption([us, china]).supplierProductId, "supplier-1");
});

test("known-origin international supplier can beat weak expensive US supplier", () => {
  const weakUs = buildOption({
    supplierProductId: "supplier-us-weak",
    estimatedProfit: 10,
    roiPct: 32,
    marginPct: 24,
    deliveryEstimateMinDays: 9,
    deliveryEstimateMaxDays: 12,
    landedSupplierCost: 23,
    reliabilityAdjustedProfit: {
      adjustedProfitUsd: 8,
      penaltyUsd: 2,
      reliabilityScore: 0.62,
    },
    supplierReliabilityScore: 0.62,
    availabilityConfidence: 0.76,
  });
  const strongChina = buildOption({
    normalizedSupplierKey: "alibaba",
    supplierProductId: "supplier-cn-strong",
    shippingOriginCountry: "CN",
    shippingOriginValidity: "EXPLICIT",
    shippingOriginConfidence: 0.97,
    supplierWarehouseCountry: "CN",
    deliveryEstimateMinDays: 6,
    deliveryEstimateMaxDays: 9,
    landedSupplierCost: 14,
    estimatedProfit: 19,
    roiPct: 75,
    marginPct: 43,
    reliabilityAdjustedProfit: {
      adjustedProfitUsd: 16,
      penaltyUsd: 3,
      reliabilityScore: 0.9,
    },
    supplierReliabilityScore: 0.9,
  });

  assert.equal(chooseBestSupplierOption([weakUs, strongChina]).supplierProductId, "supplier-cn-strong");
});

test("safe stock outranks controlled-risk low stock when economics are close", () => {
  const safeUs = buildOption({
    supplierProductId: "supplier-safe-us",
    stockClass: "SAFE",
    lowStockControlledRiskEligible: false,
  });
  const lowStockIntl = buildOption({
    normalizedSupplierKey: "alibaba",
    supplierProductId: "supplier-low-intl",
    shippingOriginCountry: "CN",
    shippingOriginValidity: "EXPLICIT",
    supplierWarehouseCountry: "CN",
    stockClass: "LOW",
    lowStockControlledRiskEligible: true,
    reliabilityAdjustedProfit: {
      adjustedProfitUsd: 16.5,
      penaltyUsd: 2,
      reliabilityScore: 0.88,
    },
    supplierReliabilityScore: 0.88,
  });

  assert.equal(chooseBestSupplierOption([safeUs, lowStockIntl]).supplierProductId, "supplier-safe-us");
});
