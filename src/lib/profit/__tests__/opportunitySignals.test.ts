import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketDepthSignal, computeReliabilityAdjustedProfit } from "@/lib/profit/opportunitySignals";

test("buildMarketDepthSignal detects noisy market", () => {
  const signal = buildMarketDepthSignal([20, 21, 19.5, 200, 180, 170, 18.8, 20.2, 17], 20);
  assert.equal(signal.opportunityType, "NOISY");
  assert.ok(signal.outlierHighPriceUsd == null || signal.outlierHighPriceUsd > signal.medianPriceUsd);
});

test("buildMarketDepthSignal detects floor play", () => {
  const signal = buildMarketDepthSignal([40, 42, 39, 44, 41], 39);
  assert.equal(signal.opportunityType, "FLOOR_PLAY");
});

test("computeReliabilityAdjustedProfit applies deterministic penalties", () => {
  const result = computeReliabilityAdjustedProfit({
    nominalProfitUsd: 20,
    supplierCostUsd: 10,
    shippingCostUsd: 3,
    platformFeesUsd: 5,
    reserveCostUsd: 2,
    supplierReliabilityScore: 0.6,
    shippingConfidenceScore: 0.7,
    marketNoiseRatio: 0.2,
  });
  assert.ok(result.adjustedProfitUsd < 20);
  assert.ok(result.penaltyUsd > 0);
  assert.ok(result.reliabilityScore >= 0 && result.reliabilityScore <= 1);
});
