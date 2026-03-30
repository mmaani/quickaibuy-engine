import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscoveryWaveSourcePlan,
  computeDiscoveryPersistPriority,
  computeSourcePersistCap,
  getDiscoveryOpportunityTier,
} from "@/lib/suppliers/discoveryWave";
import type { SupplierIntelligenceSignal } from "@/lib/suppliers/intelligence";
import { getSupplierWaveBudget } from "@/lib/suppliers/intelligence";

function buildSignal(overrides: Partial<SupplierIntelligenceSignal>): SupplierIntelligenceSignal {
  return {
    supplierKey: "cjdropshipping",
    basePriority: 1,
    destinationCountry: "US",
    originAvailabilityRate: 1,
    shippingTransparencyRate: 0.9,
    stockReliabilityRate: 0.84,
    stockEvidenceStrength: 0.9,
    shippingEvidenceStrength: 0.9,
    apiStabilityScore: 0.9,
    refreshSuccessRate: 0.9,
    historicalSuccessRate: 0.9,
    rateLimitPressure: 0,
    usMarketPriority: 1,
    hasStrongOriginEvidence: true,
    hasUsWarehouse: true,
    stockClass: "SAFE",
    stockConfidence: 0.9,
    lowStockOrWorse: false,
    deliveryEstimateMinDays: 4,
    deliveryEstimateMaxDays: 7,
    deliveryAcceptableForDestination: true,
    hardBlock: false,
    reliabilityScore: 0.9,
    shouldDeprioritize: false,
    ...overrides,
  };
}

test("discovery source plan expands stronger suppliers and shrinks weak suppliers", () => {
  const plan = buildDiscoveryWaveSourcePlan({
    limitPerKeyword: 20,
    learningAdjustments: new Map([
      [
        "cjdropshipping",
        {
          supplierReliability: 0.92,
          shippingReliability: 0.9,
          stockReliability: 0.88,
          parserYield: 0.84,
          publishability: 0.9,
          failurePressure: 0.08,
        },
      ],
      [
        "aliexpress",
        {
          supplierReliability: 0.28,
          shippingReliability: 0.18,
          stockReliability: 0.35,
          parserYield: 0.22,
          publishability: 0.12,
          failurePressure: 0.72,
        },
      ],
    ]),
  });

  const cj = plan.find((row) => row.source === "cjdropshipping");
  const ali = plan.find((row) => row.source === "aliexpress");
  assert.ok(cj && ali);
  assert.ok(cj.searchLimit > ali.searchLimit);
  assert.ok(cj.maximumPersistShare > ali.maximumPersistShare);
});

test("US-origin and known non-US opportunities outrank unresolved origin", () => {
  const budget = getSupplierWaveBudget("cjdropshipping");
  const usSignal = buildSignal({});
  const knownNonUs = buildSignal({
    hasUsWarehouse: false,
    usMarketPriority: 0.82,
    originAvailabilityRate: 0.88,
  });
  const unresolved = buildSignal({
    supplierKey: "aliexpress",
    hasStrongOriginEvidence: false,
    hasUsWarehouse: false,
    originAvailabilityRate: 0,
    usMarketPriority: 0,
    shippingTransparencyRate: 0.52,
    reliabilityScore: 0.58,
  });

  assert.equal(getDiscoveryOpportunityTier(usSignal), "US_ORIGIN_STRONG");
  assert.equal(getDiscoveryOpportunityTier(knownNonUs), "KNOWN_NON_US_ORIGIN");
  assert.equal(getDiscoveryOpportunityTier(unresolved), "ORIGIN_UNRESOLVED");

  const usPriority = computeDiscoveryPersistPriority({
    signal: usSignal,
    budget,
    learnedReliability: 0.9,
    keywordScore: 0.8,
  });
  const knownNonUsPriority = computeDiscoveryPersistPriority({
    signal: knownNonUs,
    budget,
    learnedReliability: 0.82,
    keywordScore: 0.8,
  });
  const unresolvedPriority = computeDiscoveryPersistPriority({
    signal: unresolved,
    budget: getSupplierWaveBudget("aliexpress"),
    learnedReliability: 0.55,
    keywordScore: 0.8,
  });

  assert.ok(usPriority >= knownNonUsPriority);
  assert.ok(knownNonUsPriority > unresolvedPriority);
});

test("AliExpress persist cap collapses when stronger alternatives exist", () => {
  const aliCap = computeSourcePersistCap({
    budget: getSupplierWaveBudget("aliexpress"),
    sourceKey: "aliexpress",
    totalPersistable: 20,
    strongAlternativeSourceCount: 2,
  });
  const cjCap = computeSourcePersistCap({
    budget: getSupplierWaveBudget("cjdropshipping"),
    sourceKey: "cjdropshipping",
    totalPersistable: 20,
    strongAlternativeSourceCount: 2,
  });

  assert.equal(aliCap, 1);
  assert.ok(cjCap > aliCap);
});
